import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ChildProcess } from 'child_process';

const TRANSIENT_FS_LOCK_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE', 'EACCES']);

export interface CloseableSqliteHandle {
  open?: boolean;
  pragma?: (sql: string) => unknown;
  close?: () => void;
}

/**
 * Deterministically checkpoints WAL and closes a better-sqlite3 handle so Windows NTFS
 * releases file locks on the main DB as well as -wal and -shm sidecar files.
 */
export function closeSqliteHandle(handle: CloseableSqliteHandle | null | undefined): void {
  if (!handle) return;
  try {
    if (handle.open === false) return;
    if (typeof handle.pragma === 'function') {
      try {
        handle.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // Ignore checkpoint error on read-only or already-closing handles
      }
    }
    if (typeof handle.close === 'function') {
      handle.close();
    }
  } catch {
    // Handle already closed
  }
}

/**
 * Terminates a running ChildProcess and awaits its exit so OS file handles are released
 * before cleaning up isolated temporary SQLite directories.
 */
export async function terminateAndAwaitChild(
  child: ChildProcess | null | undefined,
  timeoutMs = 5000
): Promise<void> {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    child.once('exit', finish);
    child.once('close', finish);

    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
    } catch {
      finish();
      return;
    }

    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      setTimeout(finish, 150);
    }, timeoutMs);
  });
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

/**
 * Removes an isolated temporary test directory inside os.tmpdir() with bounded retries
 * for transient Windows NTFS/antivirus lock release (EBUSY/EPERM).
 * Never silently suppresses cleanup failures.
 */
export function removeIsolatedTestDir(
  dirPath: string,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): void {
  const resolvedTarget = path.resolve(dirPath);
  const resolvedTmp = path.resolve(os.tmpdir());
  const normalizedTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  const normalizedTmp = process.platform === 'win32' ? resolvedTmp.toLowerCase() : resolvedTmp;

  if (
    normalizedTarget === normalizedTmp ||
    !normalizedTarget.startsWith(normalizedTmp + path.sep)
  ) {
    throw new Error(
      `SAFETY_REFUSAL: Refusing to delete directory outside os.tmpdir(): ${resolvedTarget}`
    );
  }

  if (!fs.existsSync(resolvedTarget)) return;

  const maxRetries = options.maxRetries ?? 12;
  const baseDelayMs = options.baseDelayMs ?? 30;
  let lastError: NodeJS.ErrnoException | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
      if (!fs.existsSync(resolvedTarget)) return;
    } catch (err: any) {
      lastError = err as NodeJS.ErrnoException;
      const code = lastError?.code || '';
      if (!TRANSIENT_FS_LOCK_CODES.has(code) || attempt === maxRetries) {
        break;
      }
      const delayMs = Math.min(250, baseDelayMs * attempt);
      sleepSync(delayMs);
    }
  }

  let remaining: string[] = [];
  try {
    if (fs.existsSync(resolvedTarget)) {
      remaining = fs.readdirSync(resolvedTarget);
    }
  } catch {
    // ignore listing error
  }

  const code = lastError?.code || 'UNKNOWN';
  const msg = lastError?.message || 'Directory still exists after cleanup';
  throw new Error(
    `Failed to remove isolated test directory "${resolvedTarget}" after ${maxRetries} attempts (${code}: ${msg}). Remaining entries: [${remaining.join(', ')}]`
  );
}

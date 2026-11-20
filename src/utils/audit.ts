import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';
import { redactSensitiveText, sanitizeErrorMessage } from './redact.ts';

export async function logAudit(params: {
  userId?: number;
  userName?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: string;
  previousValue?: string | null;
  newValue?: string | null;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogs).values({
      userId: params.userId,
      userName: params.userName,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details ? redactSensitiveText(params.details) : params.details,
      previousValue: params.previousValue ? redactSensitiveText(params.previousValue) : params.previousValue ?? null,
      newValue: params.newValue ? redactSensitiveText(params.newValue) : params.newValue ?? null,
      ipAddress: params.ipAddress,
    });
  } catch (err) {
    console.error('Failed to write audit log:', sanitizeErrorMessage(err));
  }
}

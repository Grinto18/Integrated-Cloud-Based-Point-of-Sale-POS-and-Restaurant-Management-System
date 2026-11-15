// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Auth } from 'firebase-admin/auth';

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gp_pos_auth_test_'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'isolated_qa.db');
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

const JWT_SECRET = process.env.JWT_SECRET || 'golden-palace-pos-super-secure-key-2026';

// Generate isolated RSA keypairs for real cryptographic RS256 Firebase-style token tests
const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const { privateKey: attackerPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

function buildFirebaseMockToken(
  payload: Record<string, any>,
  options: { kid?: string; alg?: jwt.Algorithm; expiresIn?: number | string; key?: crypto.KeyObject | string } = {}
) {
  const { kid = 'test-firebase-kid-1', alg = 'RS256', expiresIn = '1h', key = rsaPrivateKey } = options;
  const header: jwt.JwtHeader = { alg, typ: 'JWT' };
  if (kid !== undefined) {
    header.kid = kid;
  }
  return jwt.sign(payload, key as jwt.Secret, {
    algorithm: alg,
    header,
    expiresIn: expiresIn as any,
  });
}

let app: express.Express;
let sqlite: any;
let db: any;
let usersTable: any;
let eqFn: any;
let adminAuth: Auth;
let signUserToken: any;
let clearRevokedTokensForTest: any;

describe('Golden Palace POS — Backend Auth QA & Security Tests', () => {
  beforeAll(async () => {
    const dbMod = await import('../db/index.ts');
    sqlite = dbMod.sqlite;
    db = dbMod.db;

    // Safety guard: guarantee tests never touch the production DB
    expect(sqlite.name).toBe(TEST_DB_PATH);
    expect(sqlite.name).not.toContain('Golden Palace POS');
    expect(sqlite.name).not.toContain('golden_palace.db');

    const schemaMod = await import('../db/schema.ts');
    usersTable = schemaMod.users;

    const ormMod = await import('drizzle-orm');
    eqFn = ormMod.eq;

    const { seedDatabase } = await import('../db/seed.ts');
    await seedDatabase();

    const authMod = await import('../middleware/auth.ts');
    signUserToken = authMod.signUserToken;
    clearRevokedTokensForTest = authMod.clearRevokedTokensForTest;

    const fbAdminMod = await import('../lib/firebase-admin.ts');
    adminAuth = fbAdminMod.adminAuth;

    const { apiRouter } = await import('../server/api.ts');
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
  });

  beforeEach(() => {
    clearRevokedTokensForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    try {
      sqlite?.close();
    } catch {
      // ignore
    }
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  function spyFirebaseWithRealRsaVerification() {
    return vi.spyOn(adminAuth, 'verifyIdToken').mockImplementation(async (idToken: string) => {
      try {
        const decoded = jwt.verify(idToken, rsaPublicKey, {
          algorithms: ['RS256'],
        }) as jwt.JwtPayload;
        return {
          uid: String(decoded.sub || decoded.uid),
          email: decoded.email,
          email_verified: decoded.email_verified,
          name: decoded.name,
        } as any;
      } catch (err: any) {
        if (err?.name === 'TokenExpiredError') {
          const fbErr: any = new Error('Firebase ID token has expired');
          fbErr.code = 'auth/id-token-expired';
          throw fbErr;
        }
        const fbErr: any = new Error('Firebase ID token has invalid signature');
        fbErr.code = 'auth/invalid-id-token';
        throw fbErr;
      }
    });
  }

  describe('1. Firebase Login & Provisioning', () => {
    it('authenticates a valid verified Firebase ID token, verifies identity, and safely provisions a CASHIER', async () => {
      const spy = spyFirebaseWithRealRsaVerification();
      const fbToken = buildFirebaseMockToken({
        sub: 'fb-uid-cashier-01',
        email: 'staff.member@goldenpalace.dz',
        email_verified: true,
        name: 'كاشير Firebase',
      });

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${fbToken}`);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.uid).toBe('fb-uid-cashier-01');
      expect(meRes.body.user.email).toBe('staff.member@goldenpalace.dz');
      expect(meRes.body.user.role).toBe('CASHIER');

      // CASHIER role cannot access ADMIN/MANAGER users endpoint
      const rbacRes = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${fbToken}`);
      expect(rbacRes.status).toBe(403);
    });

    it('never grants ADMIN privileges just because Firebase email contains "admin"', async () => {
      spyFirebaseWithRealRsaVerification();
      const fbToken = buildFirebaseMockToken({
        sub: 'fb-uid-evil-admin-email',
        email: 'admin-attacker@external.com',
        email_verified: true,
        name: 'Attacker',
      });

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${fbToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.role).toBe('CASHIER');

      const createUserRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${fbToken}`)
        .send({ username: 'x', email: 'x@x.dz', password: '123', fullName: 'x', role: 'ADMIN' });
      expect(createUserRes.status).toBe(403);
    });

    it('respects elevated DB role and rejects disabled Firebase users with 403', async () => {
      spyFirebaseWithRealRsaVerification();
      const fbUid = 'fb-uid-manager-02';
      const fbToken = buildFirebaseMockToken({
        sub: fbUid,
        email: 'mgr.fb@goldenpalace.dz',
        email_verified: true,
        name: 'مدير Firebase',
      });

      // Provision first
      const firstRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${fbToken}`);
      expect(firstRes.status).toBe(200);

      // Elevate role in DB on server side to MANAGER
      await db.update(usersTable).set({ role: 'MANAGER' }).where(eqFn(usersTable.uid, fbUid));
      const usersListRes = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${fbToken}`);
      expect(usersListRes.status).toBe(200);

      // Disable user in DB
      await db.update(usersTable).set({ isActive: false }).where(eqFn(usersTable.uid, fbUid));
      const disabledRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${fbToken}`);
      expect(disabledRes.status).toBe(403);
    });
  });

  describe('2. PIN Login & Unlock', () => {
    it('logs in with valid PIN (1234 Admin / 1111 Cashier) and issues distinct tokens with jti', async () => {
      const res1 = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(res1.status).toBe(200);
      expect(res1.body.user.role).toBe('ADMIN');
      expect(typeof res1.body.token).toBe('string');

      const res2 = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(res2.status).toBe(200);
      expect(res2.body.token).not.toBe(res1.body.token);

      const cashierRes = await request(app).post('/api/auth/pin-login').send({ pin: '1111' });
      expect(cashierRes.status).toBe(200);
      expect(cashierRes.body.user.role).toBe('CASHIER');
    });

    it('rejects wrong PIN with 401 and empty PIN with 400', async () => {
      const badRes = await request(app).post('/api/auth/pin-login').send({ pin: '9999' });
      expect(badRes.status).toBe(401);

      const emptyRes = await request(app).post('/api/auth/pin-login').send({ pin: '' });
      expect(emptyRes.status).toBe(400);
    });

    it('rejects PIN unlock for disabled user with 403', async () => {
      await db.update(usersTable).set({ isActive: false }).where(eqFn(usersTable.username, 'serveur1'));
      const res = await request(app).post('/api/auth/pin-login').send({ pin: '4444' });
      expect(res.status).toBe(403);
      await db.update(usersTable).set({ isActive: true }).where(eqFn(usersTable.username, 'serveur1'));
    });
  });

  describe('3. Token Validation & Regression for Missing kid Claim', () => {
    it('rejects missing, empty, null, undefined, and malformed tokens without calling adminAuth.verifyIdToken', async () => {
      const spy = vi.spyOn(adminAuth, 'verifyIdToken');

      const missing = await request(app).get('/api/auth/me');
      expect(missing.status).toBe(401);

      const empty = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ');
      expect(empty.status).toBe(401);

      const nullStr = await request(app).get('/api/auth/me').set('Authorization', 'Bearer null');
      expect(nullStr.status).toBe(401);

      const undefStr = await request(app).get('/api/auth/me').set('Authorization', 'Bearer undefined');
      expect(undefStr.status).toBe(401);

      const malformed = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.valid.jwt');
      expect(malformed.status).toBe(401);

      expect(spy).not.toHaveBeenCalled();
    });

    it('accepts valid local HS256 token and rejects expired or wrong-secret HS256 tokens without calling Firebase Admin', async () => {
      const spy = vi.spyOn(adminAuth, 'verifyIdToken');

      const loginRes = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      const validLocal = loginRes.body.token;
      const okRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${validLocal}`);
      expect(okRes.status).toBe(200);
      expect(okRes.body.user.username).toBe('admin');

      const expiredLocal = jwt.sign({ id: 1, role: 'ADMIN' }, JWT_SECRET, { expiresIn: -10 });
      const expRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expiredLocal}`);
      expect(expRes.status).toBe(401);

      const wrongSecretLocal = jwt.sign({ id: 1, role: 'ADMIN' }, 'wrong-secret-key', { expiresIn: '1h' });
      const wrongRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${wrongSecretLocal}`);
      expect(wrongRes.status).toBe(401);

      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects RS256 token missing "kid" header claim or whitespace kid BEFORE calling adminAuth.verifyIdToken', async () => {
      const spy = vi.spyOn(adminAuth, 'verifyIdToken');

      const noKidToken = jwt.sign(
        { sub: 'fb-no-kid', email: 'nokid@goldenpalace.dz' },
        rsaPrivateKey,
        { algorithm: 'RS256', expiresIn: '1h' } // No kid header
      );
      const resNoKid = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${noKidToken}`);
      expect(resNoKid.status).toBe(401);

      const blankKidToken = buildFirebaseMockToken(
        { sub: 'fb-blank-kid' },
        { kid: '   ' }
      );
      const resBlankKid = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${blankKidToken}`);
      expect(resBlankKid.status).toBe(401);

      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects expired Firebase RS256+kid token and invalid-signature Firebase RS256+kid token with 401', async () => {
      spyFirebaseWithRealRsaVerification();

      const expiredFbToken = buildFirebaseMockToken(
        { sub: 'fb-expired', email: 'exp@goldenpalace.dz' },
        { kid: 'valid-kid-1', expiresIn: -60 }
      );
      const expRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expiredFbToken}`);
      expect(expRes.status).toBe(401);

      const invalidSigFbToken = buildFirebaseMockToken(
        { sub: 'fb-forged', email: 'forged@goldenpalace.dz' },
        { kid: 'valid-kid-1', key: attackerPrivateKey }
      );
      const forgedRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${invalidSigFbToken}`);
      expect(forgedRes.status).toBe(401);
    });

    it('exercises real Firebase Admin SDK verifyIdToken (unmocked) on RS256+kid token without crashing and rejects forged token cleanly with 401', async () => {
      const forgedWithKid = buildFirebaseMockToken(
        { sub: 'fake-uid', aud: 'demo-project', iss: 'https://securetoken.google.com/demo-project' },
        { kid: 'non-existent-google-kid' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${forgedWithKid}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe('4. Session Management & Token Revocation', () => {
    it('revokes token on POST /api/auth/logout and blocks reuse of the old token while allowing a new login token', async () => {
      const loginRes = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      const oldToken = loginRes.body.token;

      const beforeLogout = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
      expect(beforeLogout.status).toBe(200);

      const logoutRes = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${oldToken}`);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Reusing old token must be rejected
      const reuseRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
      expect(reuseRes.status).toBe(401);

      // New login issues a fresh token that works
      const reloginRes = await request(app).post('/api/auth/pin-login').send({ pin: '1234' });
      expect(reloginRes.status).toBe(200);
      expect(reloginRes.body.token).not.toBe(oldToken);

      const afterRelogin = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${reloginRes.body.token}`);
      expect(afterRelogin.status).toBe(200);
    });
  });

  describe('5. Security: Server-Side RBAC, Authoritative DB State & Log Hygiene', () => {
    it('ignores stale/forged role claims when DB role is downgraded and enforces server-side RBAC', async () => {
      const cashier = await db.select().from(usersTable).where(eqFn(usersTable.username, 'caissier1'));
      const cashierRow = cashier[0];

      // Even if a token somehow claimed role='ADMIN' for caissier1's id, middleware loads authoritative DB role ('CASHIER')
      const tokenWithStaleAdminClaim = signUserToken({
        id: cashierRow.id,
        uid: cashierRow.uid,
        username: cashierRow.username,
        email: cashierRow.email,
        fullName: cashierRow.fullName,
        role: 'ADMIN',
      });

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenWithStaleAdminClaim}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.role).toBe('CASHIER');

      const usersRes = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${tokenWithStaleAdminClaim}`);
      expect(usersRes.status).toBe(403);
    });

    it('allows ADMIN to create user and strips passwordHash from user creation response', async () => {
      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin', password: 'admin123' });
      expect(adminLogin.status).toBe(200);
      const adminToken = adminLogin.body.token;

      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'qa_tester',
          email: 'qa@goldenpalace.dz',
          password: 'SuperSecretPassword99!',
          pin: '7890',
          fullName: 'مختبر الجودة',
          role: 'WAITER',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.username).toBe('qa_tester');
      expect(createRes.body.passwordHash).toBeUndefined();
    });

    it('never logs raw tokens, passwords, or PINs during login, failure, or token rejection', async () => {
      const logs: string[] = [];
      const capture = (...args: any[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      };
      vi.spyOn(console, 'log').mockImplementation(capture);
      vi.spyOn(console, 'warn').mockImplementation(capture);
      vi.spyOn(console, 'error').mockImplementation(capture);

      const secretPass = 'admin123';
      const wrongPass = 'WrongSecretPass!123';
      const secretPin = '1234';
      const wrongPin = '8765';

      const okLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin', password: secretPass });
      const issuedToken = okLogin.body.token;

      await request(app).post('/api/auth/login').send({ identifier: 'admin', password: wrongPass });
      await request(app).post('/api/auth/pin-login').send({ pin: secretPin });
      await request(app).post('/api/auth/pin-login').send({ pin: wrongPin });

      const forgedFb = buildFirebaseMockToken({ sub: 'log-check' }, { kid: 'bad-kid', key: attackerPrivateKey });
      spyFirebaseWithRealRsaVerification();
      await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forgedFb}`);
      await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${issuedToken}`);

      const combinedLogs = logs.join('\n');
      expect(combinedLogs).not.toContain(secretPass);
      expect(combinedLogs).not.toContain(wrongPass);
      expect(combinedLogs).not.toContain(secretPin);
      expect(combinedLogs).not.toContain(wrongPin);
      expect(combinedLogs).not.toContain(issuedToken);
      expect(combinedLogs).not.toContain(forgedFb);
    });
  });
});

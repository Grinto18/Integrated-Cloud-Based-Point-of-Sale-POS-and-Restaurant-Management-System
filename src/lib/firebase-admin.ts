import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

let cachedAuthPromise: Promise<Auth> | null = null;

async function getFirebaseAdminAuth(): Promise<Auth> {
  if (process.env.GOLDEN_PALACE_DESKTOP === '1') {
    const err = new Error('Firebase Admin token verification is disabled in offline desktop mode');
    (err as any).code = 'auth/desktop-offline-mode';
    throw err;
  }
  if (!cachedAuthPromise) {
    cachedAuthPromise = (async () => {
      const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([
        import('firebase-admin/app'),
        import('firebase-admin/auth'),
      ]);
      if (!getApps().length) {
        initializeApp({
          projectId: firebaseConfig.projectId,
        });
      }
      return getAuth();
    })();
  }
  return cachedAuthPromise;
}

export const adminAuth: Auth = {
  async verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<DecodedIdToken> {
    const auth = await getFirebaseAdminAuth();
    return auth.verifyIdToken(idToken, checkRevoked);
  },
} as unknown as Auth;

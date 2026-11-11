import { getFirestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';
import { StateStore } from './types';
import { FirestoreStore } from './firestoreStore';
import { JsonFileStore } from './jsonFileStore';
import { MemoryStore } from './memoryStore';

export * from './types';
export * from './diff';
export * from './firestoreStore';
export * from './jsonFileStore';
export * from './memoryStore';

export interface PersistenceInitResult {
  store: StateStore;
  backend: 'firestore' | 'json' | 'memory';
  isDurable: boolean;
  warning?: string;
}

export async function initPersistenceStore(options: {
  dbFilePath: string;
  firebaseApp?: App;
  firestoreDatabaseId?: string;
}): Promise<PersistenceInitResult> {
  const envBackend = (process.env.PERSISTENCE_BACKEND || '').trim().toLowerCase();

  if (envBackend === 'memory') {
    return {
      store: new MemoryStore(),
      backend: 'memory',
      isDurable: false,
      warning: 'PERSISTENCE_BACKEND=memory configured: State is kept in-memory and will be lost on exit.',
    };
  }

  if (envBackend === 'json') {
    console.warn(`
========================================================================
⚠️  [DATA IS NOT DURABLE] PERSISTENCE_BACKEND=json explicitly set.
Using local JSON file store (${options.dbFilePath}).
State will NOT survive container rebuilds!
========================================================================
`);
    return {
      store: new JsonFileStore(options.dbFilePath),
      backend: 'json',
      isDurable: false,
      warning: 'Local JSON file persistence active (non-durable on cloud restarts).',
    };
  }

  // Attempt Firestore probe if firebaseApp is available
  if (options.firebaseApp && options.firestoreDatabaseId) {
    let db: any = null;
    try {
      db = getFirestore(options.firebaseApp, options.firestoreDatabaseId);

      // Probe read/write with a 5s timeout
      const probeDocRef = db.collection('meta').doc('_probe');
      const probePromise = (async () => {
        await probeDocRef.set({
          probed_at: new Date().toISOString(),
          applet_id: '59050dae-1198-4689-8ee9-041ff01c14b4',
        });
        await probeDocRef.get();
      })();
      probePromise.catch(() => {});

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore probe timed out after 5000ms')), 5000)
      );

      await Promise.race([probePromise, timeoutPromise]);

      console.log(`[PERSISTENCE] ✅ Connected to Firestore database '${options.firestoreDatabaseId}'. Durable persistence ACTIVE.`);
      return {
        store: new FirestoreStore(db),
        backend: 'firestore',
        isDurable: true,
      };
    } catch (err: any) {
      if (db && typeof db.terminate === 'function') {
        try {
          db.terminate().catch(() => {});
        } catch {}
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`
========================================================================
⚠️  [DATA IS NOT DURABLE] Firestore persistence probe failed: ${errMsg}
Falling back to local JSON file store (${options.dbFilePath}).
State will NOT survive container rebuilds!
========================================================================
`);
      return {
        store: new JsonFileStore(options.dbFilePath),
        backend: 'json',
        isDurable: false,
        warning: `Firestore probe failed (${errMsg}). Using non-durable local JSON fallback.`,
      };
    }
  }

  // No Firebase App or Database ID provided
  console.warn(`
========================================================================
⚠️  [DATA IS NOT DURABLE] No Firebase App or firestoreDatabaseId available.
Falling back to local JSON file store (${options.dbFilePath}).
State will NOT survive container rebuilds!
========================================================================
`);

  return {
    store: new JsonFileStore(options.dbFilePath),
    backend: 'json',
    isDurable: false,
    warning: 'No Firestore config found. Using non-durable local JSON fallback.',
  };
}

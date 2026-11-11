import fs from 'fs';
import path from 'path';
import type { App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { FileStore } from './types';
import { LocalDiskStore } from './localDiskStore';
import { FirebaseStorageStore } from './firebaseStorageStore';
import { MemoryFileStore } from './memoryStore';

export * from './types';
export * from './localDiskStore';
export * from './firebaseStorageStore';
export * from './memoryStore';

export interface StorageInitResult {
  store: FileStore;
  backend: 'firebase' | 'local' | 'memory';
  isDurable: boolean;
  warning?: string;
}

export async function initFileStore(options: {
  uploadDir: string;
  firebaseApp?: App;
  storageBucket?: string;
}): Promise<StorageInitResult> {
  const envBackend = (process.env.STORAGE_BACKEND || '').trim().toLowerCase();

  if (envBackend === 'memory') {
    return {
      store: new MemoryFileStore(),
      backend: 'memory',
      isDurable: false,
      warning: 'STORAGE_BACKEND=memory configured: Uploaded files are stored in memory and will be lost on exit.',
    };
  }

  if (envBackend === 'local') {
    console.warn(`
========================================================================
⚠️  [FILES ARE NOT DURABLE] STORAGE_BACKEND=local explicitly set.
Using local disk file store (${options.uploadDir}).
Files will NOT survive container rebuilds!
========================================================================
`);
    return {
      store: new LocalDiskStore(options.uploadDir),
      backend: 'local',
      isDurable: false,
      warning: 'Local disk file storage active (non-durable on cloud restarts).',
    };
  }

  // Attempt Firebase Storage probe if app and bucket are available
  if (options.firebaseApp && options.storageBucket) {
    try {
      const bucket = getStorage(options.firebaseApp).bucket(options.storageBucket);
      const probeFile = bucket.file('_probe/test_probe.txt');

      const probePromise = (async () => {
        await probeFile.save(Buffer.from('probe-check'), {
          contentType: 'text/plain',
          resumable: false,
        });
        const [downloaded] = await probeFile.download();
        if (downloaded.toString() !== 'probe-check') {
          throw new Error('Probe downloaded data mismatch');
        }
        await probeFile.delete();
      })();
      probePromise.catch(() => {});

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firebase Storage probe timed out after 5000ms')), 5000)
      );

      await Promise.race([probePromise, timeoutPromise]);

      console.log(`[STORAGE] ✅ Connected to Firebase Storage bucket '${options.storageBucket}'. Durable file storage ACTIVE.`);
      return {
        store: new FirebaseStorageStore(bucket),
        backend: 'firebase',
        isDurable: true,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`
========================================================================
⚠️  [FILES ARE NOT DURABLE] Firebase Storage probe failed: ${errMsg}
Falling back to local disk store (${options.uploadDir}).
Files will NOT survive container rebuilds!
========================================================================
`);
      return {
        store: new LocalDiskStore(options.uploadDir),
        backend: 'local',
        isDurable: false,
        warning: `Firebase Storage probe failed (${errMsg}). Using non-durable local disk fallback.`,
      };
    }
  }

  console.warn(`
========================================================================
⚠️  [FILES ARE NOT DURABLE] No Firebase App or storageBucket available.
Falling back to local disk store (${options.uploadDir}).
Files will NOT survive container rebuilds!
========================================================================
`);

  return {
    store: new LocalDiskStore(options.uploadDir),
    backend: 'local',
    isDurable: false,
    warning: 'No storage bucket configured. Using non-durable local disk fallback.',
  };
}

export async function migrateExistingUploads(
  state: { materials?: any[]; submissions?: any[] },
  store: FileStore,
  localUploadsDir: string
): Promise<{ migratedCount: number; skippedCount: number }> {
  let migratedCount = 0;
  let skippedCount = 0;

  const referencedFiles = new Map<string, { originalName: string; contentType?: string }>();

  for (const mat of state.materials || []) {
    if (mat.stored_name) {
      referencedFiles.set(mat.stored_name, {
        originalName: mat.original_name || 'material.bin',
        contentType: mat.content_type,
      });
    }
  }

  for (const sub of state.submissions || []) {
    if (sub.stored_name) {
      referencedFiles.set(sub.stored_name, {
        originalName: sub.original_name || 'submission.bin',
        contentType: sub.content_type,
      });
    }
  }

  for (const [storedName, meta] of referencedFiles) {
    try {
      const alreadyInStore = await store.exists(storedName);
      if (alreadyInStore) continue;

      const localPath = path.join(localUploadsDir, path.basename(storedName));
      if (fs.existsSync(localPath)) {
        const buffer = await fs.promises.readFile(localPath);
        await store.putWithId(storedName, buffer, meta);
        migratedCount++;
      } else {
        skippedCount++;
      }
    } catch (err) {
      console.warn(`[STORAGE] Note during file migration for ${storedName}:`, err);
      skippedCount++;
    }
  }

  if (migratedCount > 0 || skippedCount > 0) {
    console.log(`[STORAGE] Migrated ${migratedCount} referenced files to ${store.name} storage (${skippedCount} missing files skipped).`);
  }

  return { migratedCount, skippedCount };
}

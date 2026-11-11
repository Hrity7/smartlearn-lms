import path from 'path';
import crypto from 'crypto';
import { FileStore, FileMeta } from './types';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  type Firestore,
} from 'firebase/firestore';

export class FirestoreFileStore implements FileStore {
  readonly name = 'firestore';
  readonly isDurable = true;
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  private sanitizeName(name: string): string {
    return path.basename(name).replace(/[^a-zA-Z0-9_.-]/g, '_');
  }

  async put(buffer: Buffer, meta: FileMeta): Promise<string> {
    const ext = path.extname(meta.originalName).toLowerCase();
    const storedName = `${Date.now()}_${crypto.randomBytes(16).toString('hex')}${ext}`;
    await this.putWithId(storedName, buffer, meta);
    return storedName;
  }

  async putWithId(storedName: string, buffer: Buffer, meta?: FileMeta): Promise<void> {
    const safeName = this.sanitizeName(storedName);
    const docRef = doc(this.db, 'file_storage', safeName);

    // Split large buffers into chunks (~500KB) to stay safely under Firestore's 1MB doc limit
    const CHUNK_SIZE = 500 * 1024;
    const chunks: string[] = [];
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      chunks.push(buffer.subarray(i, i + CHUNK_SIZE).toString('base64'));
    }

    await setDoc(docRef, {
      stored_name: safeName,
      original_name: meta?.originalName || safeName,
      content_type: meta?.contentType || 'application/octet-stream',
      size: buffer.length,
      chunks,
      created_at: new Date().toISOString(),
    });
  }

  async get(storedName: string): Promise<Buffer | null> {
    const safeName = this.sanitizeName(storedName);
    const docRef = doc(this.db, 'file_storage', safeName);
    try {
      const snap = await getDoc(docRef);
      if (!snap.exists()) return null;
      const data = snap.data();
      if (!data) return null;

      if (Array.isArray(data.chunks)) {
        const buffers = data.chunks.map((c: string) => Buffer.from(c, 'base64'));
        return Buffer.concat(buffers);
      }
      if (typeof data.data === 'string') {
        return Buffer.from(data.data, 'base64');
      }
      return null;
    } catch {
      return null;
    }
  }

  async delete(storedName: string): Promise<boolean> {
    const safeName = this.sanitizeName(storedName);
    const docRef = doc(this.db, 'file_storage', safeName);
    try {
      await deleteDoc(docRef);
      return true;
    } catch {
      return false;
    }
  }

  async exists(storedName: string): Promise<boolean> {
    const safeName = this.sanitizeName(storedName);
    const docRef = doc(this.db, 'file_storage', safeName);
    try {
      const snap = await getDoc(docRef);
      return snap.exists();
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    try {
      const snap = await getDocs(collection(this.db, 'file_storage'));
      return snap.docs.map((d) => d.id);
    } catch {
      return [];
    }
  }
}

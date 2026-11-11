import type { Bucket } from '@google-cloud/storage';
import path from 'path';
import crypto from 'crypto';
import { FileStore, FileMeta } from './types';

export class FirebaseStorageStore implements FileStore {
  readonly name = 'firebase';
  readonly isDurable = true;
  private bucket: Bucket;

  constructor(bucket: Bucket) {
    this.bucket = bucket;
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
    const file = this.bucket.file(safeName);
    await file.save(buffer, {
      contentType: meta?.contentType || 'application/octet-stream',
      resumable: false,
    });
  }

  async get(storedName: string): Promise<Buffer | null> {
    const safeName = this.sanitizeName(storedName);
    const file = this.bucket.file(safeName);
    try {
      const [exists] = await file.exists();
      if (!exists) return null;
      const [buffer] = await file.download();
      return buffer;
    } catch {
      return null;
    }
  }

  async delete(storedName: string): Promise<boolean> {
    const safeName = this.sanitizeName(storedName);
    const file = this.bucket.file(safeName);
    try {
      const [exists] = await file.exists();
      if (!exists) return false;
      await file.delete();
      return true;
    } catch {
      return false;
    }
  }

  async exists(storedName: string): Promise<boolean> {
    const safeName = this.sanitizeName(storedName);
    const file = this.bucket.file(safeName);
    try {
      const [exists] = await file.exists();
      return exists;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    try {
      const [files] = await this.bucket.getFiles();
      return files.map((f) => f.name);
    } catch {
      return [];
    }
  }
}

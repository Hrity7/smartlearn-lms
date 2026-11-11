import path from 'path';
import crypto from 'crypto';
import { FileStore, FileMeta } from './types';

export class MemoryFileStore implements FileStore {
  readonly name = 'memory';
  readonly isDurable = false;
  private files = new Map<string, { buffer: Buffer; meta?: FileMeta }>();

  async put(buffer: Buffer, meta: FileMeta): Promise<string> {
    const ext = path.extname(meta.originalName).toLowerCase();
    const storedName = `${Date.now()}_${crypto.randomBytes(16).toString('hex')}${ext}`;
    await this.putWithId(storedName, buffer, meta);
    return storedName;
  }

  async putWithId(storedName: string, buffer: Buffer, meta?: FileMeta): Promise<void> {
    const safeName = path.basename(storedName);
    this.files.set(safeName, { buffer: Buffer.from(buffer), meta });
  }

  async get(storedName: string): Promise<Buffer | null> {
    const safeName = path.basename(storedName);
    const entry = this.files.get(safeName);
    if (!entry) return null;
    return Buffer.from(entry.buffer);
  }

  async delete(storedName: string): Promise<boolean> {
    const safeName = path.basename(storedName);
    return this.files.delete(safeName);
  }

  async exists(storedName: string): Promise<boolean> {
    const safeName = path.basename(storedName);
    return this.files.has(safeName);
  }

  async list(): Promise<string[]> {
    return Array.from(this.files.keys());
  }
}

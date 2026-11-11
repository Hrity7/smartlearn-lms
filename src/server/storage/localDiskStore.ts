import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FileStore, FileMeta } from './types';

export class LocalDiskStore implements FileStore {
  readonly name = 'local';
  readonly isDurable = false;
  private uploadDir: string;

  constructor(uploadDir: string) {
    this.uploadDir = uploadDir;
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
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

  async putWithId(storedName: string, buffer: Buffer, _meta?: FileMeta): Promise<void> {
    const safeName = this.sanitizeName(storedName);
    const targetPath = path.join(this.uploadDir, safeName);
    const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

    await fs.promises.writeFile(tempPath, buffer);
    await fs.promises.rename(tempPath, targetPath);
  }

  async get(storedName: string): Promise<Buffer | null> {
    const safeName = this.sanitizeName(storedName);
    const targetPath = path.join(this.uploadDir, safeName);
    try {
      if (!fs.existsSync(targetPath)) return null;
      return await fs.promises.readFile(targetPath);
    } catch {
      return null;
    }
  }

  async delete(storedName: string): Promise<boolean> {
    const safeName = this.sanitizeName(storedName);
    const targetPath = path.join(this.uploadDir, safeName);
    try {
      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async exists(storedName: string): Promise<boolean> {
    const safeName = this.sanitizeName(storedName);
    const targetPath = path.join(this.uploadDir, safeName);
    return fs.existsSync(targetPath);
  }

  async list(): Promise<string[]> {
    try {
      return await fs.promises.readdir(this.uploadDir);
    } catch {
      return [];
    }
  }
}

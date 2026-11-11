import fs from 'fs';
import path from 'path';
import { LMSState, DirtyTracker, StateStore } from './types';

export class JsonFileStore implements StateStore {
  readonly name = 'json';
  readonly isDurable = false;
  private filePath: string;
  private counters = new Map<string, number>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<LMSState | null> {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      // Restore counters if stored or compute from existing data
      for (const [key, val] of Object.entries(parsed)) {
        if (Array.isArray(val)) {
          const maxId = val.reduce((m, item) => Math.max(m, Number(item?.id) || 0), 0);
          this.counters.set(key, Math.max(this.counters.get(key) || 0, maxId));
        }
      }

      return parsed as LMSState;
    } catch {
      return null;
    }
  }

  async saveDirty(state: LMSState, _dirty: DirtyTracker): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    const tempFile = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify(state, null, 2);

    await fs.promises.writeFile(tempFile, payload, 'utf-8');
    await fs.promises.rename(tempFile, this.filePath);
  }

  async nextId(collection: string, currentState?: LMSState): Promise<number> {
    let currentVal = this.counters.get(collection);
    if (currentVal === undefined) {
      let baseline = 0;
      if (currentState && Array.isArray((currentState as any)[collection])) {
        const arr = (currentState as any)[collection] as any[];
        baseline = arr.reduce((m, item) => Math.max(m, Number(item?.id) || 0), 0);
      }
      currentVal = baseline;
    }
    const nextVal = currentVal + 1;
    this.counters.set(collection, nextVal);
    return nextVal;
  }
}

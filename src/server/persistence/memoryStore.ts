import { LMSState, DirtyTracker, StateStore } from './types';

export class MemoryStore implements StateStore {
  readonly name = 'memory';
  readonly isDurable = false;
  private state: LMSState | null = null;
  private counters = new Map<string, number>();

  constructor(initialState?: LMSState) {
    if (initialState) {
      this.state = JSON.parse(JSON.stringify(initialState));
    }
  }

  async load(): Promise<LMSState | null> {
    if (!this.state) return null;
    return JSON.parse(JSON.stringify(this.state));
  }

  async saveDirty(state: LMSState, _dirty: DirtyTracker): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state));
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

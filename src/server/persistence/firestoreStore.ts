import {
  Firestore as ClientFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  query,
  limit,
} from 'firebase/firestore';
import {
  LMSState,
  DirtyTracker,
  StateStore,
  ARRAY_COLLECTIONS,
  KEYED_MAP_COLLECTIONS,
} from './types';

const BATCH_CHUNK_SIZE = 400;

export class FirestoreStore implements StateStore {
  readonly name = 'firestore';
  readonly isDurable = true;
  private db: any;
  private localCounters = new Map<string, number>();

  constructor(db: any) {
    this.db = db;
  }

  private isAdmin(): boolean {
    return typeof this.db?.collection === 'function';
  }

  async load(): Promise<LMSState | null> {
    if (this.isAdmin()) {
      // firebase-admin implementation
      const usersSample = await this.db.collection('users').limit(1).get();
      const coursesSample = await this.db.collection('courses').limit(1).get();
      if (usersSample.empty && coursesSample.empty) {
        return null;
      }

      const state: LMSState = {
        users: [],
        courses: [],
        enrollments: [],
        materials: [],
        assignments: [],
        submissions: [],
        announcements: [],
        notifications: [],
        completed_materials: {},
        bookmarked_materials: {},
        student_notes: [],
        quiz_scores: {},
        assessment_attempts: {},
        schedule_events: [],
        jobs: [],
        departments: [],
        subjects: [],
        batches: [],
        audit_logs: [],
        login_activity: [],
        platform_settings: undefined,
        settings: {
          scheduler_policy: 'fcfs',
          time_quantum: 2,
          disk_policy: 'cscan',
          cache_capacity: 6,
        },
      };

      for (const colName of ARRAY_COLLECTIONS) {
        try {
          const snap = await this.db.collection(colName).get();
          const items: any[] = [];
          for (const d of snap.docs) {
            items.push(d.data());
          }
          if (colName === 'audit_logs' || colName === 'login_activity') {
            items.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
          }
          (state as any)[colName] = items;
        } catch (err) {
          console.warn(`[PERSISTENCE] Notice reading collection ${colName}:`, err);
        }
      }

      for (const mapCol of KEYED_MAP_COLLECTIONS) {
        try {
          const snap = await this.db.collection(mapCol).get();
          const map: Record<string, any> = {};
          for (const d of snap.docs) {
            const val = d.data();
            map[d.id] = val && 'value' in val ? val.value : val;
          }
          (state as any)[mapCol] = map;
        } catch (err) {
          console.warn(`[PERSISTENCE] Notice reading map collection ${mapCol}:`, err);
        }
      }

      try {
        const settingsDoc = await this.db.collection('meta').doc('settings').get();
        if (settingsDoc.exists) {
          state.settings = { ...state.settings, ...settingsDoc.data() };
        }
      } catch {}

      try {
        const platformDoc = await this.db.collection('meta').doc('platform_settings').get();
        if (platformDoc.exists) {
          state.platform_settings = platformDoc.data();
        }
      } catch {}

      try {
        const countersDoc = await this.db.collection('meta').doc('counters').get();
        if (countersDoc.exists) {
          const countersData = countersDoc.data() || {};
          for (const [k, v] of Object.entries(countersData)) {
            this.localCounters.set(k, Number(v) || 0);
          }
        }
      } catch {}

      return state;
    }

    // Modular client SDK implementation
    const coursesSample = await getDocs(query(collection(this.db, 'courses'), limit(1)));
    const usersSample = await getDocs(query(collection(this.db, 'users'), limit(1)));
    if (coursesSample.empty && usersSample.empty) {
      return null;
    }

    const state: LMSState = {
      users: [],
      courses: [],
      enrollments: [],
      materials: [],
      assignments: [],
      submissions: [],
      announcements: [],
      notifications: [],
      completed_materials: {},
      bookmarked_materials: {},
      student_notes: [],
      quiz_scores: {},
      assessment_attempts: {},
      schedule_events: [],
      jobs: [],
      departments: [],
      subjects: [],
      batches: [],
      audit_logs: [],
      login_activity: [],
      platform_settings: undefined,
      settings: {
        scheduler_policy: 'fcfs',
        time_quantum: 2,
        disk_policy: 'cscan',
        cache_capacity: 6,
      },
    };

    for (const colName of ARRAY_COLLECTIONS) {
      try {
        const snap = await getDocs(collection(this.db, colName));
        const items: any[] = [];
        for (const d of snap.docs) {
          items.push(d.data());
        }
        if (colName === 'audit_logs' || colName === 'login_activity') {
          items.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
        }
        (state as any)[colName] = items;
      } catch (err) {
        console.warn(`[PERSISTENCE] Notice reading collection ${colName}:`, err);
      }
    }

    for (const mapCol of KEYED_MAP_COLLECTIONS) {
      try {
        const snap = await getDocs(collection(this.db, mapCol));
        const map: Record<string, any> = {};
        for (const d of snap.docs) {
          const val = d.data();
          map[d.id] = val && 'value' in val ? val.value : val;
        }
        (state as any)[mapCol] = map;
      } catch (err) {
        console.warn(`[PERSISTENCE] Notice reading map collection ${mapCol}:`, err);
      }
    }

    try {
      const settingsDoc = await getDoc(doc(this.db, 'meta', 'settings'));
      if (settingsDoc.exists()) {
        state.settings = { ...state.settings, ...settingsDoc.data() };
      }
    } catch {}

    try {
      const platformDoc = await getDoc(doc(this.db, 'meta', 'platform_settings'));
      if (platformDoc.exists()) {
        state.platform_settings = platformDoc.data();
      }
    } catch {}

    try {
      const countersDoc = await getDoc(doc(this.db, 'meta', 'counters'));
      if (countersDoc.exists()) {
        const countersData = countersDoc.data() || {};
        for (const [k, v] of Object.entries(countersData)) {
          this.localCounters.set(k, Number(v) || 0);
        }
      }
    } catch {}

    return state;
  }

  async saveDirty(_state: LMSState, dirty: DirtyTracker): Promise<void> {
    if (!dirty.hasChanges) return;

    interface PendingOp {
      type: 'set' | 'delete';
      col: string;
      docId: string;
      data?: any;
    }

    const operations: PendingOp[] = [];

    for (const [colName, docs] of Object.entries(dirty.upsertedDocs)) {
      for (const [docId, docData] of Object.entries(docs)) {
        operations.push({
          type: 'set',
          col: colName,
          docId,
          data: docData,
        });
      }
    }

    for (const [colName, docIds] of Object.entries(dirty.deletedDocIds)) {
      for (const docId of docIds) {
        operations.push({
          type: 'delete',
          col: colName,
          docId,
        });
      }
    }

    for (const [mapCol, entries] of Object.entries(dirty.upsertedKeyedMaps)) {
      for (const [userId, val] of Object.entries(entries)) {
        operations.push({
          type: 'set',
          col: mapCol,
          docId: userId,
          data: { value: val },
        });
      }
    }

    for (const [mapCol, keys] of Object.entries(dirty.deletedKeyedMapKeys)) {
      for (const key of keys) {
        operations.push({
          type: 'delete',
          col: mapCol,
          docId: key,
        });
      }
    }

    for (const [key, val] of Object.entries(dirty.singletons)) {
      operations.push({
        type: 'set',
        col: 'meta',
        docId: key,
        data: val,
      });
    }

    if (this.isAdmin()) {
      for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
        const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
        const batch = this.db.batch();
        for (const op of chunk) {
          const ref = this.db.collection(op.col).doc(op.docId);
          if (op.type === 'set') {
            batch.set(ref, op.data, { merge: true });
          } else {
            batch.delete(ref);
          }
        }
        await batch.commit();
      }
      return;
    }

    for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
      const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(this.db);
      for (const op of chunk) {
        const ref = doc(this.db, op.col, op.docId);
        if (op.type === 'set') {
          batch.set(ref, op.data);
        } else {
          batch.delete(ref);
        }
      }
      await batch.commit();
    }
  }

  async nextId(collectionName: string, currentState?: LMSState): Promise<number> {
    let currentMax = this.localCounters.get(collectionName) || 0;

    if (currentMax === 0 && currentState) {
      const list = ((currentState as any)[collectionName] || []) as any[];
      for (const item of list) {
        const numericId = Number(item.id);
        if (Number.isFinite(numericId) && numericId > currentMax) {
          currentMax = numericId;
        }
      }
    }

    const nextVal = currentMax + 1;
    this.localCounters.set(collectionName, nextVal);

    try {
      if (this.isAdmin()) {
        await this.db
          .collection('meta')
          .doc('counters')
          .set({ [collectionName]: nextVal }, { merge: true });
      } else {
        await setDoc(
          doc(this.db, 'meta', 'counters'),
          { [collectionName]: nextVal },
          { merge: true }
        );
      }
    } catch {
      // Counter persistence error non-fatal
    }

    return nextVal;
  }
}

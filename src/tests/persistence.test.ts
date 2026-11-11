import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryStore } from '../server/persistence/memoryStore';
import { JsonFileStore } from '../server/persistence/jsonFileStore';
import { diffState } from '../server/persistence/diff';
import type { LMSState } from '../server/persistence/types';
import fs from 'fs';
import path from 'path';

function createSampleState(): LMSState {
  return {
    users: [
      { id: 1, username: 'admin', email: 'admin@smartlearn.edu', role: 'admin' },
      { id: 2, username: 'student1', email: 's1@smartlearn.edu', role: 'student' },
    ],
    courses: [
      { id: 101, code: 'CS101', title: 'Operating Systems', faculty_id: 1 },
      { id: 102, code: 'CS102', title: 'Data Structures', faculty_id: 1 },
    ],
    enrollments: [
      { student_id: 2, course_id: 101, enrolled_at: '2026-01-01T00:00:00Z' },
    ],
    materials: [
      { id: 201, course_id: 101, title: 'Process Scheduling' },
    ],
    assignments: [
      { id: 301, course_id: 101, title: 'CPU Scheduling Lab' },
    ],
    submissions: [
      { id: 401, assignment_id: 301, student_id: 2, grade: 95 },
    ],
    announcements: [
      { id: 501, course_id: 101, title: 'Welcome to CS101' },
    ],
    notifications: [
      { id: 601, user_id: 2, title: 'Assignment Due Soon', is_read: false },
    ],
    completed_materials: {
      '2': [201],
    },
    bookmarked_materials: {
      '2': [201],
    },
    student_notes: [
      { id: 701, user_id: 2, course_id: 101, content: 'Remember Round Robin' },
    ],
    quiz_scores: {
      '2': { '101': 100 },
    },
    assessment_attempts: {},
    schedule_events: [],
    jobs: [],
    departments: [{ id: 1, code: 'CS', name: 'Computer Science' }],
    subjects: [],
    batches: [],
    audit_logs: [{ id: 1, action: 'Seed', details: {} }],
    login_activity: [{ id: 1, username: 'admin', status: 'success' }],
    settings: {
      scheduler_policy: 'priority',
      time_quantum: 2,
      disk_policy: 'sstf',
      cache_capacity: 6,
    },
  };
}

describe('PHASE 2A — Persistence Layer Tests', () => {
  describe('MemoryStore Round-Trip', () => {
    it('should hydrate and persist state correctly', async () => {
      const initial = createSampleState();
      const store = new MemoryStore();

      expect(await store.load()).toBeNull();

      const diff = diffState(initial, null);
      expect(diff.hasChanges).toBe(true);
      await store.saveDirty(initial, diff);

      const loaded = await store.load();
      expect(loaded).not.toBeNull();
      expect(loaded?.users.length).toBe(2);
      expect(loaded?.courses.length).toBe(2);
      expect(loaded?.completed_materials['2']).toEqual([201]);
    });
  });

  describe('diffState Incremental Tracker', () => {
    it('should detect added documents and modified fields without flagging unchanged docs', () => {
      const prev = createSampleState();
      const next = JSON.parse(JSON.stringify(prev)) as LMSState;

      // Unchanged diff
      const unchangedDiff = diffState(next, prev);
      expect(unchangedDiff.hasChanges).toBe(false);
      expect(Object.keys(unchangedDiff.upsertedDocs).length).toBe(0);

      // Add a user, update a course title, delete a course
      next.users.push({ id: 3, username: 'student2', email: 's2@smartlearn.edu', role: 'student' });
      next.courses[0].title = 'Advanced Operating Systems';
      const deletedCourse = next.courses.pop(); // deleted course 102

      const dirty = diffState(next, prev);
      expect(dirty.hasChanges).toBe(true);
      // Upserted users: should contain only user 3
      expect(dirty.upsertedDocs.users).toBeDefined();
      expect(dirty.upsertedDocs.users['3']).toBeDefined();
      expect(dirty.upsertedDocs.users['1']).toBeUndefined();

      // Upserted courses: should contain course 101
      expect(dirty.upsertedDocs.courses['101']).toBeDefined();
      expect(dirty.upsertedDocs.courses['101'].title).toBe('Advanced Operating Systems');

      // Deleted courses: should contain course 102
      expect(dirty.deletedDocIds.courses).toContain(String(deletedCourse?.id));
    });

    it('should track user-keyed map differences', () => {
      const prev = createSampleState();
      const next = JSON.parse(JSON.stringify(prev)) as LMSState;

      next.completed_materials['2'] = [201, 202];
      next.bookmarked_materials['3'] = [201];
      delete next.quiz_scores['2'];

      const dirty = diffState(next, prev);
      expect(dirty.hasChanges).toBe(true);
      expect(dirty.upsertedKeyedMaps.completed_materials['2']).toEqual([201, 202]);
      expect(dirty.upsertedKeyedMaps.bookmarked_materials['3']).toEqual([201]);
      expect(dirty.deletedKeyedMapKeys.quiz_scores).toContain('2');
    });

    it('should track singleton setting changes', () => {
      const prev = createSampleState();
      const next = JSON.parse(JSON.stringify(prev)) as LMSState;

      next.settings.time_quantum = 4;
      const dirty = diffState(next, prev);
      expect(dirty.hasChanges).toBe(true);
      expect(dirty.singletons.settings.time_quantum).toBe(4);
    });
  });

  describe('nextId Monotonicity', () => {
    it('should never repeat an ID even after deletion of the latest item', async () => {
      const store = new MemoryStore();
      const state = createSampleState();

      const id1 = await store.nextId('users', state);
      expect(id1).toBe(3); // previous max was 2, next is 3

      state.users.push({ id: id1, username: 'user3', email: 'u3@smartlearn.edu', role: 'student' });
      const id2 = await store.nextId('users', state);
      expect(id2).toBe(4);

      // Now delete item 4 and item 3 from state
      state.users = state.users.filter((u) => u.id !== id1);

      // nextId should NEVER repeat 3 or 4; it must yield 5!
      const id3 = await store.nextId('users', state);
      expect(id3).toBe(5);
    });
  });

  describe('JsonFileStore Atomic Writes', () => {
    const testFile = path.join(process.cwd(), 'data', 'test_atomic_state.json');

    beforeEach(() => {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    });

    it('should write atomically and read back valid state', async () => {
      const store = new JsonFileStore(testFile);
      const state = createSampleState();

      const diff = diffState(state, null);
      await store.saveDirty(state, diff);

      expect(fs.existsSync(testFile)).toBe(true);
      const loaded = await store.load();
      expect(loaded).not.toBeNull();
      expect(loaded?.users.length).toBe(state.users.length);

      // Cleanup
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    });
  });

  describe('Debounce and Flush Lifecycle', () => {
    it('should coalesce rapid saves and wait on flush', async () => {
      const store = new MemoryStore();
      const saveSpy = vi.spyOn(store, 'saveDirty');

      let hasPending = false;
      let saveTimer: any = null;
      let inFlight: Promise<void> | null = null;
      let flushWaiters: Array<() => void> = [];

      function triggerSave(state: LMSState) {
        hasPending = true;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          doSave(state);
        }, 100);
      }

      function doSave(state: LMSState): Promise<void> {
        if (inFlight) return inFlight;
        if (!hasPending) return Promise.resolve();
        hasPending = false;
        inFlight = (async () => {
          const diff = diffState(state, null);
          await store.saveDirty(state, diff);
          inFlight = null;
          const waiters = flushWaiters.splice(0);
          for (const w of waiters) w();
        })();
        return inFlight;
      }

      async function flush(state: LMSState) {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        if (hasPending || inFlight) {
          doSave(state);
          if (inFlight) await inFlight;
        }
      }

      const sample = createSampleState();

      // Trigger 10 rapid saves
      for (let i = 0; i < 10; i++) {
        triggerSave(sample);
      }

      // Flush immediately
      await flush(sample);

      // Should have coalesced into a single saveDirty call
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });
});

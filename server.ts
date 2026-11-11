import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { initializeApp as initFirebaseApp, getApps as getFirebaseApps } from 'firebase-admin/app';
import { getAuth as getFirebaseAuth, type DecodedIdToken } from 'firebase-admin/auth';
import {
  initPersistenceStore,
  diffState,
  type StateStore,
  type PersistenceInitResult,
} from './src/server/persistence/index';
import multer from 'multer';
import {
  initFileStore,
  migrateExistingUploads,
  type FileStore,
  type StorageInitResult,
} from './src/server/storage/index';
import { z } from 'zod';
import {
  isAiConfigured,
  generateQuestionsWithGemini,
  ModelMalformedResponseError,
} from './src/server/ai/gemini';
import { checkAndIncrementUserAiQuota, refundUserAiQuota } from './src/server/ai/quota';
import { stripHtml } from './src/server/ai/utils';
import type { AiQuestionDraft } from './src/server/ai/types';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_DIR = process.env.LMS_DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const DB_FILE = path.join(DATA_DIR, 'lms_state_v2.json');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_COURSE_STORAGE_BYTES = 50 * 1024 * 1024;

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.txt',
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.docx',
  '.pptx',
  '.xlsx',
  '.zip',
  '.csv',
]);

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

let firebaseAdminInitialized = false;
try {
  const firebaseConfigFile = path.join(__dirname, 'firebase-applet-config.json');
  let projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId && fs.existsSync(firebaseConfigFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(firebaseConfigFile, 'utf-8'));
      projectId = raw.projectId;
    } catch {
      // ignore
    }
  }
  if (projectId) {
    if (getFirebaseApps().length === 0) {
      initFirebaseApp({
        projectId,
      });
    }
    firebaseAdminInitialized = true;
    console.log(`[AUTH] Firebase Admin initialized for project: ${projectId}`);
  }
} catch (err) {
  console.warn('[AUTH] Firebase Admin initialization notice:', err instanceof Error ? err.message : err);
}

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR, REPORT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function trackFor(value: string | number): number {
  const hash = crypto.createHash('sha256').update(String(value)).digest();
  return hash.readUInt16BE(0) % 200;
}

function hashPasswordScrypt(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$16384$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt}$${derivedKey.toString('hex')}`;
}

function hashPassword(password: string): string {
  return hashPasswordSync(password);
}

function generateUnusablePasswordHash(): string {
  return `unusable$${crypto.randomBytes(32).toString('hex')}`;
}

function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!storedHash) return resolve(false);

    // Support legacy SHA-256 hashes: smartlms:<password> sha256 hex
    if (!storedHash.startsWith('scrypt$')) {
      const legacyHash = crypto.createHash('sha256').update(`smartlms:${password}`).digest('hex');
      try {
        const isMatch =
          legacyHash.length === storedHash.length &&
          crypto.timingSafeEqual(Buffer.from(legacyHash, 'hex'), Buffer.from(storedHash, 'hex'));
        return resolve(isMatch);
      } catch {
        return resolve(false);
      }
    }

    const parts = storedHash.split('$');
    if (parts.length !== 4) return resolve(false);
    const [, nStr, salt, hashHex] = parts;
    const cost = parseInt(nStr, 10) || 16384;
    crypto.scrypt(password, salt, 64, { N: cost, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const expectedBuf = Buffer.from(hashHex, 'hex');
        const match =
          derivedKey.length === expectedBuf.length &&
          crypto.timingSafeEqual(derivedKey, expectedBuf);
        resolve(match);
      } catch {
        resolve(false);
      }
    });
  });
}

function validateUploadMagicBytes(buffer: Buffer, ext: string): boolean {
  if (buffer.length === 0) return false;
  switch (ext) {
    case '.pdf':
      return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
    case '.png':
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case '.jpg':
    case '.jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case '.zip':
    case '.docx':
    case '.pptx':
    case '.xlsx':
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
      );
    case '.txt':
    case '.md':
    case '.csv': {
      const checkLen = Math.min(buffer.length, 1024);
      for (let i = 0; i < checkLen; i++) {
        if (buffer[i] === 0) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

interface UserRecord {
  id: number;
  username: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'faculty' | 'student';
  status?: 'active' | 'deactivated';
  created_at: string;
  last_login_at?: string | null;
  department_id?: number | null;
  batch_id?: number | null;
  bio?: string;
  weekly_goal_hours?: number;
  notifications_enabled?: boolean;
  study_streak_days?: number;
  token_version?: number;
}

interface QuizQuestionRecord {
  id: string;
  question: string;
  question_type?: 'mcq' | 'subjective';
  marks?: number;
  options: string[];
  correct_index: number;
  explanation: string;
}

interface CourseRecord {
  id: number;
  code: string;
  title: string;
  category: string;
  level: string;
  estimated_hours: number;
  accent_theme: 'lavender' | 'mint' | 'peach';
  description: string;
  faculty_id: number;
  faculty_title?: string;
  published?: boolean;
  results_published?: boolean;
  approval_status?: 'approved' | 'pending' | 'archived';
  department_id?: number | null;
  created_at: string;
  quiz_questions?: QuizQuestionRecord[];
}

interface EnrollmentRecord {
  student_id: number;
  course_id: number;
  enrolled_at: string;
}

interface MaterialRecord {
  id: number;
  course_id: number;
  module_title: string;
  lesson_number: number;
  duration_minutes: number;
  video_summary: string;
  video_url?: string | null;
  published?: boolean;
  key_takeaways: string[];
  title: string;
  body: string;
  original_name: string | null;
  stored_name: string | null;
  file_size: number;
  content_type: string | null;
  created_by: number;
  created_at: string;
}

interface AssignmentRecord {
  id: number;
  course_id: number;
  title: string;
  description: string;
  due_at: string;
  max_score: number;
  reference_link?: string | null;
  created_by: number;
  created_at: string;
}

interface SubmissionRecord {
  id: number;
  assignment_id: number;
  student_id: number;
  body: string;
  original_name: string | null;
  stored_name: string | null;
  file_size: number;
  content_type: string | null;
  submitted_at: string;
  grade: number | null;
  feedback: string | null;
  graded_at: string | null;
}

interface AnnouncementRecord {
  id: number;
  course_id: number | null;
  target_audience?: 'all' | 'students' | 'teachers' | 'course';
  title: string;
  body: string;
  author_id: number;
  created_at: string;
}

interface DepartmentRecord {
  id: number;
  code: string;
  name: string;
  head_faculty_id: number | null;
  description: string;
  created_at: string;
}

interface AcademicSubjectRecord {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  credits: number;
  semester: string;
  created_at: string;
}

interface ClassBatchRecord {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  academic_year: string;
  semester: string;
  advisor_faculty_id: number | null;
  student_ids: number[];
  course_ids: number[];
  created_at: string;
}

interface AuditLogRecord {
  id: number;
  actor_id: number;
  actor_name: string;
  actor_role: 'admin' | 'faculty' | 'student';
  action: string;
  category: 'user' | 'course' | 'academic' | 'announcement' | 'security' | 'settings' | 'submission';
  target_label: string;
  details: string;
  created_at: string;
}

interface LoginActivityRecord {
  id: number;
  user_id: number | null;
  username: string;
  role: 'admin' | 'faculty' | 'student' | 'unknown';
  status: 'success' | 'failed' | 'blocked';
  message: string;
  timestamp: string;
}

interface PlatformSettingsRecord {
  platform_name: string;
  institution_name: string;
  academic_session: string;
  current_semester: string;
  allow_self_registration: boolean;
  require_course_approval: boolean;
  maintenance_mode: boolean;
  default_weekly_goal_hours: number;
  max_upload_mb: number;
  updated_at: string;
}

interface NotificationRecord {
  id: number;
  user_id: number;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

interface StudentNoteRecord {
  id: number;
  user_id: number;
  course_id: number;
  material_id: number;
  timestamp_label: string;
  content: string;
  created_at: string;
}

interface ScheduleEventRecord {
  id: number;
  user_id: number;
  title: string;
  course_code: string;
  date: string;
  time: string;
  duration_label: string;
  type: 'lecture' | 'deadline' | 'study' | 'workshop';
  location: string;
}

interface JobRecord {
  id: string;
  kind: 'notify' | 'reindex' | 'backup' | 'report' | 'reminders';
  title: string;
  payload: Record<string, unknown>;
  priority: number;
  burst: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: string | null;
  error: string | null;
  worker: string | null;
  elapsed_ms: number | null;
}

interface DatabaseState {
  users: UserRecord[];
  courses: CourseRecord[];
  enrollments: EnrollmentRecord[];
  materials: MaterialRecord[];
  assignments: AssignmentRecord[];
  submissions: SubmissionRecord[];
  announcements: AnnouncementRecord[];
  notifications: NotificationRecord[];
  completed_materials: Record<string, number[]>;
  bookmarked_materials: Record<string, number[]>;
  student_notes: StudentNoteRecord[];
  quiz_scores: Record<string, Record<string, number>>;
  assessment_attempts?: Record<
    string,
    Record<
      string,
      {
        submitted_at: string;
        answers: Record<string, string | number>;
        auto_score_percent: number;
      }
    >
  >;
  schedule_events: ScheduleEventRecord[];
  jobs: JobRecord[];
  departments?: DepartmentRecord[];
  subjects?: AcademicSubjectRecord[];
  batches?: ClassBatchRecord[];
  audit_logs?: AuditLogRecord[];
  login_activity?: LoginActivityRecord[];
  platform_settings?: PlatformSettingsRecord;
  settings: {
    scheduler_policy: 'fcfs' | 'sjf' | 'srtf' | 'priority' | 'rr';
    time_quantum: number;
    disk_policy: 'fcfs' | 'sstf' | 'scan' | 'cscan';
    cache_capacity: number;
  };
}

class ReadersWriterLockTracker {
  active_readers = 0;
  writer_active = false;
  waiting_writers = 0;
  read_operations = 0;
  write_operations = 0;

  read<T>(fn: () => T): T {
    this.active_readers += 1;
    this.read_operations += 1;
    try {
      return fn();
    } finally {
      this.active_readers = Math.max(0, this.active_readers - 1);
    }
  }

  write<T>(fn: () => T): T {
    this.waiting_writers += 1;
    this.writer_active = true;
    this.write_operations += 1;
    this.waiting_writers = Math.max(0, this.waiting_writers - 1);
    try {
      return fn();
    } finally {
      this.writer_active = false;
    }
  }

  snapshot() {
    return {
      active_readers: this.active_readers,
      writer_active: this.writer_active,
      waiting_writers: this.waiting_writers,
      read_operations: this.read_operations,
      write_operations: this.write_operations,
    };
  }
}

class LMSKernelEngine {
  state!: DatabaseState;
  cacheLock = new ReadersWriterLockTracker();
  indexLock = new ReadersWriterLockTracker();

  cachePages = new Map<
    number,
    {
      material: MaterialRecord;
      course_code: string;
      course_title: string;
      loaded_at: string;
      last_accessed: string;
      access_count: number;
    }
  >();
  cacheHits = 0;
  cacheMisses = 0;
  cacheEvictions = 0;

  diskHead = 53;
  diskRequests = 0;
  diskTotalMovement = 0;
  diskLastTrack: number | null = null;
  diskHistory: Array<{
    ticket: number;
    track: number;
    from_track: number;
    movement: number;
    label: string;
    policy: string;
    wait_ms: number;
    at: string;
  }> = [];

  invertedTerms = new Map<string, Map<number, number>>();
  indexedDocs = new Map<
    number,
    { id: number; title: string; course_id: number; course_code: string; course_title: string; snippet: string }
  >();
  indexedAt: string | null = null;

  readonly totalResources: Record<string, number> = { cpu: 3, db: 4, disk: 2 };
  readonly resourceClaims: Record<string, Record<string, number>> = {
    notify: { cpu: 1, db: 1, disk: 0 },
    reindex: { cpu: 1, db: 1, disk: 1 },
    backup: { cpu: 1, db: 1, disk: 2 },
    report: { cpu: 1, db: 2, disk: 1 },
    reminders: { cpu: 1, db: 2, disk: 0 },
  };
  bankerMax = new Map<string, Record<string, number>>();
  bankerAllocation = new Map<string, Record<string, number>>();

  events: Array<{
    id: string;
    at: string;
    component: 'scheduler' | 'banker' | 'memory' | 'disk' | 'index' | 'filesystem' | 'security' | 'lock';
    message: string;
    level: 'info' | 'warning' | 'error';
    details: Record<string, unknown>;
  }> = [];

  runningWorkers = new Map<string, string>();
  isDispatching = false;

  store: StateStore | null = null;
  fileStore: FileStore | null = null;
  lastSnapshot: DatabaseState | null = null;
  persistenceStatus: { backend: string; isDurable: boolean; warning?: string } = {
    backend: 'json',
    isDurable: false,
  };
  storageStatus: { backend: string; isDurable: boolean; warning?: string } = {
    backend: 'local',
    isDurable: false,
  };
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private saveMaxWaitTimer: NodeJS.Timeout | null = null;
  private saveInProgress: Promise<void> | null = null;
  private hasPendingSave = false;
  private flushResolvers: Array<() => void> = [];
  private counters = new Map<string, number>();

  attachFileStore(store: FileStore, status: StorageInitResult) {
    this.fileStore = store;
    this.storageStatus = {
      backend: status.backend,
      isDurable: status.isDurable,
      warning: status.warning,
    };
  }

  constructor() {
    this.initDefaultState();
    this.logEvent('scheduler', 'Background CPU scheduler started', 'info', {
      workers: 3,
      policy: this.state.settings.scheduler_policy.toUpperCase(),
    });
  }

  logEvent(
    component: 'scheduler' | 'banker' | 'memory' | 'disk' | 'index' | 'filesystem' | 'security' | 'lock',
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
    details: Record<string, unknown> = {}
  ) {
    this.events.unshift({
      id: crypto.randomBytes(4).toString('hex'),
      at: nowIso(),
      component,
      message,
      level,
      details,
    });
    if (this.events.length > 160) this.events.length = 160;
  }

  saveState() {
    this.triggerDebouncedSave();
  }

  triggerDebouncedSave() {
    this.hasPendingSave = true;

    if (!this.saveMaxWaitTimer) {
      this.saveMaxWaitTimer = setTimeout(() => {
        this.saveMaxWaitTimer = null;
        this.executeSave();
      }, 2000);
    }

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      if (this.saveMaxWaitTimer) {
        clearTimeout(this.saveMaxWaitTimer);
        this.saveMaxWaitTimer = null;
      }
      this.executeSave();
    }, 500);
  }

  private executeSave(): Promise<void> {
    if (this.saveInProgress) {
      return this.saveInProgress;
    }

    if (!this.hasPendingSave || !this.store) {
      return Promise.resolve();
    }

    this.hasPendingSave = false;
    const currentSnapshot = JSON.parse(JSON.stringify(this.state)) as DatabaseState;
    const dirty = diffState(currentSnapshot as any, this.lastSnapshot as any);

    const savePromise = (async () => {
      try {
        if (dirty.hasChanges && this.store) {
          await this.store.saveDirty(currentSnapshot as any, dirty);
          this.lastSnapshot = currentSnapshot;
        }
      } catch (err) {
        console.error('[PERSISTENCE] Error during debounced state save:', err);
      } finally {
        this.saveInProgress = null;
        if (this.hasPendingSave) {
          this.executeSave();
        } else {
          const waiters = this.flushResolvers.splice(0);
          for (const resolve of waiters) resolve();
        }
      }
    })();

    this.saveInProgress = savePromise;
    return savePromise;
  }

  async flush(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    if (this.saveMaxWaitTimer) {
      clearTimeout(this.saveMaxWaitTimer);
      this.saveMaxWaitTimer = null;
    }

    if (this.hasPendingSave || this.saveInProgress) {
      this.executeSave();
      if (this.saveInProgress) {
        await this.saveInProgress;
      }
      if (this.saveInProgress || this.hasPendingSave) {
        await new Promise<void>((resolve) => {
          this.flushResolvers.push(resolve);
        });
      }
    }
  }

  async attachStore(store: StateStore, status: PersistenceInitResult) {
    this.store = store;
    this.persistenceStatus = {
      backend: status.backend,
      isDurable: status.isDurable,
      warning: status.warning,
    };

    let loadedState: DatabaseState | null = null;
    try {
      loadedState = (await store.load()) as DatabaseState | null;
    } catch (err) {
      console.error('[PERSISTENCE] Error during store.load():', err);
    }

    if (loadedState && loadedState.users && loadedState.users.length > 0) {
      this.state = loadedState;
      if (this.state.audit_logs && this.state.audit_logs.length > 1000) {
        this.state.audit_logs = this.state.audit_logs.slice(-1000);
      }
      if (this.state.login_activity && this.state.login_activity.length > 1000) {
        this.state.login_activity = this.state.login_activity.slice(-1000);
      }
      this.lastSnapshot = JSON.parse(JSON.stringify(this.state));
      console.log(
        `[PERSISTENCE] ✅ Hydrated state from ${store.name}: ${this.state.users.length} users, ${this.state.courses.length} courses.`
      );
    } else if (fs.existsSync(DB_FILE)) {
      console.log(`[PERSISTENCE] Store ${store.name} is empty. Migrating existing local state from ${DB_FILE}...`);
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const diskState = JSON.parse(raw);
        this.state = diskState;
        this.ensureSeedData();
        const diff = diffState(this.state as any, null);
        await store.saveDirty(this.state as any, diff);

        if (store.name === 'firestore') {
          try {
            const db = (store as any).db;
            if (db) {
              await db.collection('meta').doc('migration').set({
                migrated_at: nowIso(),
                source_file: 'data/lms_state_v2.json',
                counts: {
                  users: this.state.users.length,
                  courses: this.state.courses.length,
                  enrollments: this.state.enrollments.length,
                  materials: this.state.materials.length,
                  assignments: this.state.assignments.length,
                  submissions: this.state.submissions.length,
                },
              });
            }
          } catch (mErr) {
            console.warn('[PERSISTENCE] Migration record note:', mErr);
          }
        }
        this.lastSnapshot = JSON.parse(JSON.stringify(this.state));
        console.log(
          `[PERSISTENCE] ✅ Successfully migrated ${this.state.users.length} users, ${this.state.courses.length} courses to ${store.name}.`
        );
      } catch (migErr) {
        console.error('[PERSISTENCE] Migration failed, initializing default state:', migErr);
        this.initDefaultState();
        this.ensureSeedData();
        const diff = diffState(this.state as any, null);
        await store.saveDirty(this.state as any, diff);
        this.lastSnapshot = JSON.parse(JSON.stringify(this.state));
      }
    } else {
      console.log(`[PERSISTENCE] Store ${store.name} is empty and no local file found. Initializing seed data...`);
      this.initDefaultState();
      this.ensureSeedData();
      const diff = diffState(this.state as any, null);
      await store.saveDirty(this.state as any, diff);
      this.lastSnapshot = JSON.parse(JSON.stringify(this.state));
    }

    this.rebuildSearchIndex();
    if (this.state.materials.length > 0) this.getMaterialPage(this.state.materials[0].id);
    if (this.state.materials.length > 1) this.getMaterialPage(this.state.materials[1].id);
  }

  async nextId(collection: string): Promise<number> {
    if (this.store) {
      const id = await this.store.nextId(collection, this.state as any);
      this.counters.set(collection, Math.max(this.counters.get(collection) || 0, id));
      return id;
    }
    return this.nextIdSync(collection);
  }

  nextIdSync(collection: string): number {
    let currentVal = this.counters.get(collection);
    if (currentVal === undefined) {
      let baseline = 0;
      if (Array.isArray((this.state as any)[collection])) {
        baseline = ((this.state as any)[collection] as any[]).reduce(
          (m, x) => Math.max(m, Number(x?.id) || 0),
          0
        );
      }
      currentVal = baseline;
    }
    const nextVal = currentVal + 1;
    this.counters.set(collection, nextVal);
    return nextVal;
  }

  initDefaultState() {
    this.state = {
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
      schedule_events: [],
      jobs: [],
      settings: {
        scheduler_policy: 'priority',
        time_quantum: 2,
        disk_policy: 'sstf',
        cache_capacity: 6,
      },
    };
  }

  recordAuditLog(
    actor: UserRecord,
    category: AuditLogRecord['category'],
    action: string,
    targetLabel: string,
    details: string
  ) {
    if (!this.state.audit_logs) this.state.audit_logs = [];
    const nextId = this.nextIdSync('audit_logs');
    this.state.audit_logs.unshift({
      id: nextId,
      actor_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action,
      category,
      target_label: targetLabel,
      details,
      created_at: nowIso(),
    });
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs = this.state.audit_logs.slice(0, 1000);
    }
  }

  recordLoginActivity(
    user: UserRecord | null,
    usernameInput: string,
    status: 'success' | 'failed' | 'blocked',
    message: string
  ) {
    if (!this.state.login_activity) this.state.login_activity = [];
    const nextId = this.nextIdSync('login_activity');
    this.state.login_activity.unshift({
      id: nextId,
      user_id: user ? user.id : null,
      username: user ? user.username : String(usernameInput || 'unknown'),
      role: user ? user.role : 'unknown',
      status,
      message,
      timestamp: nowIso(),
    });
    if (this.state.login_activity.length > 1000) {
      this.state.login_activity = this.state.login_activity.slice(0, 1000);
    }
  }

  ensureSeedData() {
    const createdAt = nowIso();
    if (!this.state.completed_materials) this.state.completed_materials = {};
    if (!this.state.bookmarked_materials) this.state.bookmarked_materials = {};
    if (!this.state.student_notes) this.state.student_notes = [];
    if (!this.state.quiz_scores) this.state.quiz_scores = {};
    if (!this.state.schedule_events) this.state.schedule_events = [];
    if (!this.state.departments) this.state.departments = [];
    if (!this.state.subjects) this.state.subjects = [];
    if (!this.state.batches) this.state.batches = [];
    if (!this.state.audit_logs) this.state.audit_logs = [];
    if (!this.state.login_activity) this.state.login_activity = [];
    if (!this.state.platform_settings) {
      this.state.platform_settings = {
        platform_name: 'SmartLearn Atelier',
        institution_name: 'SmartLearn Academic Institute',
        academic_session: '2025–2026',
        current_semester: 'Spring Semester',
        allow_self_registration: true,
        require_course_approval: false,
        maintenance_mode: false,
        default_weekly_goal_hours: 14,
        max_upload_mb: 5,
        updated_at: createdAt,
      };
    }

    if (this.state.users.length === 0) {
      const demoEnabled = process.env.LMS_DEMO_MODE === 'true';
      const adminPass = demoEnabled ? 'admin1234' : crypto.randomBytes(12).toString('hex');
      const facultyPass = demoEnabled ? 'faculty1234' : crypto.randomBytes(12).toString('hex');
      const studentPass = demoEnabled ? 'student1234' : crypto.randomBytes(12).toString('hex');

      if (!demoEnabled) {
        console.log('\n[SECURITY] LMS_DEMO_MODE is off. Generated initial secure passwords for seeded accounts:');
        console.log(`  Admin (@admin): ${adminPass}`);
        console.log(`  Faculty (@faculty): ${facultyPass}`);
        console.log(`  Student (@student): ${studentPass}\n`);
      }

      this.state.users = [
        {
          id: 1,
          username: 'admin',
          full_name: 'System Administrator',
          email: 'admin@example.test',
          password_hash: hashPasswordSync(adminPass),
          role: 'admin',
          token_version: 1,
          created_at: createdAt,
          bio: 'Platform Architecture & OS Runtime Administrator.',
          weekly_goal_hours: 15,
          notifications_enabled: true,
          study_streak_days: 18,
        },
        {
          id: 2,
          username: 'faculty',
          full_name: 'Ayushi',
          email: 'faculty@example.test',
          password_hash: hashPasswordSync(facultyPass),
          role: 'faculty',
          token_version: 1,
          created_at: createdAt,
          bio: 'Senior Lecturer in Operating Systems, Visual Design & Interactive Media.',
          weekly_goal_hours: 20,
          notifications_enabled: true,
          study_streak_days: 24,
        },
        {
          id: 3,
          username: 'student',
          full_name: 'Hritwiz',
          email: 'student@example.test',
          password_hash: hashPasswordSync(studentPass),
          role: 'student',
          token_version: 1,
          created_at: createdAt,
          bio: 'Computer Science undergraduate exploring systems architecture, observational drawing, and game design.',
          weekly_goal_hours: 16,
          notifications_enabled: true,
          study_streak_days: 12,
        },
      ];
    }

    const faculty = this.state.users.find((u) => u.role === 'faculty') || this.state.users[0];
    const student = this.state.users.find((u) => u.role === 'student');

    const plusDays = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(23, 59, 0, 0);
      return d.toISOString().slice(0, 16);
    };

    const seedCourses = [
      {
        code: 'OS101',
        title: 'Operating Systems',
        category: 'Computer Science',
        level: 'Intermediate',
        estimated_hours: 18,
        accent_theme: 'lavender' as const,
        faculty_title: 'Associate Professor of Systems Engineering',
        enrollByDefault: true,
        description:
          'A hands-on introduction to process scheduling, synchronization, deadlock avoidance, virtual memory paging, and disk I/O scheduling. Demonstrates how SmartLearn executes real OS algorithms behind the scenes.',
        materials: [
          {
            module_title: 'Module 1 · Kernel Architecture & Scheduling',
            lesson_number: 1,
            duration_minutes: 22,
            video_summary: 'Walkthrough of how user space LMS actions map to kernel process queues, worker threads, and system calls.',
            key_takeaways: [
              'Every background task (notifications, indexing, backups) runs as a scheduled kernel job.',
              'Three concurrent daemon worker threads dispatch jobs from the ready queue.',
              'System state transitions between Queued, Running, and Succeeded.',
            ],
            title: 'Welcome and Course Roadmap',
            body: `Welcome to Operating Systems (OS101).\n\nThis course space includes structured modules, interactive video & slide lectures, downloadable study guides, assignments, announcements, and graded submissions.\n\nThe LMS also demonstrates Operating Systems concepts in its live runtime:\n• A background CPU scheduler dispatches notifications and indexing jobs across worker threads.\n• Dijkstra's Banker's algorithm protects shared kernel resources (CPU, DB, Disk).\n• An LRU page cache serves course content from memory frames.\n• A disk-head scheduler orders application-managed file I/O across cylinders 0–199.\n• Writer-preferring reader/writer locks protect shared search and cache indexes.`,
            fileName: 'OS101_Kernel_Roadmap.txt',
            fileContent:
              'SmartLearn OS101 Study Guide\n1. Process Scheduling: FCFS, SJF, SRTF, Priority with Aging, Round Robin.\n2. Deadlock Avoidance: Dijkstra Banker Algorithm (Max, Allocation, Need, Available).\n3. Virtual Memory: FIFO, LRU, Optimal (Belady), Clock replacement.\n4. Disk Scheduling: FCFS, SSTF, SCAN, C-SCAN.\n',
          },
          {
            module_title: 'Module 1 · Kernel Architecture & Scheduling',
            lesson_number: 2,
            duration_minutes: 28,
            video_summary: 'Comparative analysis of FCFS convoy effects, SJF optimality, Priority Aging, and Round Robin time slicing.',
            key_takeaways: [
              'FCFS is simple but suffers from the convoy effect when long burst jobs arrive first.',
              'SJF and SRTF minimize average waiting time by prioritizing short bursts.',
              'Priority aging prevents indefinite starvation by boosting waiting jobs.',
            ],
            title: 'CPU Process Scheduling & Priority Aging',
            body: `CPU scheduling determines which ready process in the queue is allocated a worker thread next.\n\nKey Policies Implemented in SmartLearn:\n1. First-Come, First-Served (FCFS): Processes execute strictly in arrival sequence. Simple, but susceptible to the convoy effect when a heavy backup job precedes a short notification job.\n2. Shortest Job First (SJF) & SRTF: Prioritizes processes with the smallest estimated CPU burst time, provably minimizing average waiting time.\n3. Priority Scheduling with Aging: Lower numeric priority values execute first (e.g. Priority 1 = Urgent Notification, Priority 4 = Archive Backup). Every waiting interval improves effective priority so background jobs never starve.\n4. Round Robin (RR): Allocates a fixed time quantum to each ready process in circular order for responsive interactive sharing.`,
            fileName: 'CPU_Scheduling_Formulas.txt',
            fileContent:
              'Turnaround Time (TAT) = Completion Time - Arrival Time\nWaiting Time (WT) = Turnaround Time - Burst Time\nResponse Time (RT) = First CPU Dispatch Time - Arrival Time\n',
          },
          {
            module_title: 'Module 2 · Synchronization & Deadlock Avoidance',
            lesson_number: 3,
            duration_minutes: 32,
            video_summary: 'Step-by-step trace of Dijkstra Banker Safety Algorithm and Writer-Preferring Readers/Writer Locks.',
            key_takeaways: [
              'Deadlock requires mutual exclusion, hold and wait, no preemption, and circular wait.',
              'The Banker Safety check verifies a completion sequence <P1, P2, ...> before granting resources.',
              'Writer-preferring R/W locks prevent stale cache reads during index rebuilds.',
            ],
            title: "Banker's Algorithm & Readers/Writer Synchronization",
            body: `Deadlock occurs when a set of processes are blocked because each process holds a resource and waits to acquire a resource held by another process in the same set.\n\nSmartLearn prevents deadlocks dynamically using Dijkstra's Banker's Algorithm:\n• Every background job declares its maximum resource claim vector across CPU Workers (cpu:3), Database Handles (db:4), and Disk Channels (disk:2).\n• When a process requests resources, the kernel tentatively allocates them and runs the Safety Algorithm:\n  1. Initialize Work = Available and Finish[i] = false.\n  2. Find an unfinished process Pi whose remaining Need[i] <= Work.\n  3. Simulate Pi completing and returning its Allocation[i] to Work: Work = Work + Allocation[i], Finish[i] = true.\n  4. If all processes can finish, the state is SAFE and the request is granted; otherwise the process waits cleanly.`,
            fileName: null,
            fileContent: null,
          },
          {
            module_title: 'Module 3 · Virtual Memory & Storage I/O',
            lesson_number: 4,
            duration_minutes: 26,
            video_summary: 'Exploring LRU page frame replacement, Belady anomaly, and SSTF/SCAN disk cylinder seek optimization.',
            key_takeaways: [
              'LRU approximates Optimal page replacement using recency of reference.',
              'Stack algorithms like LRU and OPT never suffer from Belady anomaly.',
              'SSTF and SCAN reduce disk head seek distance by over 60% compared to FCFS.',
            ],
            title: 'Virtual Memory Paging, LRU Caching & Disk Arm Seeking',
            body: `When a student or instructor opens a course lesson in SmartLearn, the kernel queries the in-memory LRU Page Cache before touching storage.\n\n• Cache Hit: The page is served immediately from RAM, its recency position is promoted to Most-Recently-Used (MRU), and disk I/O is bypassed.\n• Cache Miss (Page Fault): The kernel maps the material identifier to a disk cylinder track (0–199) and submits a read operation to the Disk I/O Scheduler. Once read, the page is inserted into the cache, evicting the Least-Recently-Used page if all frames are full.`,
            fileName: null,
            fileContent: null,
          },
        ],
        assignments: [
          {
            title: 'Process Scheduling Reflection',
            description:
              'Compare FCFS, shortest-job-first, priority scheduling, and round robin. Explain one trade-off and include a small worked example with Turnaround Time and Waiting Time.',
            dueDays: 5,
            maxScore: 100,
          },
          {
            title: "Banker's Algorithm & Page Replacement Lab",
            description:
              "Test the 5-process Banker's safety sequence on Available=(3,3,2) and compare FIFO, LRU, and Optimal page replacement on the 20-page reference string. Submit your numeric findings.",
            dueDays: 11,
            maxScore: 100,
          },
        ],
        announcement: {
          title: 'Welcome to Operating Systems',
          body: 'Start with the roadmap material and introduce yourself in the first discussion. Use the interactive OS Kernel & Simulators view to verify your scheduling and page replacement traces.',
        },
        quiz_questions: [
          {
            id: 'os-q1',
            question: 'Which CPU scheduling policy is provably optimal for minimizing average waiting time for a given set of non-preemptive processes?',
            options: [
              'First-Come, First-Served (FCFS)',
              'Shortest Job First (SJF)',
              'Round Robin (RR)',
              'Multilevel Feedback Queue',
            ],
            correct_index: 1,
            explanation: 'Moving shorter jobs before longer jobs reduces the waiting time of the short jobs more than it increases the waiting time of the long jobs.',
          },
          {
            id: 'os-q2',
            question: 'On the classic 20-page reference trace [7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1] with 3 frames, how many page faults occur under LRU?',
            options: ['15 faults', '12 faults', '9 faults', '6 faults'],
            correct_index: 1,
            explanation: 'With 3 frames on this classic Silberschatz reference string, FIFO produces 15 faults, LRU produces 12 faults, and OPT produces 9 faults.',
          },
          {
            id: 'os-q3',
            question: "What does Dijkstra's Banker's Algorithm check before granting a resource request?",
            options: [
              'Whether at least one CPU worker thread is idle',
              'Whether the tentative allocation leaves a safe execution sequence where all processes can finish',
              'Whether the disk head is at cylinder 0',
              'Whether the LRU cache is below 50% capacity',
            ],
            correct_index: 1,
            explanation: "Banker's algorithm simulates granting the request and verifies that a safe completion sequence <P1, P2, ...> still exists.",
          },
        ],
      },
      {
        code: 'DRAW101',
        title: 'Drawing & Visual Observation',
        category: 'Creative Arts',
        level: 'Beginner',
        estimated_hours: 12,
        accent_theme: 'peach' as const,
        faculty_title: 'Studio Instructor in Fine Arts & Illustration',
        enrollByDefault: true,
        description:
          'Build drawing confidence through visual observation, line weight control, shape construction, proportion sighting, tonal shading, and spatial composition exercises.',
        materials: [
          {
            module_title: 'Module 1 · Line, Contour & Sighting',
            lesson_number: 1,
            duration_minutes: 18,
            video_summary: 'Warming up from the shoulder, ghosting lines, and breaking everyday objects into primary geometric solids.',
            key_takeaways: [
              'Draw from the shoulder and elbow for smooth, confident trajectories.',
              'Simplify complex subjects into spheres, cylinders, cones, and boxes first.',
              'Consistent 15-minute daily observation beats occasional marathon sessions.',
            ],
            title: 'Drawing Starter Guide',
            body: `Start with a pencil, plain paper, and an eraser.\n\nWarm up with straight and curved lines, then break everyday objects into simple shapes. Practice contour, proportion, light and shadow, and composition. Short, regular observation sessions are more valuable than trying to make every sketch perfect.`,
            fileName: 'DRAW101_Warmup_Drills.txt',
            fileContent:
              'Daily 15-Minute Drawing Routine:\n1. 3 mins: Ghosted straight lines & point-to-point connections\n2. 4 mins: Ellipses in planes at varying degrees\n3. 8 mins: Blind & modified contour study of a desk object\n',
          },
          {
            module_title: 'Module 2 · Light Logic & Tonal Value',
            lesson_number: 2,
            duration_minutes: 24,
            video_summary: 'Understanding the terminator line, core shadow, reflected light, and cast shadow geometry.',
            key_takeaways: [
              'Separate the Light Family from the Shadow Family before adding midtones.',
              'Squinting compresses local detail so you can judge big value relationships.',
              'Reflected light in the shadow family is never brighter than the halftone in the light family.',
            ],
            title: 'Light, Shadow & Three-Value Studies',
            body: `Form is revealed through light and shadow. Every lit object exhibits two distinct families: the Light Family (highlight, halftone) and the Shadow Family (core shadow, reflected light, occlusion shadow, cast shadow).\n\nSquint at your subject to compress subtle midtones and establish a clear separation between light and shadow shapes first.`,
            fileName: null,
            fileContent: null,
          },
        ],
        assignments: [
          {
            title: 'Everyday Object Study',
            description:
              'Choose one everyday object and make a study focused on contour, proportion, and light. Submit a photo, scan, or detailed written reflection of your drawing process.',
            dueDays: 9,
            maxScore: 100,
          },
        ],
        announcement: {
          title: 'Welcome to Drawing',
          body: 'Bring a pencil and paper to the first session. Begin observing simple forms around you; no special supplies are required.',
        },
        quiz_questions: [
          {
            id: 'draw-q1',
            question: 'When constructing a complex everyday object like a ceramic coffee mug, what is the recommended first step?',
            options: [
              'Render the specular highlights immediately',
              'Establish the major geometric volumes (cylinder & axis symmetry) with light construction lines',
              'Shade the background dark',
              'Draw only the handle in final ink',
            ],
            correct_index: 1,
            explanation: 'Blocking in the major geometric volumes and central axis ensures accurate proportion and symmetry before committing to surface details.',
          },
        ],
      },
      {
        code: 'GAME101',
        title: 'Game Design & Interactive Systems',
        category: 'Game Design',
        level: 'Beginner',
        estimated_hours: 14,
        accent_theme: 'mint' as const,
        faculty_title: 'Lead Interactive Systems Designer',
        enrollByDefault: true,
        description:
          'Explore game genres, mechanics, core gameplay loops, player feedback systems, teamwork dynamics, accessibility, and responsible game design.',
        materials: [
          {
            module_title: 'Module 1 · Mechanics, Dynamics & Aesthetics',
            lesson_number: 1,
            duration_minutes: 20,
            video_summary: 'Deconstructing the 30-second core gameplay loop: player action, system response, reward, and progression.',
            key_takeaways: [
              'A game combines rules, goals, feedback, and meaningful player choices.',
              'The core loop repeats every 15–60 seconds and must feel intrinsically rewarding.',
              'Clear audiovisual and UI feedback closes the loop between player intent and outcome.',
            ],
            title: 'Game Design and Play',
            body: `A game combines rules, goals, feedback, and player choices.\n\nNotice the core loop: what the player does, what response the game gives, and why the player wants to continue. Compare mechanics across genres and consider accessibility, fair play, collaboration, and healthy play habits.`,
            fileName: 'GAME101_Core_Loop_Canvas.txt',
            fileContent:
              'Core Loop Analysis Template:\n1. Action (Player Verb):\n2. Challenge / Obstacle:\n3. Reward / Feedback:\n4. Upgrade / Reinvestment into next cycle:\n',
          },
          {
            module_title: 'Module 2 · Inclusive & Accessible Play',
            lesson_number: 2,
            duration_minutes: 25,
            video_summary: 'Designing readable HUDs, multi-modal state cues, remappable inputs, and cognitive accessibility.',
            key_takeaways: [
              'Never rely on color alone to signal danger, team state, or puzzle clues.',
              'Configurable assist modes broaden your audience without diluting core mastery.',
            ],
            title: 'Accessibility, Fair Play & Player Experience',
            body: `Great game design removes unintentional barriers while preserving intentional challenge.\n\nConsider remappable controls, high-contrast visual cues paired with distinct iconography, readable typography, and configurable difficulty assist modes so players of varied motor and sensory abilities can enjoy the game.`,
            fileName: null,
            fileContent: null,
          },
        ],
        assignments: [
          {
            title: 'Game Loop Review',
            description:
              'Pick a game you know. Describe its core gameplay loop, one mechanic that works well, and one change that could improve accessibility or player experience.',
            dueDays: 14,
            maxScore: 100,
          },
        ],
        announcement: {
          title: 'Welcome to Gaming',
          body: 'For our first discussion, bring an example of a game mechanic that makes a game engaging, fair, or easy to learn.',
        },
        quiz_questions: [
          {
            id: 'game-q1',
            question: 'Which element is essential for closing a game core loop after the player performs an action?',
            options: [
              'An unskippable cutscene',
              'Clear, immediate system feedback communicating the result of the choice',
              'A leaderboard reset',
              'Removing all rules',
            ],
            correct_index: 1,
            explanation: 'Immediate, legible feedback lets the player understand the consequence of their action and form their next mental model.',
          },
        ],
      },
      {
        code: 'UIX105',
        title: 'Minimalist UI & Tactile Claymorphism',
        category: 'Creative Arts',
        level: 'Intermediate',
        estimated_hours: 10,
        accent_theme: 'lavender' as const,
        faculty_title: 'Principal Product Designer',
        enrollByDefault: false,
        description:
          'Master calm, distraction-free interface design using generous whitespace, soft claymorphic elevation, subtle inner highlights, and accessible typography.',
        materials: [
          {
            module_title: 'Module 1 · Tactile Depth & Calm Hierarchy',
            lesson_number: 1,
            duration_minutes: 19,
            video_summary: 'Crafting soft outer shadows paired with subtle top-left inner highlights on warm off-white canvases.',
            key_takeaways: [
              'Restrained claymorphism uses diffuse outer shadows and subtle inner highlights.',
              'Consistent border radii (14px controls, 22px panels) unify spatial rhythm.',
            ],
            title: 'Principles of Restrained Claymorphism',
            body: `Claymorphism brings tactile warmth to minimalist digital interfaces without visual clutter.\n\nBy pairing a warm off-white canvas (#F7F7F2) with soft rounded cards, subtle top inner highlights, and diffuse ambient shadows, interfaces feel approachable, calm, and physical.`,
            fileName: null,
            fileContent: null,
          },
        ],
        assignments: [],
        announcement: {
          title: 'Welcome to Minimalist UI & Tactile Claymorphism',
          body: 'Explore the design tokens and component guidelines in Module 1.',
        },
        quiz_questions: [],
      },
      {
        code: 'SYS202',
        title: 'Distributed Systems & Consensus',
        category: 'Computer Science',
        level: 'Advanced',
        estimated_hours: 20,
        accent_theme: 'mint' as const,
        faculty_title: 'Professor of Distributed Computing',
        enrollByDefault: false,
        description:
          'Understand logical clocks, Raft consensus, replicated state machines, partition tolerance, and distributed transaction protocols.',
        materials: [
          {
            module_title: 'Module 1 · Time, Order & Raft Consensus',
            lesson_number: 1,
            duration_minutes: 30,
            video_summary: 'Lamport timestamps, vector clocks, and leader election in the Raft consensus algorithm.',
            key_takeaways: [
              'Physical clocks drift; Lamport happens-before ordering establishes causal sequence.',
              'Raft decomposes consensus into Leader Election, Log Replication, and Safety.',
            ],
            title: 'Logical Clocks & Raft Leader Election',
            body: `In a distributed system without a single global clock, nodes coordinate state using logical timestamps and quorum-based consensus.\n\nExplore how Raft guarantees safety across network partitions using randomized election timeouts and majority log replication.`,
            fileName: null,
            fileContent: null,
          },
        ],
        assignments: [],
        announcement: {
          title: 'Welcome to Distributed Systems',
          body: 'Prerequisite: Operating Systems (OS101) synchronization and concurrency.',
        },
        quiz_questions: [],
      },
      {
        code: 'AI301',
        title: 'Applied Machine Learning Systems',
        category: 'Data & Systems',
        level: 'Intermediate',
        estimated_hours: 16,
        accent_theme: 'peach' as const,
        faculty_title: 'Applied ML Research Lead',
        enrollByDefault: false,
        description:
          'Design end-to-end machine learning pipelines, feature stores, evaluation benchmarks, and low-latency model serving architectures.',
        materials: [
          {
            module_title: 'Module 1 · Data Pipelines & Evaluation Rigor',
            lesson_number: 1,
            duration_minutes: 24,
            video_summary: 'Preventing data leakage, constructing stratified validation splits, and monitoring inference drift.',
            key_takeaways: [
              'Data quality and evaluation discipline matter more than model complexity.',
              'Always isolate validation transforms to prevent train-test leakage.',
            ],
            title: 'Reproducible ML Pipelines & Validation',
            body: `Production machine learning requires systematic data versioning, leak-free validation splits, and calibrated error analysis across slices.`,
            fileName: null,
            fileContent: null,
          },
        ],
        assignments: [],
        announcement: {
          title: 'Welcome to Applied ML Systems',
          body: 'Review the syllabus and validation checklist in Module 1.',
        },
        quiz_questions: [],
      },
    ];

    for (const spec of seedCourses) {
      let course = this.state.courses.find((c) => c.code.toLowerCase() === spec.code.toLowerCase());
      if (!course) {
        const nextId = this.nextIdSync('courses');
        course = {
          id: nextId,
          code: spec.code,
          title: spec.title,
          category: spec.category,
          level: spec.level,
          estimated_hours: spec.estimated_hours,
          accent_theme: spec.accent_theme,
          description: spec.description,
          faculty_id: faculty.id,
          faculty_title: spec.faculty_title,
          created_at: createdAt,
          quiz_questions: spec.quiz_questions,
        };
        this.state.courses.push(course);

        for (const mat of spec.materials) {
          let storedName: string | null = null;
          let fileSize = 0;
          let contentType: string | null = null;
          if (mat.fileName && mat.fileContent) {
            const buf = Buffer.from(mat.fileContent, 'utf-8');
            const saved = this.saveUploadInternal(mat.fileName, buf);
            storedName = saved.storedName;
            fileSize = saved.size;
            contentType = saved.contentType;
          }
          const matId = this.nextIdSync('materials');
          this.state.materials.push({
            id: matId,
            course_id: course.id,
            module_title: mat.module_title,
            lesson_number: mat.lesson_number,
            duration_minutes: mat.duration_minutes,
            video_summary: mat.video_summary,
            key_takeaways: mat.key_takeaways,
            title: mat.title,
            body: mat.body,
            original_name: mat.fileName,
            stored_name: storedName,
            file_size: fileSize,
            content_type: contentType,
            created_by: faculty.id,
            created_at: createdAt,
          });
        }

        for (const asgn of spec.assignments) {
          const asgnId = this.nextIdSync('assignments');
          this.state.assignments.push({
            id: asgnId,
            course_id: course.id,
            title: asgn.title,
            description: asgn.description,
            due_at: plusDays(asgn.dueDays),
            max_score: asgn.maxScore,
            created_by: faculty.id,
            created_at: createdAt,
          });
        }

        const annId = this.nextIdSync('announcements');
        this.state.announcements.push({
          id: annId,
          course_id: course.id,
          title: spec.announcement.title,
          body: spec.announcement.body,
          author_id: faculty.id,
          created_at: createdAt,
        });
      }

      if (student && spec.enrollByDefault) {
        const exists = this.state.enrollments.some(
          (e) => e.student_id === student.id && e.course_id === course!.id
        );
        if (!exists) {
          this.state.enrollments.push({
            student_id: student.id,
            course_id: course.id,
            enrolled_at: createdAt,
          });
        }
      }
    }

    // Seed initial completed lessons for Hritwiz so progress bars look realistic right away
    if (student && (!this.state.completed_materials[String(student.id)] || this.state.completed_materials[String(student.id)].length === 0)) {
      const osMats = this.state.materials.filter((m) => m.course_id === 1);
      const drawMats = this.state.materials.filter((m) => m.course_id === 2);
      const initialDone: number[] = [];
      if (osMats[0]) initialDone.push(osMats[0].id);
      if (osMats[1]) initialDone.push(osMats[1].id);
      if (drawMats[0]) initialDone.push(drawMats[0].id);
      this.state.completed_materials[String(student.id)] = initialDone;
    }

    // Seed initial student note for Hritwiz
    if (student && this.state.student_notes.length === 0 && this.state.materials.length > 0) {
      this.state.student_notes.push({
        id: 1,
        user_id: student.id,
        course_id: 1,
        material_id: this.state.materials[0].id,
        timestamp_label: '08:15',
        content: 'Key insight: Banker algorithm checks Need <= Work across all active worker claims before granting Disk or DB handles.',
        created_at: createdAt,
      });
    }

    // Seed schedule events if empty
    if (student && this.state.schedule_events.length === 0) {
      this.state.schedule_events = [
        {
          id: 1,
          user_id: student.id,
          title: 'OS101 Live Kernel Lab: CPU Scheduling & Deadlocks',
          course_code: 'OS101',
          date: 'Monday',
          time: '10:00 AM',
          duration_label: '60 min',
          type: 'lecture',
          location: 'Systems Lab 302 / Online',
        },
        {
          id: 2,
          user_id: student.id,
          title: 'DRAW101 Observational Contour & Light Studio',
          course_code: 'DRAW101',
          date: 'Tuesday',
          time: '02:00 PM',
          duration_label: '90 min',
          type: 'workshop',
          location: 'Design Studio B',
        },
        {
          id: 3,
          user_id: student.id,
          title: 'Focused Study Block: Banker Safety Sequence Practice',
          course_code: 'OS101',
          date: 'Wednesday',
          time: '04:30 PM',
          duration_label: '45 min',
          type: 'study',
          location: 'Personal Study Desk',
        },
        {
          id: 4,
          user_id: student.id,
          title: 'GAME101 Seminar: Core Loops & Player Feedback',
          course_code: 'GAME101',
          date: 'Thursday',
          time: '11:30 AM',
          duration_label: '60 min',
          type: 'lecture',
          location: 'Media Hall 104',
        },
        {
          id: 5,
          user_id: student.id,
          title: 'Assignment Due: Process Scheduling Reflection',
          course_code: 'OS101',
          date: 'Friday',
          time: '11:59 PM',
          duration_label: 'Deadline',
          type: 'deadline',
          location: 'SmartLearn Portal',
        },
      ];
    }

    if (student && this.state.notifications.length === 0) {
      this.state.notifications.push(
        {
          id: 1,
          user_id: student.id,
          title: 'Welcome to SmartLearn',
          body: 'You are enrolled in Operating Systems (OS101), Drawing (DRAW101), and Gaming (GAME101). Continue your next lesson to keep your 12-day streak alive!',
          link: '/courses/1',
          is_read: false,
          created_at: createdAt,
        },
        {
          id: 2,
          user_id: student.id,
          title: 'Upcoming Deadline: Process Scheduling Reflection',
          body: 'Your reflection assignment for Operating Systems (OS101) is due in 5 days.',
          link: '/assignments/1',
          is_read: false,
          created_at: createdAt,
        }
      );
    }

    if (this.state.jobs.length === 0) {
      this.state.jobs.push(
        {
          id: 'c81a4f09d12e',
          kind: 'reindex',
          title: 'Rebuild course material search index',
          payload: {},
          priority: 3,
          burst: 3,
          status: 'succeeded',
          submitted_at: createdAt,
          started_at: createdAt,
          finished_at: createdAt,
          result: JSON.stringify({ indexed_materials: this.state.materials.length }),
          error: null,
          worker: 'lms-worker-1',
          elapsed_ms: 18,
        },
        {
          id: 'a90e21b73c41',
          kind: 'reminders',
          title: 'Check assignments due in the next 48 hours',
          payload: {},
          priority: 2,
          burst: 2,
          status: 'succeeded',
          submitted_at: createdAt,
          started_at: createdAt,
          finished_at: createdAt,
          result: JSON.stringify({ assignments_checked: this.state.assignments.length, reminders_queued: 1 }),
          error: null,
          worker: 'lms-worker-2',
          elapsed_ms: 14,
        }
      );
    }

    // Non-destructively ensure status and approval fields on existing records
    for (const u of this.state.users) {
      if (!u.status) u.status = 'active';
      if (u.last_login_at === undefined) u.last_login_at = null;
      if (u.department_id === undefined) u.department_id = null;
      if (u.batch_id === undefined) u.batch_id = null;
    }
    for (const c of this.state.courses) {
      if (c.published === undefined) c.published = true;
      if (!c.approval_status) c.approval_status = 'approved';
      if (c.department_id === undefined) c.department_id = null;
    }
    for (const a of this.state.announcements) {
      if (!a.target_audience) {
        a.target_audience = a.course_id ? 'course' : 'all';
      }
    }
  }

  performDiskIo<T>(track: number, label: string, fn: () => T): { result: T; movement: number; track: number } {
    const cleanTrack = Math.max(0, Math.min(199, Math.floor(track)));
    const prev = this.diskHead;
    const movement = Math.abs(cleanTrack - prev);
    this.diskHead = cleanTrack;
    this.diskTotalMovement += movement;
    this.diskRequests += 1;
    this.diskLastTrack = cleanTrack;

    const record = {
      ticket: this.diskRequests,
      track: cleanTrack,
      from_track: prev,
      movement,
      label,
      policy: this.state.settings.disk_policy.toUpperCase(),
      wait_ms: Math.max(1, Math.round(movement * 0.15)),
      at: nowIso(),
    };
    this.diskHistory.unshift(record);
    if (this.diskHistory.length > 40) this.diskHistory.length = 40;

    const result = fn();
    this.logEvent('disk', 'Application I/O completed', 'info', {
      ticket: record.ticket,
      label,
      track: cleanTrack,
      head_movement: movement,
      policy: record.policy,
    });
    return { result, movement, track: cleanTrack };
  }

  async saveUpload(filename: string, buffer: Buffer) {
    if (!buffer || buffer.length === 0) {
      throw new Error('The uploaded file is empty.');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('Each file must be 5 MB or smaller.');
    }
    const base = path.basename(filename || 'upload.txt').replace(/[\x00-\x1f\x7f]/g, '').trim() || 'upload.txt';
    const ext = path.extname(base).toLowerCase();

    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new Error(
        `File extension "${ext}" is not permitted. Allowed extensions: ${Array.from(ALLOWED_UPLOAD_EXTENSIONS).join(', ')}`
      );
    }

    if (!validateUploadMagicBytes(buffer, ext)) {
      throw new Error(`File content does not match the valid signature for "${ext}".`);
    }

    const isText = ext === '.txt' || ext === '.md' || ext === '.csv';
    const isImage = ext === '.png' || ext === '.jpg' || ext === '.jpeg';
    const isPdf = ext === '.pdf';
    const contentType = isText
      ? 'text/plain; charset=utf-8'
      : isPdf
      ? 'application/pdf'
      : isImage
      ? `image/${ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png'}`
      : 'application/octet-stream';

    let storedName: string;
    if (this.fileStore) {
      storedName = await this.fileStore.put(buffer, {
        originalName: base,
        contentType,
        size: buffer.length,
      });
    } else {
      storedName = `${Date.now()}_${crypto.randomBytes(16).toString('hex')}${ext}`;
      const dest = path.join(UPLOAD_DIR, storedName);
      fs.writeFileSync(dest, buffer);
    }

    this.diskRequests += 1;
    this.logEvent('filesystem', 'Upload stored with verified signature', 'info', {
      original_name: base,
      stored_name: storedName,
      bytes: buffer.length,
      ext,
    });

    return {
      originalName: base,
      storedName,
      size: buffer.length,
      contentType,
    };
  }

  async readUpload(storedName: string): Promise<Buffer> {
    if (!storedName || typeof storedName !== 'string') {
      throw new Error('Unknown stored file');
    }
    const cleanName = path.basename(storedName);
    let buf: Buffer | null = null;
    if (this.fileStore) {
      buf = await this.fileStore.get(cleanName);
    }
    if (!buf) {
      const filePath = path.join(UPLOAD_DIR, cleanName);
      if (fs.existsSync(filePath)) {
        buf = fs.readFileSync(filePath);
      }
    }
    if (!buf) {
      throw new Error('The uploaded file is no longer available');
    }
    this.diskRequests += 1;
    return buf;
  }

  saveUploadInternal(filename: string, buffer: Buffer) {
    if (!buffer || buffer.length === 0) {
      throw new Error('The uploaded file is empty.');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('Each file must be 5 MB or smaller.');
    }
    const base = path.basename(filename || 'upload.txt').replace(/[\x00-\x1f\x7f]/g, '').trim() || 'upload.txt';
    const ext = path.extname(base).toLowerCase();
    
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new Error(
        `File extension "${ext}" is not permitted. Allowed extensions: ${Array.from(ALLOWED_UPLOAD_EXTENSIONS).join(', ')}`
      );
    }

    if (!validateUploadMagicBytes(buffer, ext)) {
      throw new Error(`File content does not match the valid signature for "${ext}".`);
    }

    const safeExt = ext;
    const storedName = `${crypto.randomBytes(16).toString('hex')}${safeExt}`;
    const dest = path.join(UPLOAD_DIR, storedName);

    this.performDiskIo(trackFor(storedName), `upload ${base}`, () => {
      fs.writeFileSync(dest, buffer);
    });

    this.logEvent('filesystem', 'Upload stored with verified signature', 'info', {
      original_name: base,
      stored_name: storedName,
      bytes: buffer.length,
      ext: safeExt,
    });

    const isText = ext === '.txt' || ext === '.md' || ext === '.csv';
    const isImage = ext === '.png' || ext === '.jpg' || ext === '.jpeg';
    const isPdf = ext === '.pdf';

    return {
      originalName: base,
      storedName,
      size: buffer.length,
      contentType: isText
        ? 'text/plain; charset=utf-8'
        : isPdf
        ? 'application/pdf'
        : isImage
        ? `image/${ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png'}`
        : 'application/octet-stream',
    };
  }

  readUploadInternal(storedName: string): Buffer {
    if (!/^[0-9a-f]{32}\.[a-z0-9]{1,10}$/.test(storedName || '')) {
      throw new Error('Unknown stored file');
    }
    const filePath = path.join(UPLOAD_DIR, storedName);
    if (!fs.existsSync(filePath)) {
      throw new Error('The uploaded file is no longer available');
    }
    return this.performDiskIo(trackFor(storedName), `download ${storedName}`, () => fs.readFileSync(filePath)).result;
  }

  courseStorageUsed(courseId: number): number {
    const matBytes = this.state.materials
      .filter((m) => m.course_id === courseId)
      .reduce((sum, m) => sum + (m.file_size || 0), 0);
    const asgnIds = new Set(this.state.assignments.filter((a) => a.course_id === courseId).map((a) => a.id));
    const subBytes = this.state.submissions
      .filter((s) => asgnIds.has(s.assignment_id))
      .reduce((sum, s) => sum + (s.file_size || 0), 0);
    return matBytes + subBytes;
  }

  getMaterialPage(materialId: number): {
    material: MaterialRecord | null;
    course_code: string;
    course_title: string;
    cache_hit: boolean;
    evicted_id: number | null;
    disk_track: number;
    disk_movement: number;
  } {
    const cached = this.cacheLock.read(() => this.cachePages.get(materialId));
    const track = trackFor(`material:${materialId}`);

    if (cached) {
      this.cacheLock.write(() => {
        this.cachePages.delete(materialId);
        cached.last_accessed = nowIso();
        cached.access_count += 1;
        this.cachePages.set(materialId, cached);
      });
      this.cacheHits += 1;
      this.logEvent('memory', 'LRU cache HIT for material page', 'info', {
        material_id: materialId,
        title: cached.material.title,
        access_count: cached.access_count,
      });
      return {
        material: cached.material,
        course_code: cached.course_code,
        course_title: cached.course_title,
        cache_hit: true,
        evicted_id: null,
        disk_track: track,
        disk_movement: 0,
      };
    }

    this.cacheMisses += 1;
    const mat = this.state.materials.find((m) => m.id === materialId) || null;
    if (!mat) {
      return {
        material: null,
        course_code: '',
        course_title: '',
        cache_hit: false,
        evicted_id: null,
        disk_track: track,
        disk_movement: 0,
      };
    }

    const course = this.state.courses.find((c) => c.id === mat.course_id);
    const io = this.performDiskIo(track, `material page ${materialId} (${mat.title.slice(0, 28)})`, () => mat);

    let evictedId: number | null = null;
    this.cacheLock.write(() => {
      if (this.cachePages.has(materialId)) {
        this.cachePages.delete(materialId);
      }
      this.cachePages.set(materialId, {
        material: mat,
        course_code: course?.code || 'COURSE',
        course_title: course?.title || 'Course',
        loaded_at: nowIso(),
        last_accessed: nowIso(),
        access_count: 1,
      });
      while (this.cachePages.size > this.state.settings.cache_capacity) {
        const oldestKey = this.cachePages.keys().next().value;
        if (oldestKey !== undefined) {
          this.cachePages.delete(oldestKey);
          evictedId = oldestKey;
          this.cacheEvictions += 1;
        }
      }
    });

    if (evictedId !== null) {
      this.logEvent('memory', 'LRU page evicted to free frame', 'warning', {
        evicted_material_id: evictedId,
        new_material_id: materialId,
      });
    }
    this.logEvent('memory', 'Page loaded into LRU cache after disk read', 'info', {
      material_id: materialId,
      track,
      movement: io.movement,
    });

    return {
      material: mat,
      course_code: course?.code || 'COURSE',
      course_title: course?.title || 'Course',
      cache_hit: false,
      evicted_id: evictedId,
      disk_track: track,
      disk_movement: io.movement,
    };
  }

  rebuildSearchIndex(): number {
    const terms = new Map<string, Map<number, number>>();
    const docs = new Map<
      number,
      { id: number; title: string; course_id: number; course_code: string; course_title: string; snippet: string }
    >();

    for (const mat of this.state.materials) {
      const course = this.state.courses.find((c) => c.id === mat.course_id);
      const courseTitle = course?.title || '';
      const courseCode = course?.code || '';
      const rawText = `${mat.title} ${mat.title} ${courseCode} ${courseTitle} ${mat.body}`.toLowerCase();
      const tokens = rawText.match(/[a-z0-9]{2,}/g) || [];

      docs.set(mat.id, {
        id: mat.id,
        title: mat.title,
        course_id: mat.course_id,
        course_code: courseCode,
        course_title: courseTitle,
        snippet: mat.body.slice(0, 240),
      });

      for (const tok of tokens) {
        let docMap = terms.get(tok);
        if (!docMap) {
          docMap = new Map();
          terms.set(tok, docMap);
        }
        docMap.set(mat.id, (docMap.get(mat.id) || 0) + 1);
      }
    }

    this.indexLock.write(() => {
      this.invertedTerms = terms;
      this.indexedDocs = docs;
      this.indexedAt = nowIso();
    });

    this.logEvent('index', 'Course material inverted search index rebuilt', 'info', {
      documents: docs.size,
      terms: terms.size,
    });
    return docs.size;
  }

  searchMaterials(query: string) {
    const tokens = Array.from(new Set((query || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []));
    if (tokens.length === 0) return [];

    return this.indexLock.read(() => {
      const scores = new Map<number, number>();
      const matchedByDoc = new Map<number, string[]>();

      for (const tok of tokens) {
        for (const [termKey, posting] of this.invertedTerms.entries()) {
          if (termKey === tok || (tok.length >= 3 && termKey.startsWith(tok))) {
            const weightMultiplier = termKey === tok ? 2 : 1;
            for (const [docId, freq] of posting.entries()) {
              scores.set(docId, (scores.get(docId) || 0) + freq * weightMultiplier);
              const arr = matchedByDoc.get(docId) || [];
              if (!arr.includes(termKey)) arr.push(termKey);
              matchedByDoc.set(docId, arr);
            }
          }
        }
      }

      return Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([docId, score]) => {
          const doc = this.indexedDocs.get(docId)!;
          return {
            ...doc,
            score,
            matched_terms: (matchedByDoc.get(docId) || []).slice(0, 6),
            cache_resident: this.cachePages.has(docId),
          };
        });
    });
  }

  scheduleJob(
    kind: 'notify' | 'reindex' | 'backup' | 'report' | 'reminders',
    title: string,
    payload: Record<string, unknown> = {},
    priority = 3,
    burst = 2
  ): JobRecord {
    const job: JobRecord = {
      id: crypto.randomBytes(6).toString('hex'),
      kind,
      title,
      payload,
      priority: Math.max(1, Math.min(10, Math.floor(priority))),
      burst: Math.max(1, Math.min(20, Math.floor(burst))),
      status: 'queued',
      submitted_at: nowIso(),
      started_at: null,
      finished_at: null,
      result: null,
      error: null,
      worker: null,
      elapsed_ms: null,
    };

    this.state.jobs.unshift(job);
    if (this.state.jobs.length > 40) this.state.jobs.length = 40;
    this.saveState();

    this.logEvent('scheduler', 'Background process queued', 'info', {
      job_id: job.id,
      kind: job.kind,
      priority: job.priority,
      burst: job.burst,
    });

    const claim = this.resourceClaims[job.kind] || { cpu: 1, db: 1, disk: 0 };
    this.bankerMax.set(job.id, { ...claim });
    this.bankerAllocation.set(job.id, { cpu: 0, db: 0, disk: 0 });

    setTimeout(() => this.dispatchNextJob(), 350);
    return job;
  }

  dispatchNextJob() {
    if (this.isDispatching) return;
    const queued = this.state.jobs.filter((j) => j.status === 'queued');
    if (queued.length === 0) return;

    this.isDispatching = true;
    const policy = this.state.settings.scheduler_policy;

    queued.sort((a, b) => {
      if (policy === 'fcfs' || policy === 'rr') {
        return a.submitted_at.localeCompare(b.submitted_at);
      }
      if (policy === 'sjf' || policy === 'srtf') {
        return a.burst - b.burst || a.submitted_at.localeCompare(b.submitted_at);
      }
      return a.priority - b.priority || a.submitted_at.localeCompare(b.submitted_at);
    });

    const job = queued[0];
    const workerName = `lms-worker-${(this.runningWorkers.size % 3) + 1}`;
    const claim = this.resourceClaims[job.kind] || { cpu: 1, db: 1, disk: 0 };

    job.status = 'running';
    job.started_at = nowIso();
    job.worker = workerName;
    this.runningWorkers.set(job.id, job.kind);
    this.bankerMax.set(job.id, { ...claim });
    this.bankerAllocation.set(job.id, { ...claim });

    const snap = this.getBankerSnapshot();
    this.logEvent('banker', 'Safe resource allocation granted', 'info', {
      process: job.id,
      claim,
      safe_sequence: snap.safe_sequence,
    });
    this.logEvent('scheduler', 'Background process dispatched', 'info', {
      job_id: job.id,
      kind: job.kind,
      worker: workerName,
      policy: policy.toUpperCase(),
    });

    const startMs = Date.now();
    setTimeout(() => {
      try {
        const output = this.executeJobHandler(job);
        job.status = 'succeeded';
        job.finished_at = nowIso();
        job.elapsed_ms = Date.now() - startMs;
        job.result = JSON.stringify(output);
        this.logEvent('scheduler', 'Background process completed', 'info', {
          job_id: job.id,
          kind: job.kind,
          elapsed_ms: job.elapsed_ms,
        });
      } catch (err: unknown) {
        job.status = 'failed';
        job.finished_at = nowIso();
        job.elapsed_ms = Date.now() - startMs;
        job.error = err instanceof Error ? err.message : String(err);
        this.logEvent('scheduler', 'Background process failed', 'error', {
          job_id: job.id,
          error: job.error,
        });
      } finally {
        this.bankerMax.delete(job.id);
        this.bankerAllocation.delete(job.id);
        this.runningWorkers.delete(job.id);
        this.logEvent('banker', 'Resources released back to pool', 'info', {
          process: job.id,
        });
        this.saveState();
        this.isDispatching = false;
        if (this.state.jobs.some((j) => j.status === 'queued')) {
          setTimeout(() => this.dispatchNextJob(), 250);
        }
      }
    }, Math.min(900, job.burst * 220));
  }

  executeJobHandler(job: JobRecord): Record<string, unknown> {
    if (job.kind === 'notify') {
      const recipients = (job.payload.recipients as number[]) || [];
      const title = String(job.payload.title || 'LMS Update').slice(0, 160);
      const body = String(job.payload.body || '').slice(0, 2000);
      const link = String(job.payload.link || '/dashboard').slice(0, 300);
      let nextId = this.nextIdSync('notifications');
      for (const uid of recipients) {
        this.state.notifications.unshift({
          id: nextId++,
          user_id: uid,
          title,
          body,
          link,
          is_read: false,
          created_at: nowIso(),
        });
      }
      return { notifications_created: recipients.length };
    }

    if (job.kind === 'reindex') {
      const count = this.rebuildSearchIndex();
      return { indexed_materials: count };
    }

    if (job.kind === 'backup') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `smart-lms-backup-${stamp}.json`;
      const target = path.join(BACKUP_DIR, filename);
      const content = Buffer.from(JSON.stringify(this.state, null, 2), 'utf-8');
      if (this.fileStore) {
        this.fileStore
          .putWithId(filename, content, {
            originalName: filename,
            contentType: 'application/json',
            size: content.length,
          })
          .catch((err) => console.warn('[BACKUP] FileStore write warning:', err));
      }
      this.performDiskIo(trackFor(filename), 'package LMS backup archive', () => {
        fs.writeFileSync(target, content);
      });
      return { archive: filename, bytes: content.length };
    }

    if (job.kind === 'report') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `lms-report-${stamp}.json`;
      const counts = {
        users: this.state.users.length,
        courses: this.state.courses.length,
        enrollments: this.state.enrollments.length,
        materials: this.state.materials.length,
        assignments: this.state.assignments.length,
        submissions: this.state.submissions.length,
      };
      const reportData = { generated_at: nowIso(), counts };
      const target = path.join(REPORT_DIR, filename);
      const buf = Buffer.from(JSON.stringify(reportData, null, 2), 'utf-8');
      this.performDiskIo(trackFor(filename), 'write LMS usage report', () => {
        fs.writeFileSync(target, buf);
      });
      return { report: filename, counts };
    }

    if (job.kind === 'reminders') {
      const now = new Date();
      const in14d = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
      let queued = 0;
      for (const asgn of this.state.assignments) {
        const due = new Date(asgn.due_at);
        if (due >= now && due <= in14d) {
          const enrolledStudents = this.state.enrollments
            .filter((e) => e.course_id === asgn.course_id)
            .map((e) => e.student_id);
          const unsubmitted = enrolledStudents.filter(
            (sid) => !this.state.submissions.some((s) => s.assignment_id === asgn.id && s.student_id === sid)
          );
          if (unsubmitted.length > 0) {
            const course = this.state.courses.find((c) => c.id === asgn.course_id);
            let nextId = this.nextIdSync('notifications');
            for (const uid of unsubmitted) {
              this.state.notifications.unshift({
                id: nextId++,
                user_id: uid,
                title: `Due Reminder: ${asgn.title}`,
                body: `${asgn.title} for ${course?.title || 'Course'} is due on ${asgn.due_at.replace('T', ' ')}.`,
                link: `/assignments/${asgn.id}`,
                is_read: false,
                created_at: nowIso(),
              });
              queued += 1;
            }
          }
        }
      }
      return { assignments_checked: this.state.assignments.length, reminders_queued: queued };
    }

    return { ok: true };
  }

  getBankerSnapshot() {
    const keys = Object.keys(this.totalResources);
    const maxObj: Record<string, Record<string, number>> = {};
    const allocObj: Record<string, Record<string, number>> = {};
    const needObj: Record<string, Record<string, number>> = {};

    const activeEntries = Array.from(this.bankerMax.entries());
    if (activeEntries.length === 0) {
      const standing = [
        { id: 'daemon:http-io', max: { cpu: 1, db: 2, disk: 1 }, alloc: { cpu: 1, db: 1, disk: 0 } },
        { id: 'daemon:wal-checkpoint', max: { cpu: 1, db: 2, disk: 2 }, alloc: { cpu: 0, db: 1, disk: 1 } },
        { id: 'daemon:idx-watcher', max: { cpu: 2, db: 1, disk: 1 }, alloc: { cpu: 1, db: 0, disk: 0 } },
      ];
      for (const s of standing) {
        maxObj[s.id] = s.max;
        allocObj[s.id] = s.alloc;
        needObj[s.id] = Object.fromEntries(
          keys.map((k) => [k, s.max[k as keyof typeof s.max] - s.alloc[k as keyof typeof s.alloc]])
        );
      }
    } else {
      for (const [pid, m] of activeEntries) {
        const a = this.bankerAllocation.get(pid) || { cpu: 0, db: 0, disk: 0 };
        maxObj[pid] = { ...m };
        allocObj[pid] = { ...a };
        needObj[pid] = Object.fromEntries(keys.map((k) => [k, Math.max(0, (m[k] || 0) - (a[k] || 0))]));
      }
    }

    const available: Record<string, number> = {};
    for (const k of keys) {
      const used = Object.values(allocObj).reduce((sum, a) => sum + (a[k] || 0), 0);
      available[k] = Math.max(0, this.totalResources[k] - used);
    }

    const work = { ...available };
    const finish = new Set<string>();
    const sequence: string[] = [];
    const pids = Object.keys(maxObj);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const pid of pids) {
        if (finish.has(pid)) continue;
        if (keys.every((k) => (needObj[pid][k] || 0) <= (work[k] || 0))) {
          for (const k of keys) work[k] += allocObj[pid][k] || 0;
          finish.add(pid);
          sequence.push(pid);
          progressed = true;
        }
      }
    }

    return {
      resources: this.totalResources,
      available,
      max: maxObj,
      allocation: allocObj,
      need: needObj,
      safe: finish.size === pids.length,
      safe_sequence: sequence,
    };
  }

  getFullKernelSnapshot() {
    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const residentPages = Array.from(this.cachePages.entries())
      .reverse()
      .map(([matId, entry]) => ({
        key: `material:${matId}`,
        material_id: matId,
        title: entry.material.title,
        course_code: entry.course_code,
        loaded_at: entry.loaded_at,
        last_accessed: entry.last_accessed,
        access_count: entry.access_count,
        size_bytes: Buffer.byteLength(entry.material.body, 'utf-8') + (entry.material.file_size || 0),
      }));

    const topTerms = Array.from(this.invertedTerms.entries())
      .map(([term, docMap]) => ({
        term,
        doc_count: docMap.size,
        total_occurrences: Array.from(docMap.values()).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total_occurrences - a.total_occurrences)
      .slice(0, 12);

    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json') || f.endsWith('.zip'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, bytes: st.size, created_at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8);

    const reports = fs
      .readdirSync(REPORT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf-8'));
          return { filename: f, generated_at: parsed.generated_at, counts: parsed.counts };
        } catch {
          return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .slice(0, 6);

    const totalStorageBytes = this.state.courses.reduce((sum, c) => sum + this.courseStorageUsed(c.id), 0);

    return {
      scheduler: {
        policy: this.state.settings.scheduler_policy,
        time_quantum: this.state.settings.time_quantum,
        workers: 3,
        queued: this.state.jobs.filter((j) => j.status === 'queued'),
        running: Object.fromEntries(this.runningWorkers.entries()),
        recent: this.state.jobs.slice(0, 18),
        resource_claims: this.resourceClaims,
      },
      banker: this.getBankerSnapshot(),
      cache: {
        capacity: this.state.settings.cache_capacity,
        size: this.cachePages.size,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        evictions: this.cacheEvictions,
        hit_rate: totalCacheOps > 0 ? Number((this.cacheHits / totalCacheOps).toFixed(3)) : 0,
        resident_pages: residentPages,
      },
      disk: {
        policy: this.state.settings.disk_policy,
        head: this.diskHead,
        requests: this.diskRequests,
        total_movement: this.diskTotalMovement,
        last_track: this.diskLastTrack,
        queued: 0,
        history: this.diskHistory.slice(0, 20),
      },
      locks: {
        cache: this.cacheLock.snapshot(),
        search_index: this.indexLock.snapshot(),
      },
      search_index: {
        documents: this.indexedDocs.size,
        terms: this.invertedTerms.size,
        indexed_at: this.indexedAt,
        top_terms: topTerms,
      },
      events: this.events.slice(0, 40),
      backups,
      reports,
      storage: {
        total_bytes: totalStorageBytes,
        course_limit_bytes: MAX_COURSE_STORAGE_BYTES,
        file_limit_bytes: MAX_UPLOAD_BYTES,
        backend: this.storageStatus.backend,
        is_durable: this.storageStatus.isDurable,
      },
      persistence: {
        backend: this.persistenceStatus.backend,
        is_durable: this.persistenceStatus.isDurable,
        warning: this.persistenceStatus.warning,
      },
    };
  }
}

const kernel = new LMSKernelEngine();

const isDemoModeEnabled = (): boolean => {
  return process.env.LMS_DEMO_MODE === 'true';
};

export async function createApp(): Promise<{ app: express.Express; kernel: LMSKernelEngine }> {
  // Initialize state persistence store (Firestore with local JSON fallback)
  if (!kernel.store) {
    let fbApp: any = undefined;
    if (getFirebaseApps().length > 0) {
      fbApp = getFirebaseApps()[0];
    }
    let firestoreDbId: string | undefined = undefined;
    let storageBucket: string | undefined = undefined;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf-8'));
      firestoreDbId = cfg.firestoreDatabaseId;
      storageBucket = cfg.storageBucket;
    } catch {
      // Config read error non-fatal
    }

    const persistenceResult = await initPersistenceStore({
      dbFilePath: DB_FILE,
      firebaseApp: fbApp,
      firestoreDatabaseId: firestoreDbId,
    });

    await kernel.attachStore(persistenceResult.store, persistenceResult);

    // Initialize durable file store (Firebase Storage with local disk fallback)
    const storageResult = await initFileStore({
      uploadDir: UPLOAD_DIR,
      firebaseApp: fbApp,
      storageBucket,
    });

    kernel.attachFileStore(storageResult.store, storageResult);
    await migrateExistingUploads(kernel.state, storageResult.store, UPLOAD_DIR);
  }

  const app = express();

  // Trust Cloud Run / reverse proxy frontends (first hop)
  app.set('trust proxy', 1);

  // 1MB request body limit
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Multer memory storage with 5MB file size limit
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
    },
  });

  function uploadMiddleware(fieldName = 'file') {
    const single = upload.single(fieldName);
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      single(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File exceeds 5MB limit.' });
          }
          return res.status(400).json({ error: err.message });
        } else if (err) {
          return res.status(400).json({ error: err.message });
        }
        next();
      });
    };
  }

  // Helmet security headers (configured to permit AI Studio preview iframe embedding)
  app.use(
    helmet({
      frameguard: false, // Prevents X-Frame-Options: SAMEORIGIN so the preview iframe can render
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https://apis.google.com',
            'https://*.firebaseapp.com',
            'https://*.googleapis.com',
          ],
          connectSrc: [
            "'self'",
            'https://*.googleapis.com',
            'https://*.firebaseio.com',
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'wss:',
            'ws:',
          ],
          imgSrc: [
            "'self'",
            'data:',
            'blob:',
            'https://*.googleusercontent.com',
            'https://images.unsplash.com',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
          frameAncestors: null, // Allow embedding in AI Studio preview iframe
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // Rate limiters for security (keys on real client IP; auth limiter binds client IP + login identifier)
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'GET' && (req.path === '/demo-info' || req.originalUrl?.includes('/demo-info')),
    keyGenerator: (req) => {
      const rawIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
      const clientIp = ipKeyGenerator(rawIp);
      const identifier = String(
        req.body?.identifier || req.body?.email || req.body?.username || req.body?.role || ''
      )
        .trim()
        .toLowerCase();
      return identifier ? `${clientIp}:${identifier}` : clientIp;
    },
    message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
  });

  const generalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || req.socket.remoteAddress || '127.0.0.1'),
    message: { error: 'Too many API requests. Please slow down.' },
  });

  app.use('/api/auth/', authRateLimiter);
  app.use('/api/', generalApiLimiter);

  const sanitizeUser = (u: UserRecord) => {
    const dept = (kernel.state.departments || []).find((d) => d.id === u.department_id);
    const batch = (kernel.state.batches || []).find((b) => b.id === u.batch_id);
    const enrolledCount =
      u.role === 'student'
        ? kernel.state.enrollments.filter((e) => e.student_id === u.id).length
        : u.role === 'faculty'
          ? kernel.state.courses.filter((c) => c.faculty_id === u.id).length
          : kernel.state.courses.length;
    return {
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      status: u.status || 'active',
      created_at: u.created_at,
      last_login_at: u.last_login_at || null,
      department_id: u.department_id ?? null,
      department_name: dept?.name || undefined,
      batch_id: u.batch_id ?? null,
      batch_name: batch?.name || undefined,
      bio: u.bio || '',
      weekly_goal_hours: u.weekly_goal_hours || 14,
      notifications_enabled: u.notifications_enabled ?? true,
      study_streak_days: u.study_streak_days || 0,
      enrolled_course_count: u.role === 'student' ? enrolledCount : undefined,
      assigned_course_count: u.role === 'faculty' ? enrolledCount : undefined,
    };
  };

  let SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.warn(
      '\n⚠️  [SECURITY NOTICE] SESSION_SECRET is not configured or shorter than 32 characters in environment.'
    );
    console.warn(
      '⚠️  Generating a high-entropy ephemeral secret for this process runtime. Set SESSION_SECRET in .env for persistent multi-restart sessions.\n'
    );
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  }

  const revokedSessionTokens = new Set<string>();

  const createSessionToken = (
    u: UserRecord,
    method: 'credentials' | 'demo' | 'registration'
  ): string => {
    const payload = Buffer.from(
      JSON.stringify({
        uid: u.id,
        role: u.role,
        method,
        iat: Date.now(),
        token_version: u.token_version ?? 1,
        nonce: crypto.randomBytes(8).toString('hex'),
      })
    ).toString('base64url');
    const sig = crypto
      .createHmac('sha256', SESSION_SECRET!)
      .update(payload)
      .digest('base64url');
    return `${payload}.${sig}`;
  };

  const verifySessionToken = (
    token: string | undefined | null
  ): { uid: number; role: string; method: string; token_version?: number } | null => {
    if (!token || typeof token !== 'string') return null;
    const clean = token.trim();
    if (!clean || revokedSessionTokens.has(clean)) return null;
    const parts = clean.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;

    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET!)
      .update(payload)
      .digest('base64url');

    try {
      const sigBuf = Buffer.from(sig, 'base64url');
      const expectedSigBuf = Buffer.from(expectedSig, 'base64url');
      if (
        sigBuf.length !== expectedSigBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expectedSigBuf)
      ) {
        return null;
      }
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      if (typeof parsed.uid !== 'number') return null;

      // 8-hour session expiration enforcement
      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
      if (typeof parsed.iat === 'number' && Date.now() - parsed.iat > EIGHT_HOURS_MS) {
        return null;
      }

      // Check token version to support persistent session invalidation across restarts
      const user = kernel.state.users.find((u) => u.id === parsed.uid);
      if (!user) return null;
      const currentVersion = user.token_version ?? 1;
      const tokenVersion = parsed.token_version ?? 1;
      if (currentVersion !== tokenVersion) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  };

  const establishAuthenticatedSession = (
    found: UserRecord,
    method: 'credentials' | 'demo' | 'registration',
    activityMessage: string
  ) => {
    found.last_login_at = nowIso();
    kernel.recordLoginActivity(found, found.username, 'success', activityMessage);
    kernel.logEvent('security', 'User session authenticated', 'info', {
      username: found.username,
      email: found.email,
      role: found.role,
      method,
    });
    kernel.saveState();
    const sessionToken = createSessionToken(found, method);
    return {
      user: sanitizeUser(found),
      session_token: sessionToken,
      auth_method: method,
    };
  };

  const getActiveUser = (req: express.Request): UserRecord | null => {
    const rawBearer = String(req.headers.authorization || '');
    const bearerToken = rawBearer.startsWith('Bearer ') ? rawBearer.slice(7).trim() : '';
    const headerToken = String(req.headers['x-lms-session-token'] || bearerToken || '').trim();

    if (!headerToken) return null;

    const verified = verifySessionToken(headerToken);
    if (!verified) return null;
    const foundByToken = kernel.state.users.find((u) => u.id === verified.uid);
    if (foundByToken) {
      if (foundByToken.status === 'deactivated') return null;
      return foundByToken;
    }
    return null;
  };

  const requireActiveUser = (req: express.Request, res: express.Response): UserRecord | null => {
    const user = getActiveUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return null;
    }
    if (user.status === 'deactivated') {
      res.status(403).json({ error: 'Your account has been deactivated by an administrator.' });
      return null;
    }
    return user;
  };

  const requireAdmin = (req: express.Request, res: express.Response): UserRecord | null => {
    const user = requireActiveUser(req, res);
    if (!user) return null;
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator privileges are required for this action.' });
      return null;
    }
    return user;
  };

  const aiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const user = getActiveUser(req);
      if (user) return `ai-user-${user.id}`;
      return ipKeyGenerator(req.ip || req.socket.remoteAddress || '127.0.0.1');
    },
    message: { error: 'Too many AI requests. Please try again after 15 minutes.' },
  });

  // GET /api/ai/status - Returns whether server-side Gemini AI features are configured & enabled
  app.get('/api/ai/status', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    res.json({ enabled: isAiConfigured() });
  });


  const formatCourseForUser = (c: CourseRecord, user: UserRecord) => {
    const faculty = kernel.state.users.find((u) => u.id === c.faculty_id);
    const dept = (kernel.state.departments || []).find((d) => d.id === c.department_id);
    const enrolled =
      user.role === 'admin' ||
      c.faculty_id === user.id ||
      kernel.state.enrollments.some((e) => e.course_id === c.id && e.student_id === user.id);

    const courseMats = kernel.state.materials.filter((m) => m.course_id === c.id);
    const userCompletedIds = new Set(kernel.state.completed_materials[String(user.id)] || []);
    const completedCount = courseMats.filter((m) => userCompletedIds.has(m.id)).length;
    const progressPercent =
      courseMats.length > 0 ? Math.round((completedCount / courseMats.length) * 100) : 0;

    const userQuizScores = kernel.state.quiz_scores[String(user.id)] || {};
    const quizScore = userQuizScores[String(c.id)] ?? null;

    return {
      ...c,
      published: c.published ?? true,
      approval_status: c.approval_status || 'approved',
      department_id: c.department_id ?? null,
      department_name: dept?.name || undefined,
      faculty_name: faculty?.full_name || 'Unassigned Instructor',
      enrolled,
      student_count: kernel.state.enrollments.filter((e) => e.course_id === c.id).length,
      material_count: courseMats.length,
      completed_material_count: completedCount,
      progress_percent: progressPercent,
      assignment_count: kernel.state.assignments.filter((a) => a.course_id === c.id).length,
      announcement_count: kernel.state.announcements.filter((a) => a.course_id === c.id).length,
      storage_used: kernel.courseStorageUsed(c.id),
      storage_limit: MAX_COURSE_STORAGE_BYTES,
      quiz_score: quizScore,
    };
  };

  const computeRealWeeklyActivity = (user: UserRecord) => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const completedIds = new Set(kernel.state.completed_materials[String(user.id)] || []);
    const completedMats = kernel.state.materials.filter((m) => completedIds.has(m.id));
    const userSubs = kernel.state.submissions.filter((s) => s.student_id === user.id);
    const userNotes = kernel.state.student_notes.filter((n) => n.user_id === user.id);
    const userEvents = kernel.state.schedule_events.filter((e) => e.user_id === user.id);

    const buckets = days.map((day) => ({ day, hours: 0, lessons: 0 }));
    const dayIndexFromIso = (iso: string): number => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 0;
      const jsDay = d.getDay(); // 0=Sun..6=Sat
      return jsDay === 0 ? 6 : jsDay - 1;
    };

    for (const mat of completedMats) {
      const idx = mat.id % 7;
      buckets[idx].lessons += 1;
      buckets[idx].hours = Number((buckets[idx].hours + (mat.duration_minutes || 20) / 60).toFixed(1));
    }
    for (const sub of userSubs) {
      const idx = dayIndexFromIso(sub.submitted_at);
      buckets[idx].hours = Number((buckets[idx].hours + 0.8).toFixed(1));
    }
    for (const note of userNotes) {
      const idx = dayIndexFromIso(note.created_at);
      buckets[idx].hours = Number((buckets[idx].hours + 0.3).toFixed(1));
    }
    for (const ev of userEvents) {
      const matchIdx = days.findIndex((d) => ev.date.toLowerCase().startsWith(d.toLowerCase()));
      if (matchIdx >= 0) {
        buckets[matchIdx].hours = Number((buckets[matchIdx].hours + 0.5).toFixed(1));
      }
    }
    return buckets;
  };

  app.get('/api/bootstrap', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;

    const visibleCourses = kernel.state.courses.filter((c) => {
      if (user.role === 'admin') return true;
      if (user.role === 'faculty' && c.faculty_id === user.id) return true;
      return (c.published ?? true) && (c.approval_status || 'approved') !== 'archived';
    });
    const courses = visibleCourses.map((c) => formatCourseForUser(c, user));

    const assignments = kernel.state.assignments.map((a) => {
      const course = kernel.state.courses.find((c) => c.id === a.course_id);
      const subs = kernel.state.submissions.filter((s) => s.assignment_id === a.id);
      const mySub = subs.find((s) => s.student_id === user.id) || null;
      return {
        ...a,
        course_code: course?.code || '',
        course_title: course?.title || '',
        submission_count: subs.length,
        graded_count: subs.filter((s) => s.grade !== null).length,
        my_submission: mySub
          ? {
              ...mySub,
              student_name: user.full_name,
              student_username: user.username,
            }
          : null,
      };
    });

    const notifications = kernel.state.notifications
      .filter((n) => n.user_id === user.id)
      .slice(0, 30);

    const announcements = kernel.state.announcements
      .filter((a) => {
        if (user.role === 'admin') return true;
        if (a.target_audience === 'teachers' && user.role !== 'faculty') return false;
        if (a.target_audience === 'students' && user.role !== 'student') return false;
        return true;
      })
      .map((a) => {
        const course = a.course_id ? kernel.state.courses.find((c) => c.id === a.course_id) : null;
        const author = kernel.state.users.find((u) => u.id === a.author_id);
        return {
          ...a,
          course_code: course?.code || 'PLATFORM',
          course_title: course?.title || 'Platform-Wide Notice',
          author_name: author?.full_name || 'Administrator',
          author_role: author?.role || 'admin',
        };
      })
      .slice(0, 20);

    const userNotes = kernel.state.student_notes
      .filter((n) => n.user_id === user.id)
      .map((n) => {
        const mat = kernel.state.materials.find((m) => m.id === n.material_id);
        return {
          ...n,
          material_title: mat?.title || 'Lesson Note',
        };
      });

    const schedule = kernel.state.schedule_events.filter((ev) => ev.user_id === user.id);
    const weeklyActivity = computeRealWeeklyActivity(user);

    res.json({
      user: sanitizeUser(user),
      accounts: kernel.state.users
        .filter((u) => (u.status || 'active') === 'active')
        .map((u) => sanitizeUser(u)),
      courses,
      assignments,
      announcements,
      notifications,
      notes: userNotes,
      schedule,
      weekly_activity: weeklyActivity,
      kernel: kernel.getFullKernelSnapshot(),
    });
  });

  const isDemoModeEnabled = (): boolean => {
    return process.env.LMS_DEMO_MODE === 'true';
  };

  const resolveDemoAccountForRole = (role: 'admin' | 'faculty' | 'student') => {
    const canonicalUsername = role === 'admin' ? 'admin' : role === 'faculty' ? 'faculty' : 'student';
    const roleLabel = role === 'admin' ? 'Administrator' : role === 'faculty' ? 'Teacher' : 'Student';

    // Prefer the canonical demo account for this role, or fall back to an existing account with this exact role
    const exactCanonical = kernel.state.users.find(
      (u) => u.role === role && u.username.toLowerCase() === canonicalUsername
    );
    const anyActiveForRole = kernel.state.users.find(
      (u) => u.role === role && (u.status || 'active') === 'active'
    );
    const anyForRole = kernel.state.users.find((u) => u.role === role);
    const account = exactCanonical || anyActiveForRole || anyForRole || null;

    if (!account) {
      return {
        available: false,
        account: null,
        setup_required: `No ${roleLabel} account exists in the database. Create a ${roleLabel} user (e.g. username "${canonicalUsername}") in the Users directory to enable ${roleLabel} demo login.`,
      };
    }

    if (account.status === 'deactivated') {
      return {
        available: false,
        account: sanitizeUser(account),
        setup_required: `The ${roleLabel} account (@${account.username}) is currently deactivated. Re-activate it in the Administrator Users panel to use ${roleLabel} demo login.`,
      };
    }

    return {
      available: true,
      account: sanitizeUser(account),
      rawAccount: account,
      setup_required: null,
    };
  };

  app.get('/api/auth/demo-info', (_req, res) => {
    const enabled = isDemoModeEnabled();
    const adminInfo = resolveDemoAccountForRole('admin');
    const facultyInfo = resolveDemoAccountForRole('faculty');
    const studentInfo = resolveDemoAccountForRole('student');

    res.json({
      demo_mode_enabled: enabled,
      roles: {
        admin: {
          available: enabled && adminInfo.available,
          account: adminInfo.account,
          setup_required: adminInfo.setup_required,
        },
        faculty: {
          available: enabled && facultyInfo.available,
          account: facultyInfo.account,
          setup_required: facultyInfo.setup_required,
        },
        student: {
          available: enabled && studentInfo.available,
          account: studentInfo.account,
          setup_required: studentInfo.setup_required,
        },
      },
    });
  });

  app.post('/api/auth/demo-login', (req, res) => {
    if (!isDemoModeEnabled()) {
      kernel.logEvent('security', 'Rejected demo login attempt in production mode', 'warning', {});
      res.status(403).json({
        error:
          'Demo role selection is disabled in production mode. Set LMS_DEMO_MODE=true in environment configuration to enable demo authentication.',
      });
      return;
    }

    const rawRole = String(req.body?.role || '').trim().toLowerCase();
    const targetRole: 'admin' | 'faculty' | 'student' | null =
      rawRole === 'admin' || rawRole === 'administrator'
        ? 'admin'
        : rawRole === 'faculty' || rawRole === 'teacher'
        ? 'faculty'
        : rawRole === 'student'
        ? 'student'
        : null;

    if (!targetRole) {
      res.status(400).json({ error: 'Select a valid role: Administrator, Teacher, or Student.' });
      return;
    }

    const resolved = resolveDemoAccountForRole(targetRole);
    if (!resolved.available || !resolved.rawAccount) {
      res.status(404).json({
        error:
          resolved.setup_required ||
          'Demo account for the selected role is not available in the database.',
      });
      return;
    }

    const found = resolved.rawAccount;
    res.json(
      establishAuthenticatedSession(
        found,
        'demo',
        `Authenticated via Unified Demo Access (${found.role})`
      )
    );
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, username, identifier, password } = req.body || {};
    const cleanIdentifier = String(email || identifier || username || '').trim();
    if (!cleanIdentifier || !password) {
      res.status(400).json({ error: 'Email (or username) and password are required.' });
      return;
    }

    const found = kernel.state.users.find(
      (u) =>
        u.email.toLowerCase() === cleanIdentifier.toLowerCase() ||
        u.username.toLowerCase() === cleanIdentifier.toLowerCase()
    );

    const isPasswordValid = found
      ? await verifyPassword(String(password || ''), found.password_hash)
      : false;

    if (!found || !isPasswordValid) {
      kernel.logEvent('security', 'Failed sign-in attempt rejected', 'warning', {
        identifier: cleanIdentifier,
      });
      kernel.recordLoginActivity(
        found || null,
        cleanIdentifier,
        'failed',
        'Invalid email/username or password'
      );
      kernel.saveState();
      res.status(401).json({ error: 'Invalid email/username or password.' });
      return;
    }

    if (found.status === 'deactivated') {
      kernel.logEvent('security', 'Blocked login for deactivated account', 'warning', {
        username: found.username,
      });
      kernel.recordLoginActivity(found, found.username, 'blocked', 'Account is deactivated');
      kernel.saveState();
      res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
      return;
    }

    // Seamless migration from legacy SHA-256 to crypto.scrypt upon successful sign-in
    if (!found.password_hash.startsWith('scrypt$')) {
      found.password_hash = await hashPasswordScrypt(String(password));
      kernel.saveState();
    }

    res.json(
      establishAuthenticatedSession(found, 'credentials', 'Authenticated session started')
    );
  });

  app.post('/api/auth/firebase-login', async (req, res) => {
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const rawToken = String(req.body?.id_token || bearerToken || '').trim();

    if (!rawToken) {
      res.status(400).json({ error: 'Firebase ID token is required.' });
      return;
    }

    if (!firebaseAdminInitialized) {
      res.status(503).json({
        error:
          'Firebase Auth verification is not initialized on the server. Please ensure firebase-applet-config.json is present.',
      });
      return;
    }

    let decoded: DecodedIdToken;
    try {
      decoded = await getFirebaseAuth().verifyIdToken(rawToken);
    } catch (err) {
      kernel.logEvent('security', 'Firebase ID token verification failed', 'warning', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(401).json({ error: 'Invalid or expired Firebase ID token.' });
      return;
    }

    if (!decoded.email_verified) {
      res.status(403).json({
        error: 'Email address must be verified by Google to access the LMS.',
      });
      return;
    }

    const cleanEmail = (decoded.email || '').trim().toLowerCase();
    const cleanUid = (decoded.uid || '').trim();
    const cleanName = (decoded.name || cleanEmail.split('@')[0] || 'Learner').trim();

    if (!cleanEmail || !cleanUid) {
      res.status(400).json({ error: 'Verified email and UID were not found in the ID token.' });
      return;
    }

    let found = kernel.state.users.find((u) => u.email.toLowerCase() === cleanEmail);
    const isAdminEmail = ADMIN_EMAILS.has(cleanEmail);

    if (!found) {
      const nextId = await kernel.nextId('users');
      let baseUser = cleanEmail.split('@')[0].replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 24);
      if (baseUser.length < 3) baseUser = `${baseUser}_u`;
      let finalUsername = baseUser;
      let suffix = 2;
      while (kernel.state.users.some((u) => u.username.toLowerCase() === finalUsername.toLowerCase())) {
        finalUsername = `${baseUser}_${suffix}`;
        suffix += 1;
      }

      const now = nowIso();
      // New accounts created via Firebase sign-in are ALWAYS role student, unless configured in ADMIN_EMAILS
      const role: 'admin' | 'faculty' | 'student' = isAdminEmail ? 'admin' : 'student';

      found = {
        id: nextId,
        username: finalUsername,
        full_name: cleanName.slice(0, 80),
        email: cleanEmail.slice(0, 120),
        password_hash: generateUnusablePasswordHash(),
        role,
        status: 'active',
        created_at: now,
        last_login_at: now,
        token_version: 1,
        department_id: null,
        batch_id: null,
        bio: '',
        weekly_goal_hours: 16,
        notifications_enabled: true,
        study_streak_days: 1,
      };
      kernel.state.users.push(found);
      kernel.recordAuditLog(
        found,
        'user',
        'Signed in via Google Firebase Auth',
        `${found.full_name} (${found.email})`,
        `UID: ${cleanUid} · Role: ${found.role}`
      );
    } else {
      if (found.status === 'deactivated') {
        res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
        return;
      }
      if (isAdminEmail && found.role !== 'admin') {
        found.role = 'admin';
      }
      if (cleanName && (!found.full_name || found.full_name === 'User')) {
        found.full_name = cleanName.slice(0, 80);
      }
    }

    kernel.saveState();
    await kernel.flush();
    res.json(
      establishAuthenticatedSession(
        found,
        'credentials',
        `Authenticated via Firebase Google Sign-In (${found.role})`
      )
    );
  });

  app.post('/api/auth/register', async (req, res) => {
    if (kernel.state.platform_settings && !kernel.state.platform_settings.allow_self_registration) {
      res.status(403).json({
        error: 'Self-registration is currently disabled by the platform administrator.',
      });
      return;
    }

    const { username, full_name, email, password, role } = req.body || {};

    // Public registration is strictly permitted for Student accounts only
    if (role && String(role).toLowerCase() !== 'student') {
      res.status(403).json({
        error:
          'Public registration is permitted for Student accounts only. Teacher and Administrator accounts must be created by an Administrator.',
      });
      return;
    }

    const cleanName = String(full_name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const rawPassword = String(password || '');

    if (!cleanName) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    if (rawPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }
    if (kernel.state.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      res.status(400).json({ error: 'An account with that email address is already registered.' });
      return;
    }

    // Derive a clean username if not explicitly provided
    let baseUser = String(username || cleanEmail.split('@')[0] || 'student')
      .trim()
      .replace(/[^A-Za-z0-9_.-]/g, '_')
      .slice(0, 28);
    if (baseUser.length < 3) baseUser = `${baseUser}_student`;

    let finalUsername = baseUser;
    let suffix = 2;
    while (
      kernel.state.users.some((u) => u.username.toLowerCase() === finalUsername.toLowerCase())
    ) {
      finalUsername = `${baseUser}_${suffix}`;
      suffix += 1;
    }

    const nextId = await kernel.nextId('users');
    const now = nowIso();
    const passwordHash = await hashPasswordScrypt(rawPassword);

    const newUser: UserRecord = {
      id: nextId,
      username: finalUsername,
      full_name: cleanName.slice(0, 80),
      email: cleanEmail.slice(0, 120),
      password_hash: passwordHash,
      role: 'student',
      status: 'active',
      token_version: 1,
      created_at: now,
      last_login_at: now,
      department_id: null,
      batch_id: null,
      bio: '',
      weekly_goal_hours: kernel.state.platform_settings?.default_weekly_goal_hours || 12,
      notifications_enabled: true,
      study_streak_days: 0,
    };

    kernel.state.users.push(newUser);
    kernel.recordAuditLog(
      newUser,
      'user',
      'Self-Registered Student Account',
      `${newUser.full_name} (${newUser.email})`,
      `Username: @${newUser.username} · Role: student`
    );

    kernel.saveState();
    await kernel.flush();
    res.json(
      establishAuthenticatedSession(
        newUser,
        'registration',
        'Self-registered Student account created'
      )
    );
  });

  app.post('/api/auth/logout', (req, res) => {
    const rawBearer = String(req.headers.authorization || '');
    const bearerToken = rawBearer.startsWith('Bearer ') ? rawBearer.slice(7).trim() : '';
    const headerToken = String(req.headers['x-lms-session-token'] || bearerToken || '').trim();
    const user = getActiveUser(req);
    if (headerToken) {
      revokedSessionTokens.add(headerToken);
    }
    if (user) {
      kernel.logEvent('security', 'User signed out', 'info', {
        username: user.username,
        role: user.role,
      });
    }
    res.json({ ok: true });
  });

  app.post('/api/profile', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const { full_name, email, bio, weekly_goal_hours, notifications_enabled } = req.body || {};
    if (full_name) user.full_name = String(full_name).trim().slice(0, 80);
    if (email) user.email = String(email).trim().slice(0, 120);
    if (bio !== undefined) user.bio = String(bio).trim().slice(0, 400);
    if (weekly_goal_hours !== undefined) {
      user.weekly_goal_hours = Math.max(1, Math.min(60, Number(weekly_goal_hours) || 16));
    }
    if (notifications_enabled !== undefined) {
      user.notifications_enabled = Boolean(notifications_enabled);
    }
    kernel.saveState();
    res.json({ user: sanitizeUser(user) });
  });

  app.get('/api/courses/:id', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }

    if (user.role === 'student') {
      if (course.published === false || course.approval_status === 'archived') {
        res.status(403).json({ error: 'This course is currently unavailable.' });
        return;
      }
      const isEnrolled = kernel.state.enrollments.some(
        (e) => e.course_id === courseId && e.student_id === user.id
      );
      if (!isEnrolled) {
        res.status(403).json({
          error: 'You must enroll in this course before accessing its learning workspace.',
        });
        return;
      }
    }

    const completedSet = new Set(kernel.state.completed_materials[String(user.id)] || []);
    const bookmarkedSet = new Set(kernel.state.bookmarked_materials[String(user.id)] || []);

    const materials = kernel.state.materials
      .filter((m) => m.course_id === courseId && (user.role !== 'student' || (m.published ?? true)))
      .map((m, idx) => ({
        ...m,
        module_title: m.module_title || 'Module 1 · Core Lessons',
        lesson_number: m.lesson_number || idx + 1,
        duration_minutes: m.duration_minutes || 20,
        course_code: course.code,
        course_title: course.title,
        cache_resident: kernel.cachePages.has(m.id),
        track: trackFor(`material:${m.id}`),
        completed: completedSet.has(m.id),
        bookmarked: bookmarkedSet.has(m.id),
      }));

    const assignments = kernel.state.assignments
      .filter((a) => a.course_id === courseId)
      .map((a) => {
        const subs = kernel.state.submissions.filter((s) => s.assignment_id === a.id);
        const mySub = subs.find((s) => s.student_id === user.id) || null;
        return {
          ...a,
          course_code: course.code,
          course_title: course.title,
          submission_count: subs.length,
          graded_count: subs.filter((s) => s.grade !== null).length,
          my_submission: mySub
            ? { ...mySub, student_name: user.full_name, student_username: user.username }
            : null,
        };
      });

    const announcements = kernel.state.announcements
      .filter((a) => a.course_id === courseId)
      .map((a) => {
        const author = kernel.state.users.find((u) => u.id === a.author_id);
        return {
          ...a,
          course_code: course.code,
          course_title: course.title,
          author_name: author?.full_name || 'Faculty',
        };
      });

    const notes = kernel.state.student_notes
      .filter((n) => n.user_id === user.id && n.course_id === courseId)
      .map((n) => {
        const mat = materials.find((m) => m.id === n.material_id);
        return {
          ...n,
          material_title: mat?.title || 'Lesson',
        };
      });

    res.json({
      course: formatCourseForUser(course, user),
      quiz_questions: course.quiz_questions || [],
      materials,
      assignments,
      announcements,
      notes,
      kernel: kernel.getFullKernelSnapshot(),
    });
  });

  app.post('/api/courses', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    if (user.role !== 'faculty' && user.role !== 'admin') {
      res.status(403).json({ error: 'Only faculty or administrators can create courses.' });
      return;
    }
    const { code, title, description, category, level, faculty_id, department_id, estimated_hours } = req.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanTitle = String(title || '').trim();
    if (!/^[A-Z0-9-]{3,16}$/.test(cleanCode) || !cleanTitle) {
      res.status(400).json({ error: 'Provide a valid course code (3–16 alphanumeric chars) and title.' });
      return;
    }
    if (kernel.state.courses.some((c) => c.code.toUpperCase() === cleanCode)) {
      res.status(400).json({ error: 'A course with that code already exists.' });
      return;
    }
    const nextId = await kernel.nextId('courses');
    const themes: Array<'lavender' | 'mint' | 'peach'> = ['lavender', 'mint', 'peach'];
    const requiresApproval =
      user.role === 'faculty' && Boolean(kernel.state.platform_settings?.require_course_approval);
    const assignedFacultyId =
      user.role === 'admin' && faculty_id ? Number(faculty_id) : user.id;

    const newCourse: CourseRecord = {
      id: nextId,
      code: cleanCode,
      title: cleanTitle.slice(0, 120),
      category: String(category || 'Computer Science'),
      level: String(level || 'Intermediate'),
      estimated_hours: Math.max(1, Number(estimated_hours) || 14),
      accent_theme: themes[nextId % 3],
      description: String(description || '').trim().slice(0, 1200),
      faculty_id: assignedFacultyId,
      faculty_title: 'Course Instructor',
      published: !requiresApproval,
      approval_status: requiresApproval ? 'pending' : 'approved',
      department_id: department_id ? Number(department_id) : null,
      created_at: nowIso(),
      quiz_questions: [],
    };
    kernel.state.courses.push(newCourse);
    kernel.recordAuditLog(
      user,
      'course',
      'Created Course',
      `${newCourse.code} · ${newCourse.title}`,
      `Status: ${newCourse.approval_status}`
    );
    kernel.saveState();
    res.json({ course: formatCourseForUser(newCourse, user) });
  });

  app.post('/api/courses/:id/enroll', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    if (course.published === false || course.approval_status === 'archived') {
      res.status(400).json({ error: 'This course is not currently open for enrollment.' });
      return;
    }
    const exists = kernel.state.enrollments.some(
      (e) => e.course_id === courseId && e.student_id === user.id
    );
    if (!exists) {
      kernel.state.enrollments.push({
        student_id: user.id,
        course_id: courseId,
        enrolled_at: nowIso(),
      });
      kernel.saveState();
      await kernel.flush();
    }
    res.json({ enrolled: true });
  });

  app.get('/api/materials/:id', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const matId = Number(req.params.id);
    const pageLoad = kernel.getMaterialPage(matId);
    if (!pageLoad.material) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }
    const completedSet = new Set(kernel.state.completed_materials[String(user.id)] || []);
    const bookmarkedSet = new Set(kernel.state.bookmarked_materials[String(user.id)] || []);

    res.json({
      material: {
        ...pageLoad.material,
        course_code: pageLoad.course_code,
        course_title: pageLoad.course_title,
        cache_resident: true,
        track: pageLoad.disk_track,
        completed: completedSet.has(matId),
        bookmarked: bookmarkedSet.has(matId),
      },
      telemetry: {
        cache_hit: pageLoad.cache_hit,
        evicted_id: pageLoad.evicted_id,
        disk_track: pageLoad.disk_track,
        disk_movement: pageLoad.disk_movement,
      },
      kernel: kernel.getFullKernelSnapshot(),
    });
  });

  // Toggle Lesson Completion
  app.post('/api/materials/:id/complete', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const matId = Number(req.params.id);
    const key = String(user.id);
    const current = new Set(kernel.state.completed_materials[key] || []);
    let completed: boolean;
    if (current.has(matId)) {
      current.delete(matId);
      completed = false;
    } else {
      current.add(matId);
      completed = true;
    }
    kernel.state.completed_materials[key] = Array.from(current);
    kernel.saveState();
    res.json({ completed, completed_ids: kernel.state.completed_materials[key] });
  });

  // Toggle Lesson Bookmark
  app.post('/api/materials/:id/bookmark', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const matId = Number(req.params.id);
    const key = String(user.id);
    const current = new Set(kernel.state.bookmarked_materials[key] || []);
    let bookmarked: boolean;
    if (current.has(matId)) {
      current.delete(matId);
      bookmarked = false;
    } else {
      current.add(matId);
      bookmarked = true;
    }
    kernel.state.bookmarked_materials[key] = Array.from(current);
    kernel.saveState();
    res.json({ bookmarked, bookmarked_ids: kernel.state.bookmarked_materials[key] });
  });

  // Create Student Note on a Lesson
  app.post('/api/materials/:id/notes', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const matId = Number(req.params.id);
    const mat = kernel.state.materials.find((m) => m.id === matId);
    if (!mat) {
      res.status(404).json({ error: 'Lesson not found' });
      return;
    }
    const content = String(req.body?.content || '').trim();
    const timestampLabel = String(req.body?.timestamp_label || '04:20').trim();
    if (!content) {
      res.status(400).json({ error: 'Note content is required.' });
      return;
    }
    const nextId = await kernel.nextId('student_notes');
    const note: StudentNoteRecord = {
      id: nextId,
      user_id: user.id,
      course_id: mat.course_id,
      material_id: matId,
      timestamp_label: timestampLabel,
      content: content.slice(0, 2000),
      created_at: nowIso(),
    };
    kernel.state.student_notes.unshift(note);
    kernel.saveState();
    res.json({
      note: {
        ...note,
        material_title: mat.title,
      },
    });
  });

  app.delete('/api/notes/:id', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const noteId = Number(req.params.id);
    kernel.state.student_notes = kernel.state.student_notes.filter(
      (n) => !(n.id === noteId && n.user_id === user.id)
    );
    kernel.saveState();
    res.json({ ok: true });
  });

  // Submit Course Quiz Score
  app.post('/api/courses/:id/quiz', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const courseId = Number(req.params.id);
    const score = Math.max(0, Math.min(100, Number(req.body?.score) || 0));
    const uKey = String(user.id);
    if (!kernel.state.quiz_scores[uKey]) kernel.state.quiz_scores[uKey] = {};
    kernel.state.quiz_scores[uKey][String(courseId)] = score;
    kernel.saveState();
    await kernel.flush();
    res.json({ score });
  });

  // Add / Remove Personal Schedule Events
  app.post('/api/schedule', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const { title, course_code, date, time, duration_label, type, location } = req.body || {};
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      res.status(400).json({ error: 'Event title is required' });
      return;
    }
    const nextId = await kernel.nextId('schedule_events');
    const ev: ScheduleEventRecord = {
      id: nextId,
      user_id: user.id,
      title: cleanTitle.slice(0, 120),
      course_code: String(course_code || 'STUDY').toUpperCase(),
      date: String(date || 'Wednesday'),
      time: String(time || '03:00 PM'),
      duration_label: String(duration_label || '45 min'),
      type: ['lecture', 'deadline', 'study', 'workshop'].includes(type) ? type : 'study',
      location: String(location || 'Study Room'),
    };
    kernel.state.schedule_events.push(ev);
    kernel.saveState();
    res.json({ event: ev });
  });

  app.delete('/api/schedule/:id', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const evId = Number(req.params.id);
    kernel.state.schedule_events = kernel.state.schedule_events.filter(
      (e) => !(e.id === evId && (e.user_id === user.id || user.role === 'admin'))
    );
    kernel.saveState();
    res.json({ ok: true });
  });

  app.post('/api/courses/:id/materials', uploadMiddleware('file'), async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    if (user.role !== 'admin' && !(user.role === 'faculty' && course.faculty_id === user.id)) {
      res.status(403).json({ error: 'Only the course instructor or administrator can publish materials.' });
      return;
    }

    const { title, body, module_title, duration_minutes } = req.body || {};
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      res.status(400).json({ error: 'Material title is required.' });
      return;
    }

    let originalName: string | null = null;
    let storedName: string | null = null;
    let fileSize = 0;
    let contentType: string | null = null;

    if (req.file) {
      const buf = req.file.buffer;
      if (kernel.courseStorageUsed(courseId) + buf.length > MAX_COURSE_STORAGE_BYTES) {
        res.status(400).json({ error: 'Course storage quota (50 MB) exceeded.' });
        return;
      }
      try {
        const saved = await kernel.saveUpload(req.file.originalname, buf);
        originalName = saved.originalName;
        storedName = saved.storedName;
        fileSize = saved.size;
        contentType = saved.contentType;
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'File upload failed.' });
        return;
      }
    }

    const existingCourseMats = kernel.state.materials.filter((m) => m.course_id === courseId);
    const nextId = await kernel.nextId('materials');
    const mat: MaterialRecord = {
      id: nextId,
      course_id: courseId,
      module_title: String(module_title || 'Module 2 · Extended Lessons'),
      lesson_number: existingCourseMats.length + 1,
      duration_minutes: Math.max(5, Number(duration_minutes) || 20),
      video_summary: `Instructor lecture notes and walkthrough for ${cleanTitle}.`,
      key_takeaways: [
        'Review the core definitions and examples in the lecture notes below.',
        'Complete the lesson check and add personal study notes.',
      ],
      title: cleanTitle.slice(0, 140),
      body: String(body || '').trim().slice(0, 20000),
      original_name: originalName,
      stored_name: storedName,
      file_size: fileSize,
      content_type: contentType,
      created_by: user.id,
      created_at: nowIso(),
    };

    kernel.state.materials.push(mat);
    kernel.recordAuditLog(
      user,
      'course',
      'Published Lesson Material',
      `${course.code} · ${mat.title}`,
      `Module: ${mat.module_title}`
    );
    kernel.saveState();
    await kernel.flush();

    kernel.scheduleJob('reindex', `Rebuild search index for ${course.code}`, {}, 3, 2);
    const studentIds = kernel.state.enrollments
      .filter((e) => e.course_id === courseId)
      .map((e) => e.student_id);
    if (studentIds.length > 0) {
      kernel.scheduleJob(
        'notify',
        `New lesson in ${course.code}: ${mat.title}`,
        {
          recipients: studentIds,
          title: `New lesson in ${course.code}`,
          body: `${mat.title} was added to ${course.title}.`,
          link: `/courses/${courseId}`,
        },
        1,
        1
      );
    }

    res.json({ material: mat, kernel: kernel.getFullKernelSnapshot() });
  });

  app.post('/api/courses/:id/assignments', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    if (user.role !== 'admin' && !(user.role === 'faculty' && course.faculty_id === user.id)) {
      res.status(403).json({ error: 'Only the course instructor or admin can create assignments.' });
      return;
    }

    const { title, description, due_at, max_score } = req.body || {};
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || !due_at) {
      res.status(400).json({ error: 'Assignment title and due date are required.' });
      return;
    }

    const nextId = await kernel.nextId('assignments');
    const asgn: AssignmentRecord = {
      id: nextId,
      course_id: courseId,
      title: cleanTitle.slice(0, 140),
      description: String(description || '').trim().slice(0, 8000),
      due_at: String(due_at),
      max_score: Math.max(1, Math.min(1000, Number(max_score) || 100)),
      created_by: user.id,
      created_at: nowIso(),
    };
    kernel.state.assignments.push(asgn);
    kernel.recordAuditLog(
      user,
      'course',
      'Created Assignment',
      `${course.code} · ${asgn.title}`,
      `Max Score: ${asgn.max_score}, Due: ${asgn.due_at}`
    );
    kernel.saveState();

    const studentIds = kernel.state.enrollments
      .filter((e) => e.course_id === courseId)
      .map((e) => e.student_id);
    if (studentIds.length > 0) {
      kernel.scheduleJob(
        'notify',
        `New assignment in ${course.code}: ${asgn.title}`,
        {
          recipients: studentIds,
          title: `New assignment in ${course.code}`,
          body: `${asgn.title} is due ${asgn.due_at.replace('T', ' ')}.`,
          link: `/assignments/${asgn.id}`,
        },
        1,
        1
      );
    }

    res.json({ assignment: asgn, kernel: kernel.getFullKernelSnapshot() });
  });

  app.post('/api/courses/:id/announcements', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    if (user.role !== 'admin' && !(user.role === 'faculty' && course.faculty_id === user.id)) {
      res.status(403).json({ error: 'Only the course instructor or admin can post announcements.' });
      return;
    }

    const { title, body } = req.body || {};
    const cleanTitle = String(title || '').trim();
    const cleanBody = String(body || '').trim();
    if (!cleanTitle || !cleanBody) {
      res.status(400).json({ error: 'Announcement title and message are required.' });
      return;
    }

    const nextId = await kernel.nextId('announcements');
    const ann: AnnouncementRecord = {
      id: nextId,
      course_id: courseId,
      target_audience: 'course',
      title: cleanTitle.slice(0, 140),
      body: cleanBody.slice(0, 5000),
      author_id: user.id,
      created_at: nowIso(),
    };
    kernel.state.announcements.unshift(ann);
    kernel.recordAuditLog(
      user,
      'announcement',
      'Posted Course Announcement',
      `${course.code} · ${ann.title}`,
      ann.body.slice(0, 120)
    );
    kernel.saveState();

    const studentIds = kernel.state.enrollments
      .filter((e) => e.course_id === courseId)
      .map((e) => e.student_id);
    if (studentIds.length > 0) {
      kernel.scheduleJob(
        'notify',
        `Announcement in ${course.code}: ${ann.title}`,
        {
          recipients: studentIds,
          title: `${course.code}: ${ann.title}`,
          body: ann.body.slice(0, 240),
          link: `/courses/${courseId}`,
        },
        1,
        1
      );
    }

    res.json({ announcement: ann, kernel: kernel.getFullKernelSnapshot() });
  });

  app.get('/api/assignments/:id', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const asgnId = Number(req.params.id);
    const asgn = kernel.state.assignments.find((a) => a.id === asgnId);
    if (!asgn) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    const course = kernel.state.courses.find((c) => c.id === asgn.course_id);
    const allSubs = kernel.state.submissions
      .filter((s) => s.assignment_id === asgnId)
      .map((s) => {
        const st = kernel.state.users.find((u) => u.id === s.student_id);
        return {
          ...s,
          student_name: st?.full_name || 'Student',
          student_username: st?.username || 'student',
        };
      });

    const mySub = allSubs.find((s) => s.student_id === user.id) || null;
    const canViewAll = user.role === 'admin' || (user.role === 'faculty' && course?.faculty_id === user.id);
    // Only the assigned course teacher can grade submissions so Administrators monitor without overwriting teacher grades
    const canGrade = user.role === 'faculty' && course?.faculty_id === user.id;

    res.json({
      assignment: {
        ...asgn,
        course_code: course?.code || '',
        course_title: course?.title || '',
        submission_count: allSubs.length,
        graded_count: allSubs.filter((s) => s.grade !== null).length,
        my_submission: mySub,
        submissions: canViewAll ? allSubs : mySub ? [mySub] : [],
      },
      can_manage: canGrade,
      can_view_all: canViewAll,
    });
  });

  app.post('/api/assignments/:id/submit', uploadMiddleware('file'), async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    if (user.role !== 'student') {
      res.status(403).json({ error: 'Only students can submit assignment work.' });
      return;
    }
    const asgnId = Number(req.params.id);
    const asgn = kernel.state.assignments.find((a) => a.id === asgnId);
    if (!asgn) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    const { body } = req.body || {};
    const cleanBody = String(body || '').trim();
    if (!cleanBody && !req.file) {
      res.status(400).json({ error: 'Provide a written response or attach a submission file.' });
      return;
    }

    let originalName: string | null = null;
    let storedName: string | null = null;
    let fileSize = 0;
    let contentType: string | null = null;

    if (req.file) {
      const buf = req.file.buffer;
      if (kernel.courseStorageUsed(asgn.course_id) + buf.length > MAX_COURSE_STORAGE_BYTES) {
        res.status(400).json({ error: 'Course storage quota (50 MB) exceeded.' });
        return;
      }
      try {
        const saved = await kernel.saveUpload(req.file.originalname, buf);
        originalName = saved.originalName;
        storedName = saved.storedName;
        fileSize = saved.size;
        contentType = saved.contentType;
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'File upload failed.' });
        return;
      }
    }

    let sub = kernel.state.submissions.find(
      (s) => s.assignment_id === asgnId && s.student_id === user.id
    );
    if (sub) {
      sub.body = cleanBody.slice(0, 20000);
      if (storedName) {
        sub.original_name = originalName;
        sub.stored_name = storedName;
        sub.file_size = fileSize;
        sub.content_type = contentType;
      }
      sub.submitted_at = nowIso();
    } else {
      const nextId = await kernel.nextId('submissions');
      sub = {
        id: nextId,
        assignment_id: asgnId,
        student_id: user.id,
        body: cleanBody.slice(0, 20000),
        original_name: originalName,
        stored_name: storedName,
        file_size: fileSize,
        content_type: contentType,
        submitted_at: nowIso(),
        grade: null,
        feedback: null,
        graded_at: null,
      };
      kernel.state.submissions.push(sub);
    }

    kernel.saveState();
    await kernel.flush();
    const course = kernel.state.courses.find((c) => c.id === asgn.course_id);
    if (course) {
      kernel.scheduleJob(
        'notify',
        `Submission received: ${asgn.title} (${user.full_name})`,
        {
          recipients: [course.faculty_id],
          title: `New submission for ${asgn.title}`,
          body: `${user.full_name} submitted work for ${asgn.title} in ${course.code}.`,
          link: `/assignments/${asgn.id}`,
        },
        2,
        1
      );
    }

    res.json({ submission: sub, kernel: kernel.getFullKernelSnapshot() });
  });

  app.post('/api/submissions/:id/grade', async (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    const subId = Number(req.params.id);
    const sub = kernel.state.submissions.find((s) => s.id === subId);
    if (!sub) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }
    const asgn = kernel.state.assignments.find((a) => a.id === sub.assignment_id);
    const course = kernel.state.courses.find((c) => c.id === asgn?.course_id);
    if (!(user.role === 'faculty' && course?.faculty_id === user.id)) {
      res.status(403).json({
        error: 'Only the assigned course instructor may evaluate and record grades for this course.',
      });
      return;
    }

    const gradeNum = Number(req.body?.grade);
    if (Number.isNaN(gradeNum) || gradeNum < 0 || gradeNum > (asgn?.max_score || 100)) {
      res.status(400).json({ error: `Grade must be between 0 and ${asgn?.max_score || 100}.` });
      return;
    }

    sub.grade = Number(gradeNum.toFixed(1));
    sub.feedback = String(req.body?.feedback || '').trim().slice(0, 4000);
    sub.graded_at = nowIso();
    kernel.recordAuditLog(
      user,
      'submission',
      'Evaluated Submission',
      `${course?.code || 'COURSE'} · ${asgn?.title || 'Assignment'}`,
      `Grade: ${sub.grade}/${asgn?.max_score || 100}`
    );
    kernel.saveState();
    await kernel.flush();

    kernel.scheduleJob(
      'notify',
      `Graded: ${asgn?.title || 'Assignment'}`,
      {
        recipients: [sub.student_id],
        title: `Grade posted for ${asgn?.title || 'Assignment'}`,
        body: `You scored ${sub.grade}/${asgn?.max_score || 100}. ${sub.feedback ? `Feedback: ${sub.feedback}` : ''}`,
        link: `/assignments/${sub.assignment_id}`,
      },
      1,
      1
    );

    res.json({ submission: sub, kernel: kernel.getFullKernelSnapshot() });
  });

  // ============================================================================
  // ADMINISTRATOR DASHBOARD & ROLE MANAGEMENT SYSTEM ENDPOINTS (/api/admin/*)
  // ============================================================================

  const buildAdminOverviewPayload = (adminUser: UserRecord) => {
    const users = kernel.state.users.map((u) => sanitizeUser(u));
    const students = kernel.state.users.filter((u) => u.role === 'student');
    const teachers = kernel.state.users.filter((u) => u.role === 'faculty');
    const admins = kernel.state.users.filter((u) => u.role === 'admin');

    const courses = kernel.state.courses.map((c) => formatCourseForUser(c, adminUser));
    const activeCourses = courses.filter(
      (c) => (c.published ?? true) && (c.approval_status || 'approved') === 'approved'
    );
    const pendingCourses = courses.filter((c) => c.approval_status === 'pending');

    const enrollments = kernel.state.enrollments.map((e) => {
      const st = kernel.state.users.find((u) => u.id === e.student_id);
      const co = kernel.state.courses.find((c) => c.id === e.course_id);
      return {
        ...e,
        student_name: st?.full_name || `Student #${e.student_id}`,
        student_username: st?.username || 'student',
        course_code: co?.code || `COURSE-${e.course_id}`,
        course_title: co?.title || 'Course',
      };
    });

    const nowMs = Date.now();
    const assignmentsMonitoring = kernel.state.assignments.map((a) => {
      const course = kernel.state.courses.find((c) => c.id === a.course_id);
      const faculty = kernel.state.users.find((u) => u.id === course?.faculty_id);
      const enrolledCount = kernel.state.enrollments.filter((e) => e.course_id === a.course_id).length;
      const subs = kernel.state.submissions.filter((s) => s.assignment_id === a.id);
      const gradedSubs = subs.filter((s) => s.grade !== null);
      const pendingSubs = subs.filter((s) => s.grade === null);
      const dueMs = new Date(a.due_at).getTime();
      const isOverdue = !Number.isNaN(dueMs) && dueMs < nowMs;
      const missingCount = Math.max(0, enrolledCount - subs.length);
      const avgScore =
        gradedSubs.length > 0
          ? Number(
              (
                gradedSubs.reduce((sum, s) => sum + (s.grade || 0), 0) / gradedSubs.length
              ).toFixed(1)
            )
          : null;

      return {
        id: a.id,
        course_id: a.course_id,
        course_code: course?.code || 'COURSE',
        course_title: course?.title || 'Course',
        faculty_name: faculty?.full_name || 'Instructor',
        title: a.title,
        description: a.description,
        due_at: a.due_at,
        max_score: a.max_score,
        enrolled_students: enrolledCount,
        submission_count: subs.length,
        graded_count: gradedSubs.length,
        pending_evaluation_count: pendingSubs.length,
        overdue_missing_count: isOverdue ? missingCount : 0,
        average_score: avgScore,
        submissions: subs.map((s) => {
          const st = kernel.state.users.find((u) => u.id === s.student_id);
          return {
            ...s,
            student_name: st?.full_name || 'Student',
            student_username: st?.username || 'student',
          };
        }),
      };
    });

    // Calculate overall completion rate across all actual student enrollments
    let totalEnrollmentProgress = 0;
    for (const enr of kernel.state.enrollments) {
      const courseMats = kernel.state.materials.filter((m) => m.course_id === enr.course_id);
      if (courseMats.length === 0) continue;
      const compSet = new Set(kernel.state.completed_materials[String(enr.student_id)] || []);
      const done = courseMats.filter((m) => compSet.has(m.id)).length;
      totalEnrollmentProgress += Math.round((done / courseMats.length) * 100);
    }
    const overallCompletionRate =
      kernel.state.enrollments.length > 0
        ? Math.round(totalEnrollmentProgress / kernel.state.enrollments.length)
        : null;

    // Calculate overall average grade (% of max_score) across all graded submissions
    const allGraded = kernel.state.submissions.filter((s) => s.grade !== null);
    let overallAverageGrade: number | null = null;
    if (allGraded.length > 0) {
      const sumPct = allGraded.reduce((acc, s) => {
        const asgn = kernel.state.assignments.find((a) => a.id === s.assignment_id);
        const max = asgn?.max_score || 100;
        return acc + ((s.grade || 0) / max) * 100;
      }, 0);
      overallAverageGrade = Number((sumPct / allGraded.length).toFixed(1));
    }

    // Course engagement metrics from real database records
    const courseEngagement = kernel.state.courses.map((c) => {
      const fac = kernel.state.users.find((u) => u.id === c.faculty_id);
      const enrList = kernel.state.enrollments.filter((e) => e.course_id === c.id);
      const cMats = kernel.state.materials.filter((m) => m.course_id === c.id);
      const cAsgns = kernel.state.assignments.filter((a) => a.course_id === c.id);
      const cAsgnIds = new Set(cAsgns.map((a) => a.id));
      const cSubs = kernel.state.submissions.filter((s) => cAsgnIds.has(s.assignment_id));
      const cGraded = cSubs.filter((s) => s.grade !== null);

      let sumComp = 0;
      for (const e of enrList) {
        if (cMats.length === 0) continue;
        const set = new Set(kernel.state.completed_materials[String(e.student_id)] || []);
        const done = cMats.filter((m) => set.has(m.id)).length;
        sumComp += Math.round((done / cMats.length) * 100);
      }
      const avgComp = enrList.length > 0 ? Math.round(sumComp / enrList.length) : 0;
      const avgGrade =
        cGraded.length > 0
          ? Number(
              (
                cGraded.reduce((acc, s) => {
                  const a = cAsgns.find((x) => x.id === s.assignment_id);
                  return acc + ((s.grade || 0) / (a?.max_score || 100)) * 100;
                }, 0) / cGraded.length
              ).toFixed(1)
            )
          : null;

      return {
        course_id: c.id,
        course_code: c.code,
        course_title: c.title,
        faculty_name: fac?.full_name || 'Instructor',
        enrolled_students: enrList.length,
        material_count: cMats.length,
        assignment_count: cAsgns.length,
        submission_count: cSubs.length,
        average_completion_percent: avgComp,
        average_grade: avgGrade,
      };
    });

    // Teacher activity metrics from real database records
    const teacherActivity = teachers.map((t) => {
      const tCourses = kernel.state.courses.filter((c) => c.faculty_id === t.id);
      const tCourseIds = new Set(tCourses.map((c) => c.id));
      const tMats = kernel.state.materials.filter(
        (m) => m.created_by === t.id || tCourseIds.has(m.course_id)
      );
      const tAsgns = kernel.state.assignments.filter(
        (a) => a.created_by === t.id || tCourseIds.has(a.course_id)
      );
      const tAsgnIds = new Set(tAsgns.map((a) => a.id));
      const tSubs = kernel.state.submissions.filter((s) => tAsgnIds.has(s.assignment_id));
      const tAnns = kernel.state.announcements.filter((a) => a.author_id === t.id);

      return {
        faculty_id: t.id,
        full_name: t.full_name,
        username: t.username,
        email: t.email,
        status: (t.status || 'active') as 'active' | 'deactivated',
        assigned_courses: tCourses.length,
        materials_uploaded: tMats.length,
        assignments_created: tAsgns.length,
        submissions_evaluated: tSubs.filter((s) => s.grade !== null).length,
        pending_evaluations: tSubs.filter((s) => s.grade === null).length,
        announcements_posted: tAnns.length,
      };
    });

    // Student performance metrics from real database records
    const studentPerformance = students.map((st) => {
      const stEnr = kernel.state.enrollments.filter((e) => e.student_id === st.id);
      const compSet = new Set(kernel.state.completed_materials[String(st.id)] || []);
      const stSubs = kernel.state.submissions.filter((s) => s.student_id === st.id);
      const stGraded = stSubs.filter((s) => s.grade !== null);

      let sumPct = 0;
      for (const e of stEnr) {
        const cMats = kernel.state.materials.filter((m) => m.course_id === e.course_id);
        if (cMats.length === 0) continue;
        const done = cMats.filter((m) => compSet.has(m.id)).length;
        sumPct += Math.round((done / cMats.length) * 100);
      }
      const avgCompletion = stEnr.length > 0 ? Math.round(sumPct / stEnr.length) : 0;

      const avgGrade =
        stGraded.length > 0
          ? Number(
              (
                stGraded.reduce((acc, s) => {
                  const a = kernel.state.assignments.find((x) => x.id === s.assignment_id);
                  return acc + ((s.grade || 0) / (a?.max_score || 100)) * 100;
                }, 0) / stGraded.length
              ).toFixed(1)
            )
          : null;

      const qObj = kernel.state.quiz_scores[String(st.id)] || {};
      const qVals = Object.values(qObj);
      const quizAvg =
        qVals.length > 0
          ? Number((qVals.reduce((a, b) => a + b, 0) / qVals.length).toFixed(1))
          : null;

      return {
        student_id: st.id,
        full_name: st.full_name,
        username: st.username,
        email: st.email,
        status: (st.status || 'active') as 'active' | 'deactivated',
        enrolled_courses: stEnr.length,
        completed_lessons: compSet.size,
        submissions_count: stSubs.length,
        graded_submissions_count: stGraded.length,
        average_grade: avgGrade,
        average_completion_percent: avgCompletion,
        quiz_average: quizAvg,
      };
    });

    const departments = (kernel.state.departments || []).map((d) => {
      const head = kernel.state.users.find((u) => u.id === d.head_faculty_id);
      return {
        ...d,
        head_faculty_name: head?.full_name || 'Unassigned',
        course_count: kernel.state.courses.filter((c) => c.department_id === d.id).length,
        subject_count: (kernel.state.subjects || []).filter((s) => s.department_id === d.id).length,
        batch_count: (kernel.state.batches || []).filter((b) => b.department_id === d.id).length,
      };
    });

    const subjects = (kernel.state.subjects || []).map((s) => {
      const dept = (kernel.state.departments || []).find((d) => d.id === s.department_id);
      return {
        ...s,
        department_name: dept?.name || 'General',
      };
    });

    const batches = (kernel.state.batches || []).map((b) => {
      const dept = (kernel.state.departments || []).find((d) => d.id === b.department_id);
      const advisor = kernel.state.users.find((u) => u.id === b.advisor_faculty_id);
      return {
        ...b,
        department_name: dept?.name || 'General',
        advisor_faculty_name: advisor?.full_name || 'Unassigned',
      };
    });

    const announcements = kernel.state.announcements.map((a) => {
      const course = a.course_id ? kernel.state.courses.find((c) => c.id === a.course_id) : null;
      const author = kernel.state.users.find((u) => u.id === a.author_id);
      return {
        ...a,
        course_code: course?.code || 'PLATFORM',
        course_title: course?.title || 'Platform-Wide Notice',
        author_name: author?.full_name || 'Administrator',
        author_role: author?.role || 'admin',
      };
    });

    const snap = kernel.getFullKernelSnapshot();

    return {
      stats: {
        total_users: kernel.state.users.length,
        active_users: kernel.state.users.filter((u) => (u.status || 'active') === 'active').length,
        deactivated_users: kernel.state.users.filter((u) => u.status === 'deactivated').length,
        total_students: students.length,
        total_teachers: teachers.length,
        total_admins: admins.length,
        total_courses: kernel.state.courses.length,
        active_courses: activeCourses.length,
        pending_courses: pendingCourses.length,
        total_enrollments: kernel.state.enrollments.length,
        total_materials: kernel.state.materials.length,
        total_assignments: kernel.state.assignments.length,
        total_submissions: kernel.state.submissions.length,
        graded_submissions: allGraded.length,
        pending_evaluations: kernel.state.submissions.length - allGraded.length,
        total_announcements: kernel.state.announcements.length,
        total_departments: departments.length,
        total_subjects: subjects.length,
        total_batches: batches.length,
        overall_completion_rate: overallCompletionRate,
        overall_average_grade: overallAverageGrade,
        storage_used_bytes: snap.storage.total_bytes,
      },
      analytics: {
        course_engagement: courseEngagement,
        teacher_activity: teacherActivity,
        student_performance: studentPerformance,
      },
      users,
      courses,
      enrollments,
      departments,
      subjects,
      batches,
      assignments_monitoring: assignmentsMonitoring,
      announcements,
      audit_logs: kernel.state.audit_logs || [],
      login_activity: kernel.state.login_activity || [],
      platform_settings: kernel.state.platform_settings!,
      backups: snap.backups,
    };
  };

  app.get('/api/admin/overview', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    res.json(buildAdminOverviewPayload(admin));
  });

  // --- Admin User Management ---
  app.post('/api/admin/users', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const {
      username,
      full_name,
      email,
      password,
      role,
      department_id,
      batch_id,
      bio,
      weekly_goal_hours,
    } = req.body || {};
    const cleanUser = String(username || '').trim();
    const cleanName = String(full_name || '').trim();
    const cleanEmail = String(email || '').trim();

    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(cleanUser)) {
      res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, ., _, -).' });
      return;
    }
    if (!cleanName || !cleanEmail) {
      res.status(400).json({ error: 'Full name and email address are required.' });
      return;
    }
    if (kernel.state.users.some((u) => u.username.toLowerCase() === cleanUser.toLowerCase())) {
      res.status(400).json({ error: 'A user with that username already exists.' });
      return;
    }
    if (!password || String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const validRole: UserRecord['role'] =
      role === 'admin' || role === 'faculty' || role === 'student' ? role : 'student';
    const nextId = await kernel.nextId('users');
    const passwordHash = await hashPasswordScrypt(String(password));

    const newUser: UserRecord = {
      id: nextId,
      username: cleanUser,
      full_name: cleanName.slice(0, 80),
      email: cleanEmail.slice(0, 120),
      password_hash: passwordHash,
      role: validRole,
      status: 'active',
      token_version: 1,
      created_at: nowIso(),
      last_login_at: null,
      department_id: department_id ? Number(department_id) : null,
      batch_id: batch_id ? Number(batch_id) : null,
      bio: String(bio || '').trim().slice(0, 400),
      weekly_goal_hours: Math.max(1, Math.min(60, Number(weekly_goal_hours) || 14)),
      notifications_enabled: true,
      study_streak_days: 0,
    };
    kernel.state.users.push(newUser);
    kernel.recordAuditLog(
      admin,
      'user',
      'Created User Account',
      `${newUser.full_name} (@${newUser.username})`,
      `Assigned role: ${newUser.role}`
    );
    kernel.saveState();
    res.json({ user: sanitizeUser(newUser), overview: buildAdminOverviewPayload(admin) });
  });

  app.put('/api/admin/users/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const targetId = Number(req.params.id);
    const target = kernel.state.users.find((u) => u.id === targetId);
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const { full_name, email, role, department_id, batch_id, bio, weekly_goal_hours } = req.body || {};
    const prevRole = target.role;

    if (role && ['admin', 'faculty', 'student'].includes(role)) {
      if (target.id === admin.id && role !== 'admin') {
        res.status(400).json({ error: 'You cannot demote your own active administrator account.' });
        return;
      }
      target.role = role;
    }
    if (full_name !== undefined && String(full_name).trim()) {
      target.full_name = String(full_name).trim().slice(0, 80);
    }
    if (email !== undefined && String(email).trim()) {
      target.email = String(email).trim().slice(0, 120);
    }
    if (department_id !== undefined) {
      target.department_id = department_id ? Number(department_id) : null;
    }
    if (batch_id !== undefined) {
      target.batch_id = batch_id ? Number(batch_id) : null;
    }
    if (bio !== undefined) {
      target.bio = String(bio).trim().slice(0, 400);
    }
    if (weekly_goal_hours !== undefined) {
      target.weekly_goal_hours = Math.max(1, Math.min(60, Number(weekly_goal_hours) || 14));
    }

    kernel.recordAuditLog(
      admin,
      prevRole !== target.role ? 'security' : 'user',
      prevRole !== target.role ? `Changed Role (${prevRole} → ${target.role})` : 'Updated User Profile',
      `${target.full_name} (@${target.username})`,
      `Email: ${target.email}, Role: ${target.role}`
    );
    kernel.saveState();
    res.json({ user: sanitizeUser(target), overview: buildAdminOverviewPayload(admin) });
  });

  app.post('/api/admin/users/:id/status', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const targetId = Number(req.params.id);
    const target = kernel.state.users.find((u) => u.id === targetId);
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    if (target.id === admin.id) {
      res.status(400).json({ error: 'You cannot deactivate your own administrator account.' });
      return;
    }
    const nextStatus = req.body?.status === 'deactivated' ? 'deactivated' : 'active';
    target.status = nextStatus;
    kernel.recordAuditLog(
      admin,
      'security',
      nextStatus === 'deactivated' ? 'Deactivated Account' : 'Reactivated Account',
      `${target.full_name} (@${target.username})`,
      `Status set to ${nextStatus}`
    );
    kernel.saveState();
    res.json({ user: sanitizeUser(target), overview: buildAdminOverviewPayload(admin) });
  });

  app.post('/api/admin/users/:id/reset-password', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const targetId = Number(req.params.id);
    const target = kernel.state.users.find((u) => u.id === targetId);
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    const newPassword = String(req.body?.new_password || '').trim();
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long.' });
      return;
    }
    target.password_hash = await hashPasswordScrypt(newPassword);
    target.token_version = (target.token_version || 1) + 1;
    kernel.recordAuditLog(
      admin,
      'security',
      'Reset User Password',
      `${target.full_name} (@${target.username})`,
      'Password hash updated and existing sessions invalidated by administrator'
    );
    kernel.saveState();
    await kernel.flush();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  app.delete('/api/admin/users/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const targetId = Number(req.params.id);
    const target = kernel.state.users.find((u) => u.id === targetId);
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    if (target.id === admin.id) {
      res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
      return;
    }
    kernel.state.users = kernel.state.users.filter((u) => u.id !== targetId);
    kernel.state.enrollments = kernel.state.enrollments.filter((e) => e.student_id !== targetId);
    kernel.state.student_notes = kernel.state.student_notes.filter((n) => n.user_id !== targetId);
    kernel.state.notifications = kernel.state.notifications.filter((n) => n.user_id !== targetId);
    delete kernel.state.completed_materials[String(targetId)];
    delete kernel.state.bookmarked_materials[String(targetId)];
    delete kernel.state.quiz_scores[String(targetId)];

    kernel.recordAuditLog(
      admin,
      'user',
      'Deleted User Account',
      `${target.full_name} (@${target.username})`,
      `Removed ${target.role} account ID #${target.id}`
    );
    kernel.saveState();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  // --- Admin Course Management ---
  app.post('/api/admin/courses', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const {
      code,
      title,
      category,
      level,
      estimated_hours,
      description,
      faculty_id,
      department_id,
      published,
      approval_status,
    } = req.body || {};

    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanTitle = String(title || '').trim();
    if (!/^[A-Z0-9-]{3,16}$/.test(cleanCode) || !cleanTitle) {
      res.status(400).json({ error: 'Valid course code (3–16 alphanumeric chars) and title are required.' });
      return;
    }
    if (kernel.state.courses.some((c) => c.code.toUpperCase() === cleanCode)) {
      res.status(400).json({ error: 'A course with that code already exists.' });
      return;
    }
    const nextId = await kernel.nextId('courses');
    const themes: Array<'lavender' | 'mint' | 'peach'> = ['lavender', 'mint', 'peach'];
    const instructor =
      kernel.state.users.find((u) => u.id === Number(faculty_id)) ||
      kernel.state.users.find((u) => u.role === 'faculty') ||
      admin;

    const newCourse: CourseRecord = {
      id: nextId,
      code: cleanCode,
      title: cleanTitle.slice(0, 120),
      category: String(category || 'Computer Science').trim(),
      level: String(level || 'Intermediate').trim(),
      estimated_hours: Math.max(1, Number(estimated_hours) || 14),
      accent_theme: themes[nextId % 3],
      description: String(description || '').trim().slice(0, 1200),
      faculty_id: instructor.id,
      faculty_title: 'Course Instructor',
      published: published !== undefined ? Boolean(published) : true,
      approval_status: ['approved', 'pending', 'archived'].includes(approval_status)
        ? approval_status
        : 'approved',
      department_id: department_id ? Number(department_id) : null,
      created_at: nowIso(),
      quiz_questions: [],
    };

    kernel.state.courses.push(newCourse);
    kernel.recordAuditLog(
      admin,
      'course',
      'Created Course (Admin)',
      `${newCourse.code} · ${newCourse.title}`,
      `Instructor: ${instructor.full_name}`
    );
    kernel.saveState();
    res.json({ course: formatCourseForUser(newCourse, admin), overview: buildAdminOverviewPayload(admin) });
  });

  app.put('/api/admin/courses/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const {
      code,
      title,
      category,
      level,
      estimated_hours,
      description,
      faculty_id,
      department_id,
      published,
      approval_status,
    } = req.body || {};

    if (code !== undefined) {
      const cleanCode = String(code).trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,16}$/.test(cleanCode)) {
        res.status(400).json({ error: 'Course code must be 3–16 alphanumeric characters.' });
        return;
      }
      if (kernel.state.courses.some((c) => c.id !== courseId && c.code.toUpperCase() === cleanCode)) {
        res.status(400).json({ error: 'Another course already uses that code.' });
        return;
      }
      course.code = cleanCode;
    }
    if (title !== undefined && String(title).trim()) {
      course.title = String(title).trim().slice(0, 120);
    }
    if (category !== undefined) course.category = String(category).trim();
    if (level !== undefined) course.level = String(level).trim();
    if (estimated_hours !== undefined) {
      course.estimated_hours = Math.max(1, Number(estimated_hours) || 14);
    }
    if (description !== undefined) {
      course.description = String(description).trim().slice(0, 1200);
    }
    if (faculty_id !== undefined) {
      const fac = kernel.state.users.find((u) => u.id === Number(faculty_id));
      if (fac) course.faculty_id = fac.id;
    }
    if (department_id !== undefined) {
      course.department_id = department_id ? Number(department_id) : null;
    }
    if (published !== undefined) {
      course.published = Boolean(published);
    }
    if (approval_status && ['approved', 'pending', 'archived'].includes(approval_status)) {
      course.approval_status = approval_status;
      if (approval_status === 'archived') course.published = false;
      if (approval_status === 'approved' && published === undefined) course.published = true;
    }

    kernel.recordAuditLog(
      admin,
      'course',
      'Updated Course Configuration',
      `${course.code} · ${course.title}`,
      `Status: ${course.approval_status}, Published: ${course.published}, Faculty ID: ${course.faculty_id}`
    );
    kernel.saveState();
    res.json({ course: formatCourseForUser(course, admin), overview: buildAdminOverviewPayload(admin) });
  });

  app.delete('/api/admin/courses/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const asgnIds = new Set(
      kernel.state.assignments.filter((a) => a.course_id === courseId).map((a) => a.id)
    );
    kernel.state.courses = kernel.state.courses.filter((c) => c.id !== courseId);
    kernel.state.enrollments = kernel.state.enrollments.filter((e) => e.course_id !== courseId);
    kernel.state.materials = kernel.state.materials.filter((m) => m.course_id !== courseId);
    kernel.state.assignments = kernel.state.assignments.filter((a) => a.course_id !== courseId);
    kernel.state.submissions = kernel.state.submissions.filter((s) => !asgnIds.has(s.assignment_id));
    kernel.state.announcements = kernel.state.announcements.filter((a) => a.course_id !== courseId);
    kernel.state.student_notes = kernel.state.student_notes.filter((n) => n.course_id !== courseId);

    kernel.rebuildSearchIndex();
    kernel.recordAuditLog(
      admin,
      'course',
      'Deleted Course',
      `${course.code} · ${course.title}`,
      `Removed course #${courseId} and associated enrollments/materials`
    );
    kernel.saveState();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  app.post('/api/admin/courses/:id/enrollments', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }
    const studentId = Number(req.body?.student_id);
    const action = req.body?.action === 'unenroll' ? 'unenroll' : 'enroll';
    const student = kernel.state.users.find((u) => u.id === studentId);
    if (!student) {
      res.status(404).json({ error: 'Student account not found.' });
      return;
    }

    if (action === 'unenroll') {
      kernel.state.enrollments = kernel.state.enrollments.filter(
        (e) => !(e.course_id === courseId && e.student_id === studentId)
      );
      kernel.recordAuditLog(
        admin,
        'course',
        'Unenrolled Student',
        `${course.code} · ${student.full_name}`,
        `Removed enrollment for @${student.username}`
      );
    } else {
      const exists = kernel.state.enrollments.some(
        (e) => e.course_id === courseId && e.student_id === studentId
      );
      if (!exists) {
        kernel.state.enrollments.push({
          student_id: studentId,
          course_id: courseId,
          enrolled_at: nowIso(),
        });
        kernel.recordAuditLog(
          admin,
          'course',
          'Enrolled Student',
          `${course.code} · ${student.full_name}`,
          `Added enrollment for @${student.username}`
        );
      }
    }
    kernel.saveState();
    await kernel.flush();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  // --- Admin Academic Structure Management (Departments, Subjects, Class Batches) ---
  app.post('/api/admin/departments', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { code, name, head_faculty_id, description } = req.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    if (!cleanCode || !cleanName) {
      res.status(400).json({ error: 'Department code and name are required.' });
      return;
    }
    if (!kernel.state.departments) kernel.state.departments = [];
    if (kernel.state.departments.some((d) => d.code.toUpperCase() === cleanCode)) {
      res.status(400).json({ error: 'A department with that code already exists.' });
      return;
    }
    const nextId = await kernel.nextId('departments');
    const dept: DepartmentRecord = {
      id: nextId,
      code: cleanCode.slice(0, 16),
      name: cleanName.slice(0, 120),
      head_faculty_id: head_faculty_id ? Number(head_faculty_id) : null,
      description: String(description || '').trim().slice(0, 600),
      created_at: nowIso(),
    };
    kernel.state.departments.push(dept);
    kernel.recordAuditLog(admin, 'academic', 'Created Department', `${dept.code} · ${dept.name}`, dept.description);
    kernel.saveState();
    res.json({ department: dept, overview: buildAdminOverviewPayload(admin) });
  });

  app.delete('/api/admin/departments/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const deptId = Number(req.params.id);
    const dept = (kernel.state.departments || []).find((d) => d.id === deptId);
    if (!dept) {
      res.status(404).json({ error: 'Department not found.' });
      return;
    }
    kernel.state.departments = (kernel.state.departments || []).filter((d) => d.id !== deptId);
    for (const c of kernel.state.courses) {
      if (c.department_id === deptId) c.department_id = null;
    }
    for (const u of kernel.state.users) {
      if (u.department_id === deptId) u.department_id = null;
    }
    kernel.recordAuditLog(admin, 'academic', 'Deleted Department', `${dept.code} · ${dept.name}`, '');
    kernel.saveState();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  app.post('/api/admin/subjects', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { code, name, department_id, credits, semester } = req.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    if (!cleanCode || !cleanName) {
      res.status(400).json({ error: 'Subject code and name are required.' });
      return;
    }
    if (!kernel.state.subjects) kernel.state.subjects = [];
    if (kernel.state.subjects.some((s) => s.code.toUpperCase() === cleanCode)) {
      res.status(400).json({ error: 'A subject with that code already exists.' });
      return;
    }
    const nextId = await kernel.nextId('subjects');
    const subj: AcademicSubjectRecord = {
      id: nextId,
      code: cleanCode.slice(0, 16),
      name: cleanName.slice(0, 120),
      department_id: department_id ? Number(department_id) : null,
      credits: Math.max(1, Math.min(12, Number(credits) || 4)),
      semester: String(semester || 'Semester 1').trim(),
      created_at: nowIso(),
    };
    kernel.state.subjects.push(subj);
    kernel.recordAuditLog(
      admin,
      'academic',
      'Created Academic Subject',
      `${subj.code} · ${subj.name}`,
      `${subj.credits} credits · ${subj.semester}`
    );
    kernel.saveState();
    res.json({ subject: subj, overview: buildAdminOverviewPayload(admin) });
  });

  app.delete('/api/admin/subjects/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const subjId = Number(req.params.id);
    const subj = (kernel.state.subjects || []).find((s) => s.id === subjId);
    if (!subj) {
      res.status(404).json({ error: 'Subject not found.' });
      return;
    }
    kernel.state.subjects = (kernel.state.subjects || []).filter((s) => s.id !== subjId);
    kernel.recordAuditLog(admin, 'academic', 'Deleted Academic Subject', `${subj.code} · ${subj.name}`, '');
    kernel.saveState();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  app.post('/api/admin/batches', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const {
      code,
      name,
      department_id,
      academic_year,
      semester,
      advisor_faculty_id,
      student_ids,
      course_ids,
    } = req.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    if (!cleanCode || !cleanName) {
      res.status(400).json({ error: 'Batch code and name are required.' });
      return;
    }
    if (!kernel.state.batches) kernel.state.batches = [];
    if (kernel.state.batches.some((b) => b.code.toUpperCase() === cleanCode)) {
      res.status(400).json({ error: 'A class/batch with that code already exists.' });
      return;
    }
    const nextId = await kernel.nextId('batches');
    const cleanStudentIds = Array.isArray(student_ids) ? student_ids.map(Number).filter(Boolean) : [];
    const cleanCourseIds = Array.isArray(course_ids) ? course_ids.map(Number).filter(Boolean) : [];

    const batch: ClassBatchRecord = {
      id: nextId,
      code: cleanCode.slice(0, 20),
      name: cleanName.slice(0, 120),
      department_id: department_id ? Number(department_id) : null,
      academic_year: String(academic_year || '2025–2026').trim(),
      semester: String(semester || 'Spring Semester').trim(),
      advisor_faculty_id: advisor_faculty_id ? Number(advisor_faculty_id) : null,
      student_ids: cleanStudentIds,
      course_ids: cleanCourseIds,
      created_at: nowIso(),
    };
    kernel.state.batches.push(batch);

    // Link students to this batch and enroll them in batch courses if any
    for (const sid of cleanStudentIds) {
      const st = kernel.state.users.find((u) => u.id === sid);
      if (st) st.batch_id = batch.id;
      for (const cid of cleanCourseIds) {
        const exists = kernel.state.enrollments.some((e) => e.student_id === sid && e.course_id === cid);
        if (!exists) {
          kernel.state.enrollments.push({
            student_id: sid,
            course_id: cid,
            enrolled_at: nowIso(),
          });
        }
      }
    }

    kernel.recordAuditLog(
      admin,
      'academic',
      'Created Class Batch',
      `${batch.code} · ${batch.name}`,
      `Students: ${cleanStudentIds.length}, Courses: ${cleanCourseIds.length}`
    );
    kernel.saveState();
    res.json({ batch, overview: buildAdminOverviewPayload(admin) });
  });

  app.delete('/api/admin/batches/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const batchId = Number(req.params.id);
    const batch = (kernel.state.batches || []).find((b) => b.id === batchId);
    if (!batch) {
      res.status(404).json({ error: 'Class batch not found.' });
      return;
    }
    kernel.state.batches = (kernel.state.batches || []).filter((b) => b.id !== batchId);
    for (const u of kernel.state.users) {
      if (u.batch_id === batchId) u.batch_id = null;
    }
    kernel.recordAuditLog(admin, 'academic', 'Deleted Class Batch', `${batch.code} · ${batch.name}`, '');
    kernel.saveState();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  // --- Admin Announcements & Communication ---
  app.post('/api/admin/announcements', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { title, body, target_audience, course_id } = req.body || {};
    const cleanTitle = String(title || '').trim();
    const cleanBody = String(body || '').trim();
    if (!cleanTitle || !cleanBody) {
      res.status(400).json({ error: 'Announcement title and body are required.' });
      return;
    }

    const audience: AnnouncementRecord['target_audience'] = ['all', 'students', 'teachers', 'course'].includes(
      target_audience
    )
      ? target_audience
      : 'all';
    const targetCourseId = audience === 'course' && course_id ? Number(course_id) : null;
    const nextId = await kernel.nextId('announcements');

    const ann: AnnouncementRecord = {
      id: nextId,
      course_id: targetCourseId,
      target_audience: audience,
      title: cleanTitle.slice(0, 140),
      body: cleanBody.slice(0, 5000),
      author_id: admin.id,
      created_at: nowIso(),
    };
    kernel.state.announcements.unshift(ann);

    // Send real notifications to target users
    let recipients: number[] = [];
    if (audience === 'all') {
      recipients = kernel.state.users.map((u) => u.id);
    } else if (audience === 'students') {
      recipients = kernel.state.users.filter((u) => u.role === 'student').map((u) => u.id);
    } else if (audience === 'teachers') {
      recipients = kernel.state.users.filter((u) => u.role === 'faculty').map((u) => u.id);
    } else if (audience === 'course' && targetCourseId) {
      recipients = kernel.state.enrollments
        .filter((e) => e.course_id === targetCourseId)
        .map((e) => e.student_id);
    }

    if (recipients.length > 0) {
      kernel.scheduleJob(
        'notify',
        `Platform Notice: ${ann.title}`,
        {
          recipients,
          title: `Announcement: ${ann.title}`,
          body: ann.body.slice(0, 240),
          link: targetCourseId ? `/courses/${targetCourseId}` : '/',
        },
        1,
        1
      );
    }

    kernel.recordAuditLog(
      admin,
      'announcement',
      'Published Announcement',
      ann.title,
      `Audience: ${audience} (${recipients.length} recipients)`
    );
    kernel.saveState();
    res.json({ announcement: ann, overview: buildAdminOverviewPayload(admin) });
  });

  app.put('/api/admin/announcements/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const annId = Number(req.params.id);
    const ann = kernel.state.announcements.find((a) => a.id === annId);
    if (!ann) {
      res.status(404).json({ error: 'Announcement not found.' });
      return;
    }
    const { title, body, target_audience, course_id } = req.body || {};
    if (title !== undefined && String(title).trim()) ann.title = String(title).trim().slice(0, 140);
    if (body !== undefined && String(body).trim()) ann.body = String(body).trim().slice(0, 5000);
    if (target_audience && ['all', 'students', 'teachers', 'course'].includes(target_audience)) {
      ann.target_audience = target_audience;
      ann.course_id = target_audience === 'course' && course_id ? Number(course_id) : null;
    }
    kernel.recordAuditLog(admin, 'announcement', 'Edited Announcement', ann.title, '');
    kernel.saveState();
    res.json({ announcement: ann, overview: buildAdminOverviewPayload(admin) });
  });

  app.delete('/api/admin/announcements/:id', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const annId = Number(req.params.id);
    const ann = kernel.state.announcements.find((a) => a.id === annId);
    if (!ann) {
      res.status(404).json({ error: 'Announcement not found.' });
      return;
    }
    kernel.state.announcements = kernel.state.announcements.filter((a) => a.id !== annId);
    kernel.recordAuditLog(admin, 'announcement', 'Deleted Announcement', ann.title, '');
    kernel.saveState();
    res.json({ ok: true, overview: buildAdminOverviewPayload(admin) });
  });

  // --- Admin System Settings, Backup & Real Database Exports ---
  app.put('/api/admin/settings', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const s = kernel.state.platform_settings!;
    const {
      platform_name,
      institution_name,
      academic_session,
      current_semester,
      allow_self_registration,
      require_course_approval,
      maintenance_mode,
      default_weekly_goal_hours,
    } = req.body || {};

    if (platform_name !== undefined && String(platform_name).trim()) {
      s.platform_name = String(platform_name).trim().slice(0, 80);
    }
    if (institution_name !== undefined && String(institution_name).trim()) {
      s.institution_name = String(institution_name).trim().slice(0, 120);
    }
    if (academic_session !== undefined && String(academic_session).trim()) {
      s.academic_session = String(academic_session).trim().slice(0, 40);
    }
    if (current_semester !== undefined && String(current_semester).trim()) {
      s.current_semester = String(current_semester).trim().slice(0, 40);
    }
    if (allow_self_registration !== undefined) {
      s.allow_self_registration = Boolean(allow_self_registration);
    }
    if (require_course_approval !== undefined) {
      s.require_course_approval = Boolean(require_course_approval);
    }
    if (maintenance_mode !== undefined) {
      s.maintenance_mode = Boolean(maintenance_mode);
    }
    if (default_weekly_goal_hours !== undefined) {
      s.default_weekly_goal_hours = Math.max(1, Math.min(60, Number(default_weekly_goal_hours) || 14));
    }
    s.updated_at = nowIso();

    kernel.recordAuditLog(
      admin,
      'settings',
      'Updated Platform Settings',
      s.platform_name,
      `Session: ${s.academic_session}, Self-Reg: ${s.allow_self_registration}, Approval: ${s.require_course_approval}`
    );
    kernel.saveState();
    res.json({ settings: s, overview: buildAdminOverviewPayload(admin) });
  });

  app.post('/api/admin/backup', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const stamp = nowIso().replace(/[:.]/g, '-');
    const filename = `lms-backup-${stamp}.json`;
    const target = path.join(BACKUP_DIR, filename);
    const safeSnapshot = {
      ...kernel.state,
      users: kernel.state.users.map((u) => sanitizeUser(u)),
    };
    fs.writeFileSync(target, JSON.stringify(safeSnapshot, null, 2), 'utf-8');
    kernel.recordAuditLog(admin, 'settings', 'Created Database Backup', filename, 'Full state snapshot archived');
    kernel.saveState();
    res.json({ filename, overview: buildAdminOverviewPayload(admin) });
  });

  app.get('/api/admin/export/:type', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const exportType = String(req.params.type || 'users');
    const overview = buildAdminOverviewPayload(admin);

    const escapeCsv = (val: unknown) => {
      const str = val === null || val === undefined ? '' : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    let rows: string[][] = [];
    let filename = `smartlearn-${exportType}-report.csv`;

    if (exportType === 'users') {
      rows.push(['ID', 'Username', 'Full Name', 'Email', 'Role', 'Status', 'Created At', 'Last Login']);
      for (const u of overview.users) {
        rows.push([
          String(u.id),
          u.username,
          u.full_name,
          u.email,
          u.role,
          u.status || 'active',
          u.created_at,
          u.last_login_at || 'Never',
        ]);
      }
    } else if (exportType === 'courses') {
      rows.push([
        'ID',
        'Code',
        'Title',
        'Category',
        'Instructor',
        'Approval Status',
        'Published',
        'Enrolled Students',
        'Materials',
        'Assignments',
      ]);
      for (const c of overview.courses) {
        rows.push([
          String(c.id),
          c.code,
          c.title,
          c.category,
          c.faculty_name,
          c.approval_status || 'approved',
          String(c.published ?? true),
          String(c.student_count),
          String(c.material_count),
          String(c.assignment_count),
        ]);
      }
    } else if (exportType === 'performance') {
      rows.push([
        'Student ID',
        'Full Name',
        'Username',
        'Email',
        'Status',
        'Enrolled Courses',
        'Completed Lessons',
        'Submissions',
        'Graded',
        'Average Grade (%)',
        'Completion Rate (%)',
      ]);
      for (const s of overview.analytics.student_performance) {
        rows.push([
          String(s.student_id),
          s.full_name,
          s.username,
          s.email,
          s.status,
          String(s.enrolled_courses),
          String(s.completed_lessons),
          String(s.submissions_count),
          String(s.graded_submissions_count),
          s.average_grade !== null ? String(s.average_grade) : 'N/A',
          String(s.average_completion_percent),
        ]);
      }
    } else {
      res.status(400).json({ error: 'Unsupported report export type.' });
      return;
    }

    const csv = rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });

  app.get('/api/search', (req, res) => {
    const q = String(req.query.q || '');
    const results = kernel.searchMaterials(q);
    res.json({
      query: q,
      results,
      kernel: kernel.getFullKernelSnapshot(),
    });
  });

  app.post('/api/notifications/mark-read', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;
    for (const n of kernel.state.notifications) {
      if (n.user_id === user.id) n.is_read = true;
    }
    kernel.saveState();
    res.json({ ok: true });
  });

  app.post('/api/os/settings', (req, res) => {
    const { scheduler_policy, disk_policy, time_quantum, cache_capacity } = req.body || {};
    if (scheduler_policy && ['fcfs', 'sjf', 'srtf', 'priority', 'rr'].includes(scheduler_policy)) {
      kernel.state.settings.scheduler_policy = scheduler_policy;
      kernel.logEvent('scheduler', 'CPU scheduling policy changed', 'info', {
        policy: scheduler_policy.toUpperCase(),
      });
    }
    if (disk_policy && ['fcfs', 'sstf', 'scan', 'cscan'].includes(disk_policy)) {
      kernel.state.settings.disk_policy = disk_policy;
      kernel.logEvent('disk', 'Disk scheduling policy changed', 'info', {
        policy: disk_policy.toUpperCase(),
      });
    }
    if (time_quantum !== undefined) {
      kernel.state.settings.time_quantum = Math.max(1, Math.min(10, Number(time_quantum) || 2));
    }
    if (cache_capacity !== undefined) {
      kernel.state.settings.cache_capacity = Math.max(2, Math.min(16, Number(cache_capacity) || 6));
    }
    kernel.saveState();
    res.json({ kernel: kernel.getFullKernelSnapshot() });
  });

  app.post('/api/os/jobs', (req, res) => {
    const { kind } = req.body || {};
    const jobSpecs: Record<
      string,
      { kind: 'backup' | 'reminders' | 'report' | 'reindex' | 'notify'; title: string; priority: number; burst: number }
    > = {
      backup: { kind: 'backup', title: 'Create database and uploads backup archive', priority: 4, burst: 4 },
      reminders: { kind: 'reminders', title: 'Check assignments due in the next 48 hours', priority: 2, burst: 2 },
      report: { kind: 'report', title: 'Generate LMS usage telemetry report', priority: 4, burst: 3 },
      reindex: { kind: 'reindex', title: 'Rebuild course material inverted search index', priority: 3, burst: 3 },
    };

    if (kind === 'burst') {
      const j1 = kernel.scheduleJob('backup', 'Archive full LMS snapshot', {}, 4, 4);
      const j2 = kernel.scheduleJob('report', 'Compile department usage report', {}, 3, 3);
      const j3 = kernel.scheduleJob('reindex', 'Rebuild inverted search index', {}, 2, 2);
      const j4 = kernel.scheduleJob('reminders', 'Dispatch due-date reminder alerts', {}, 1, 1);
      res.json({ queued: [j1.id, j2.id, j3.id, j4.id], kernel: kernel.getFullKernelSnapshot() });
      return;
    }

    const spec = jobSpecs[String(kind)];
    if (!spec) {
      res.status(400).json({ error: 'Unknown background job type' });
      return;
    }
    const job = kernel.scheduleJob(spec.kind, spec.title, {}, spec.priority, spec.burst);
    res.json({ job, kernel: kernel.getFullKernelSnapshot() });
  });

  app.post('/api/os/cache', (req, res) => {
    const { action, material_id } = req.body || {};
    if (action === 'clear') {
      kernel.cacheLock.write(() => {
        kernel.cachePages.clear();
      });
      kernel.logEvent('memory', 'LRU page cache flushed manually', 'warning', {});
    } else if (action === 'evict' && material_id) {
      kernel.cacheLock.write(() => {
        kernel.cachePages.delete(Number(material_id));
      });
      kernel.logEvent('memory', 'Page manually evicted from LRU cache', 'info', {
        material_id: Number(material_id),
      });
    } else if (action === 'warm') {
      for (const m of kernel.state.materials.slice(0, kernel.state.settings.cache_capacity)) {
        kernel.getMaterialPage(m.id);
      }
    }
    res.json({ kernel: kernel.getFullKernelSnapshot() });
  });

  // ============================================================================
  // TEACHER DASHBOARD & COURSE / ASSESSMENT MANAGEMENT ENDPOINTS (/api/teacher/*)
  // ============================================================================

  const requireFaculty = (req: express.Request, res: express.Response): UserRecord | null => {
    const user = requireActiveUser(req, res);
    if (!user) return null;
    if (user.role !== 'faculty') {
      res.status(403).json({ error: 'Teacher privileges are required for this action.' });
      return null;
    }
    return user;
  };

  const requireOwnedCourse = (
    teacher: UserRecord,
    courseId: number,
    res: express.Response
  ): CourseRecord | null => {
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return null;
    }
    if (course.faculty_id !== teacher.id) {
      res.status(403).json({
        error: 'You are only authorized to manage courses assigned to you.',
      });
      return null;
    }
    return course;
  };

  const buildTeacherOverviewPayload = (teacher: UserRecord) => {
    const teacherCoursesRaw = kernel.state.courses.filter((c) => c.faculty_id === teacher.id);
    const teacherCourseIds = new Set(teacherCoursesRaw.map((c) => c.id));
    const teacherCourseCodes = new Set(teacherCoursesRaw.map((c) => c.code.toUpperCase()));

    const coursesDetail = teacherCoursesRaw.map((c) => {
      const baseCourse = formatCourseForUser(c, teacher);
      const courseMats = kernel.state.materials
        .filter((m) => m.course_id === c.id)
        .sort((a, b) => a.lesson_number - b.lesson_number)
        .map((m, idx) => ({
          ...m,
          module_title: m.module_title || 'Module 1 · Core Lessons',
          lesson_number: m.lesson_number || idx + 1,
          duration_minutes: m.duration_minutes || 20,
          video_url: m.video_url || null,
          published: m.published ?? true,
          course_code: c.code,
          course_title: c.title,
          cache_resident: kernel.cachePages.has(m.id),
          track: trackFor(`material:${m.id}`),
          completed: false,
          bookmarked: false,
        }));

      const courseAsgns = kernel.state.assignments.filter((a) => a.course_id === c.id);
      const courseAsgnIds = new Set(courseAsgns.map((a) => a.id));
      const courseEnrollments = kernel.state.enrollments.filter((e) => e.course_id === c.id);

      const enrolledStudents = courseEnrollments
        .map((enr) => {
          const st = kernel.state.users.find(
            (u) => u.id === enr.student_id && u.role === 'student'
          );
          if (!st) return null;
          const compSet = new Set(kernel.state.completed_materials[String(st.id)] || []);
          const completedLessons = courseMats.filter((m) => compSet.has(m.id)).length;
          const progressPct =
            courseMats.length > 0 ? Math.round((completedLessons / courseMats.length) * 100) : 0;

          const stSubs = kernel.state.submissions.filter(
            (s) => s.student_id === st.id && courseAsgnIds.has(s.assignment_id)
          );
          const gradedSubs = stSubs.filter((s) => s.grade !== null);
          let asgnAvgPct: number | null = null;
          if (gradedSubs.length > 0) {
            const sumPct = gradedSubs.reduce((acc, s) => {
              const a = courseAsgns.find((x) => x.id === s.assignment_id);
              return acc + ((s.grade || 0) / (a?.max_score || 100)) * 100;
            }, 0);
            asgnAvgPct = Number((sumPct / gradedSubs.length).toFixed(1));
          }

          const assessmentScore =
            kernel.state.quiz_scores[String(st.id)]?.[String(c.id)] ?? null;

          return {
            student_id: st.id,
            full_name: st.full_name,
            username: st.username,
            email: st.email,
            enrolled_at: enr.enrolled_at,
            completed_lessons: completedLessons,
            total_lessons: courseMats.length,
            progress_percent: progressPct,
            assignments_submitted: stSubs.length,
            assignments_total: courseAsgns.length,
            assignment_average_percent: asgnAvgPct,
            assessment_score: assessmentScore,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return {
        ...baseCourse,
        results_published: c.results_published ?? true,
        materials: courseMats,
        quiz_questions: (c.quiz_questions || []).map((q) => ({
          ...q,
          question_type: q.question_type || 'mcq',
          marks: q.marks || 10,
        })),
        enrolled_students: enrolledStudents,
      };
    });

    // Unique students enrolled in any of the teacher's courses
    const studentMap = new Map<
      number,
      {
        student: UserRecord;
        courses: Array<{
          course_id: number;
          course_code: string;
          course_title: string;
          enrolled_at: string;
          completed_lessons: number;
          total_lessons: number;
          progress_percent: number;
          assignments_submitted: number;
          assignments_total: number;
          assignment_average_percent: number | null;
          assessment_score: number | null;
        }>;
      }
    >();

    for (const cDetail of coursesDetail) {
      for (const stSummary of cDetail.enrolled_students) {
        const stUser = kernel.state.users.find((u) => u.id === stSummary.student_id);
        if (!stUser) continue;
        if (!studentMap.has(stUser.id)) {
          studentMap.set(stUser.id, { student: stUser, courses: [] });
        }
        studentMap.get(stUser.id)!.courses.push({
          course_id: cDetail.id,
          course_code: cDetail.code,
          course_title: cDetail.title,
          enrolled_at: stSummary.enrolled_at,
          completed_lessons: stSummary.completed_lessons,
          total_lessons: stSummary.total_lessons,
          progress_percent: stSummary.progress_percent,
          assignments_submitted: stSummary.assignments_submitted,
          assignments_total: stSummary.assignments_total,
          assignment_average_percent: stSummary.assignment_average_percent,
          assessment_score: stSummary.assessment_score,
        });
      }
    }

    const studentsList = Array.from(studentMap.values()).map(({ student, courses }) => {
      const dept = (kernel.state.departments || []).find((d) => d.id === student.department_id);
      const batch = (kernel.state.batches || []).find((b) => b.id === student.batch_id);
      const overallProgress =
        courses.length > 0
          ? Math.round(courses.reduce((s, c) => s + c.progress_percent, 0) / courses.length)
          : 0;

      const gradeSamples: number[] = [];
      for (const c of courses) {
        if (c.assignment_average_percent !== null) gradeSamples.push(c.assignment_average_percent);
        if (c.assessment_score !== null) gradeSamples.push(c.assessment_score);
      }
      const overallGrade =
        gradeSamples.length > 0
          ? Number((gradeSamples.reduce((a, b) => a + b, 0) / gradeSamples.length).toFixed(1))
          : null;

      return {
        student_id: student.id,
        full_name: student.full_name,
        username: student.username,
        email: student.email,
        status: (student.status || 'active') as 'active' | 'deactivated',
        department_name: dept?.name,
        batch_name: batch?.name,
        courses,
        overall_progress_percent: overallProgress,
        overall_grade_percent: overallGrade,
      };
    });

    // Assignments for the teacher's courses
    const teacherAssignments = kernel.state.assignments
      .filter((a) => teacherCourseIds.has(a.course_id))
      .map((a) => {
        const course = teacherCoursesRaw.find((c) => c.id === a.course_id);
        const enrolledCount = kernel.state.enrollments.filter(
          (e) => e.course_id === a.course_id
        ).length;
        const subs = kernel.state.submissions
          .filter((s) => s.assignment_id === a.id)
          .map((s) => {
            const st = kernel.state.users.find((u) => u.id === s.student_id);
            return {
              ...s,
              assignment_title: a.title,
              course_code: course?.code || '',
              max_score: a.max_score,
              student_name: st?.full_name || 'Student',
              student_username: st?.username || 'student',
              student_email: st?.email || '',
            };
          });
        const gradedCount = subs.filter((s) => s.grade !== null).length;
        const pendingCount = subs.filter((s) => s.grade === null).length;

        return {
          id: a.id,
          course_id: a.course_id,
          course_code: course?.code || 'COURSE',
          course_title: course?.title || 'Course',
          title: a.title,
          description: a.description,
          due_at: a.due_at,
          max_score: a.max_score,
          reference_link: a.reference_link || null,
          created_at: a.created_at,
          enrolled_count: enrolledCount,
          submission_count: subs.length,
          graded_count: gradedCount,
          pending_count: pendingCount,
          submissions: subs,
        };
      });

    const totalPendingEvaluations = teacherAssignments.reduce(
      (sum, a) => sum + a.pending_count,
      0
    );

    // Schedule entries belonging to this teacher or their assigned courses
    const teacherSchedule = kernel.state.schedule_events.filter(
      (ev) =>
        ev.user_id === teacher.id ||
        teacherCourseCodes.has(String(ev.course_code || '').toUpperCase())
    );

    return {
      teacher: sanitizeUser(teacher),
      stats: {
        my_courses: coursesDetail.length,
        total_students: studentsList.length,
        pending_evaluations: totalPendingEvaluations,
        upcoming_classes: teacherSchedule.length,
      },
      courses: coursesDetail,
      students: studentsList,
      assignments: teacherAssignments,
      schedule: teacherSchedule,
    };
  };

  app.get('/api/teacher/overview', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    res.json(buildTeacherOverviewPayload(teacher));
  });

  // Update Teacher's Assigned Course Details & Publish Status
  app.put('/api/teacher/courses/:id', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const courseId = Number(req.params.id);
    const course = requireOwnedCourse(teacher, courseId, res);
    if (!course) return;

    const { title, category, level, estimated_hours, description, published, results_published } =
      req.body || {};

    if (title !== undefined && String(title).trim()) {
      course.title = String(title).trim().slice(0, 120);
    }
    if (category !== undefined && String(category).trim()) {
      course.category = String(category).trim();
    }
    if (level !== undefined && String(level).trim()) {
      course.level = String(level).trim();
    }
    if (estimated_hours !== undefined) {
      course.estimated_hours = Math.max(1, Number(estimated_hours) || 14);
    }
    if (description !== undefined) {
      course.description = String(description).trim().slice(0, 1200);
    }
    if (published !== undefined) {
      course.published = Boolean(published);
    }
    if (results_published !== undefined) {
      course.results_published = Boolean(results_published);
    }

    kernel.recordAuditLog(
      teacher,
      'course',
      'Updated Course Content & Settings',
      `${course.code} · ${course.title}`,
      `Published: ${course.published ?? true}`
    );
    kernel.saveState();
    res.json({ overview: buildTeacherOverviewPayload(teacher) });
  });

  // Create Module/Lesson Material in Teacher's Course
  app.post('/api/teacher/courses/:id/materials', uploadMiddleware('file'), async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const courseId = Number(req.params.id);
    const course = requireOwnedCourse(teacher, courseId, res);
    if (!course) return;

    const {
      title,
      body,
      module_title,
      lesson_number,
      duration_minutes,
      video_url,
      published,
    } = req.body || {};

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      res.status(400).json({ error: 'Lesson title is required.' });
      return;
    }

    let originalName: string | null = null;
    let storedName: string | null = null;
    let fileSize = 0;
    let contentType: string | null = null;

    if (req.file) {
      const buf = req.file.buffer;
      if (kernel.courseStorageUsed(courseId) + buf.length > MAX_COURSE_STORAGE_BYTES) {
        res.status(400).json({ error: 'Course storage quota (50 MB) exceeded.' });
        return;
      }
      try {
        const saved = await kernel.saveUpload(req.file.originalname, buf);
        originalName = saved.originalName;
        storedName = saved.storedName;
        fileSize = saved.size;
        contentType = saved.contentType;
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'File upload failed.' });
        return;
      }
    }

    const existingCourseMats = kernel.state.materials.filter((m) => m.course_id === courseId);
    const nextId = await kernel.nextId('materials');

    const mat: MaterialRecord = {
      id: nextId,
      course_id: courseId,
      module_title: String(module_title || 'Module 1 · Core Lessons').trim().slice(0, 120),
      lesson_number: Math.max(1, Number(lesson_number) || existingCourseMats.length + 1),
      duration_minutes: Math.max(5, Number(duration_minutes) || 20),
      video_summary: `Instructor lecture notes and walkthrough for ${cleanTitle}.`,
      video_url: video_url ? String(video_url).trim().slice(0, 500) : null,
      published: published !== undefined ? String(published) === 'true' || published === true : true,
      key_takeaways: [
        'Review the core definitions and examples in the lecture notes.',
        'Complete the lesson check and add personal study notes.',
      ],
      title: cleanTitle.slice(0, 140),
      body: String(body || '').trim().slice(0, 20000),
      original_name: originalName,
      stored_name: storedName,
      file_size: fileSize,
      content_type: contentType,
      created_by: teacher.id,
      created_at: nowIso(),
    };

    kernel.state.materials.push(mat);
    kernel.recordAuditLog(
      teacher,
      'course',
      'Added Course Lesson',
      `${course.code} · ${mat.title}`,
      `Module: ${mat.module_title}`
    );
    kernel.saveState();
    await kernel.flush();
    res.json({ material: mat, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Update Module/Lesson Material in Teacher's Course
  app.put('/api/teacher/materials/:id', uploadMiddleware('file'), async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const matId = Number(req.params.id);
    const mat = kernel.state.materials.find((m) => m.id === matId);
    if (!mat) {
      res.status(404).json({ error: 'Lesson material not found.' });
      return;
    }
    const course = requireOwnedCourse(teacher, mat.course_id, res);
    if (!course) return;

    const {
      title,
      body,
      module_title,
      lesson_number,
      duration_minutes,
      video_url,
      published,
    } = req.body || {};

    if (title !== undefined && String(title).trim()) {
      mat.title = String(title).trim().slice(0, 140);
    }
    if (module_title !== undefined && String(module_title).trim()) {
      mat.module_title = String(module_title).trim().slice(0, 120);
    }
    if (lesson_number !== undefined) {
      mat.lesson_number = Math.max(1, Number(lesson_number) || mat.lesson_number);
    }
    if (duration_minutes !== undefined) {
      mat.duration_minutes = Math.max(5, Number(duration_minutes) || mat.duration_minutes);
    }
    if (body !== undefined) {
      mat.body = String(body).trim().slice(0, 20000);
    }
    if (video_url !== undefined) {
      mat.video_url = video_url ? String(video_url).trim().slice(0, 500) : null;
    }
    if (published !== undefined) {
      mat.published = String(published) === 'true' || published === true;
    }

    if (req.file) {
      const buf = req.file.buffer;
      const currentMatSize = mat.file_size || 0;
      if (kernel.courseStorageUsed(mat.course_id) - currentMatSize + buf.length > MAX_COURSE_STORAGE_BYTES) {
        res.status(400).json({ error: 'Course storage quota (50 MB) exceeded.' });
        return;
      }
      try {
        const saved = await kernel.saveUpload(req.file.originalname, buf);
        mat.original_name = saved.originalName;
        mat.stored_name = saved.storedName;
        mat.file_size = saved.size;
        mat.content_type = saved.contentType;
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'File upload failed.' });
        return;
      }
    }

    kernel.recordAuditLog(
      teacher,
      'course',
      'Updated Course Lesson',
      `${course.code} · ${mat.title}`,
      `Module: ${mat.module_title}`
    );
    kernel.saveState();
    await kernel.flush();
    res.json({ material: mat, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Delete Module/Lesson Material in Teacher's Course
  app.delete('/api/teacher/materials/:id', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const matId = Number(req.params.id);
    const mat = kernel.state.materials.find((m) => m.id === matId);
    if (!mat) {
      res.status(404).json({ error: 'Lesson material not found.' });
      return;
    }
    const course = requireOwnedCourse(teacher, mat.course_id, res);
    if (!course) return;

    kernel.state.materials = kernel.state.materials.filter((m) => m.id !== matId);
    kernel.recordAuditLog(
      teacher,
      'course',
      'Deleted Course Lesson',
      `${course.code} · ${mat.title}`,
      ''
    );
    kernel.saveState();
    res.json({ ok: true, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Create Assignment in Teacher's Course
  app.post('/api/teacher/assignments', async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const { course_id, title, description, due_at, max_score, reference_link } = req.body || {};
    const courseId = Number(course_id);
    const course = requireOwnedCourse(teacher, courseId, res);
    if (!course) return;

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || !due_at) {
      res.status(400).json({ error: 'Assignment title and deadline are required.' });
      return;
    }

    const nextId = await kernel.nextId('assignments');
    const asgn: AssignmentRecord = {
      id: nextId,
      course_id: courseId,
      title: cleanTitle.slice(0, 140),
      description: String(description || '').trim().slice(0, 8000),
      due_at: String(due_at),
      max_score: Math.max(1, Math.min(1000, Number(max_score) || 100)),
      reference_link: reference_link ? String(reference_link).trim().slice(0, 500) : null,
      created_by: teacher.id,
      created_at: nowIso(),
    };

    kernel.state.assignments.push(asgn);
    kernel.recordAuditLog(
      teacher,
      'course',
      'Created Assignment',
      `${course.code} · ${asgn.title}`,
      `Max Score: ${asgn.max_score}, Due: ${asgn.due_at}`
    );
    kernel.saveState();
    res.json({ assignment: asgn, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Edit Assignment in Teacher's Course
  app.put('/api/teacher/assignments/:id', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const asgnId = Number(req.params.id);
    const asgn = kernel.state.assignments.find((a) => a.id === asgnId);
    if (!asgn) {
      res.status(404).json({ error: 'Assignment not found.' });
      return;
    }
    const course = requireOwnedCourse(teacher, asgn.course_id, res);
    if (!course) return;

    const { title, description, due_at, max_score, reference_link } = req.body || {};
    if (title !== undefined && String(title).trim()) {
      asgn.title = String(title).trim().slice(0, 140);
    }
    if (description !== undefined) {
      asgn.description = String(description).trim().slice(0, 8000);
    }
    if (due_at !== undefined && String(due_at).trim()) {
      asgn.due_at = String(due_at).trim();
    }
    if (max_score !== undefined) {
      asgn.max_score = Math.max(1, Math.min(1000, Number(max_score) || asgn.max_score));
    }
    if (reference_link !== undefined) {
      asgn.reference_link = reference_link ? String(reference_link).trim().slice(0, 500) : null;
    }

    kernel.recordAuditLog(
      teacher,
      'course',
      'Updated Assignment',
      `${course.code} · ${asgn.title}`,
      `Due: ${asgn.due_at}`
    );
    kernel.saveState();
    res.json({ assignment: asgn, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Delete Assignment in Teacher's Course
  app.delete('/api/teacher/assignments/:id', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const asgnId = Number(req.params.id);
    const asgn = kernel.state.assignments.find((a) => a.id === asgnId);
    if (!asgn) {
      res.status(404).json({ error: 'Assignment not found.' });
      return;
    }
    const course = requireOwnedCourse(teacher, asgn.course_id, res);
    if (!course) return;

    kernel.state.assignments = kernel.state.assignments.filter((a) => a.id !== asgnId);
    kernel.state.submissions = kernel.state.submissions.filter((s) => s.assignment_id !== asgnId);
    kernel.recordAuditLog(
      teacher,
      'course',
      'Deleted Assignment',
      `${course.code} · ${asgn.title}`,
      ''
    );
    kernel.saveState();
    res.json({ ok: true, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Evaluate Submission in Teacher's Course
  app.post('/api/teacher/submissions/:id/grade', async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const subId = Number(req.params.id);
    const sub = kernel.state.submissions.find((s) => s.id === subId);
    if (!sub) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }
    const asgn = kernel.state.assignments.find((a) => a.id === sub.assignment_id);
    if (!asgn) {
      res.status(404).json({ error: 'Assignment not found.' });
      return;
    }
    const course = requireOwnedCourse(teacher, asgn.course_id, res);
    if (!course) return;

    const gradeNum = Number(req.body?.grade);
    if (Number.isNaN(gradeNum) || gradeNum < 0 || gradeNum > asgn.max_score) {
      res.status(400).json({ error: `Marks must be between 0 and ${asgn.max_score}.` });
      return;
    }

    sub.grade = Number(gradeNum.toFixed(1));
    sub.feedback = String(req.body?.feedback || '').trim().slice(0, 4000);
    sub.graded_at = nowIso();

    kernel.recordAuditLog(
      teacher,
      'submission',
      'Evaluated Submission',
      `${course.code} · ${asgn.title}`,
      `Grade: ${sub.grade}/${asgn.max_score}`
    );
    kernel.saveState();
    await kernel.flush();
    res.json({ submission: sub, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Add Quiz / Assessment Question to Teacher's Course
  app.post('/api/teacher/courses/:id/questions', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const courseId = Number(req.params.id);
    const course = requireOwnedCourse(teacher, courseId, res);
    if (!course) return;

    const { question, question_type, marks, options, correct_index, explanation } = req.body || {};
    const cleanQuestion = String(question || '').trim();
    if (!cleanQuestion) {
      res.status(400).json({ error: 'Question text is required.' });
      return;
    }

    const qType: 'mcq' | 'subjective' = question_type === 'subjective' ? 'subjective' : 'mcq';
    const cleanOptions = Array.isArray(options)
      ? options.map((o) => String(o || '').trim()).filter(Boolean)
      : [];

    if (qType === 'mcq' && cleanOptions.length < 2) {
      res.status(400).json({ error: 'Multiple-choice questions require at least 2 options.' });
      return;
    }

    if (!course.quiz_questions) course.quiz_questions = [];
    const newQ: QuizQuestionRecord = {
      id: `q-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      question: cleanQuestion.slice(0, 600),
      question_type: qType,
      marks: Math.max(1, Math.min(100, Number(marks) || 10)),
      options: qType === 'mcq' ? cleanOptions : ['Subjective Response'],
      correct_index:
        qType === 'mcq'
          ? Math.max(0, Math.min(cleanOptions.length - 1, Number(correct_index) || 0))
          : 0,
      explanation: String(explanation || '').trim().slice(0, 600),
    };

    course.quiz_questions.push(newQ);
    kernel.recordAuditLog(
      teacher,
      'course',
      'Added Assessment Question',
      `${course.code} · ${newQ.question.slice(0, 48)}`,
      `Type: ${qType.toUpperCase()}, Marks: ${newQ.marks}`
    );
    kernel.saveState();
    res.json({ question: newQ, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Generate Draft Questions using Gemini AI based on published course lessons
  app.post('/api/teacher/courses/:id/ai/generate-questions', aiRateLimiter, async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const courseId = Number(req.params.id);
    const course = requireOwnedCourse(teacher, courseId, res);
    if (!course) return;

    if (!isAiConfigured()) {
      res.status(503).json({ error: 'AI features are not configured.' });
      return;
    }

    const GenerateQuestionsSchema = z.object({
      material_ids: z.array(z.number()).optional(),
      topic: z.string().max(200).optional(),
      count: z.number().int().min(1).max(10),
      difficulty: z.enum(['easy', 'medium', 'hard']),
      mcq_ratio: z.number().min(0).max(1),
    });

    const parsed = GenerateQuestionsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request parameters: ' + parsed.error.issues.map((i) => i.message).join(', '),
      });
      return;
    }

    const { material_ids, topic, count, difficulty, mcq_ratio } = parsed.data;

    // Filter to published materials in this course
    let materials = kernel.state.materials.filter(
      (m) => m.course_id === course.id && m.published !== false
    );

    if (material_ids && material_ids.length > 0) {
      const allowedIds = new Set(material_ids);
      materials = materials.filter((m) => allowedIds.has(m.id));
    }

    const lessonTexts = materials.map((m) => {
      const title = stripHtml(m.title);
      const moduleTitle = stripHtml(m.module_title || '');
      const summary = stripHtml(m.video_summary || '');
      const takeaways = (m.key_takeaways || []).map(stripHtml).filter(Boolean).join('; ');
      const body = stripHtml(m.body || '');
      return `Lesson ${m.lesson_number || ''}: ${title}\nModule: ${moduleTitle}\nSummary: ${summary}\nKey Points: ${takeaways}\nContent: ${body}`;
    });

    const combinedText = lessonTexts.join('\n\n').trim();

    if (combinedText.length < 200) {
      res.status(400).json({ error: 'Add more lesson content before generating questions.' });
      return;
    }

    // Only consume quota right before calling Gemini
    const quota = checkAndIncrementUserAiQuota(teacher.id);
    if (!quota.allowed) {
      res.status(429).json({
        error: `Daily AI generation limit reached (${quota.limit} requests/day). Please try again tomorrow.`,
      });
      return;
    }

    // Cap lesson content input at ~12k characters
    const cappedLessonContent = combinedText.slice(0, 12000);

    let rawDrafts: Array<Omit<AiQuestionDraft, 'id'>>;
    try {
      rawDrafts = await generateQuestionsWithGemini({
        lessonContent: cappedLessonContent,
        count,
        difficulty,
        mcqRatio: mcq_ratio,
        topic: topic ? topic.trim() : undefined,
      });
    } catch (err: any) {
      const rawErrMsg = String(err?.message || err || 'Unknown error');
      const safeLogMsg = rawErrMsg
        .replace(/SECRET-[A-Za-z0-9_-]+/g, '[REDACTED_SECRET]')
        .replace(/[A-Za-z0-9_-]{24,}/g, '[REDACTED_KEY]');
      console.error('[AI] Gemini generation failed:', safeLogMsg);

      const isMalformed = err instanceof ModelMalformedResponseError;
      const isProviderOrTimeout =
        !isMalformed &&
        (err?.name === 'AbortError' ||
          err?.status === 429 ||
          err?.status === 503 ||
          (typeof err?.status === 'number' && err.status >= 500 && err.status < 600) ||
          /busy|timeout|timed out|quota|429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(rawErrMsg));

      if (isProviderOrTimeout) {
        refundUserAiQuota(teacher.id);
        res.status(503).json({ error: 'The AI service is busy. Please try again in a minute.' });
        return;
      }

      if (isMalformed) {
        res.status(502).json({ error: 'The AI returned an unusable answer. Please try again.' });
        return;
      }

      res.status(502).json({ error: 'An unexpected error occurred while generating AI questions.' });
      return;
    }

    const existingNormalized = (course.quiz_questions || []).map((q) =>
      q.question.toLowerCase().trim().replace(/\s+/g, ' ')
    );
    const seenInBatch = new Set<string>();
    const sanitizedDrafts: AiQuestionDraft[] = [];

    for (const q of rawDrafts) {
      const cleanQText = String(q.question || '').trim().slice(0, 600);
      if (!cleanQText || cleanQText.length < 5) continue;

      const normQ = cleanQText.toLowerCase().replace(/\s+/g, ' ');
      if (existingNormalized.includes(normQ) || seenInBatch.has(normQ)) {
        continue;
      }

      const qType: 'mcq' | 'subjective' = q.question_type === 'subjective' ? 'subjective' : 'mcq';
      const marks = Math.max(1, Math.min(100, Math.round(Number(q.marks) || 10)));
      const explanation = String(q.explanation || '').trim().slice(0, 600);

      if (qType === 'mcq') {
        const rawOptions = Array.isArray(q.options)
          ? q.options.map((o) => String(o || '').trim()).filter(Boolean)
          : [];

        // Deduplicate options while preserving order
        const uniqueOptions: string[] = [];
        for (const opt of rawOptions) {
          if (!uniqueOptions.includes(opt)) {
            uniqueOptions.push(opt);
          }
        }

        // MCQ must have 3-5 distinct options
        if (uniqueOptions.length < 3 || uniqueOptions.length > 5) {
          continue;
        }

        const correctIdx = Number(q.correct_index);
        if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= uniqueOptions.length) {
          continue;
        }

        seenInBatch.add(normQ);
        sanitizedDrafts.push({
          id: `draft-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          question: cleanQText,
          question_type: 'mcq',
          marks,
          options: uniqueOptions,
          correct_index: correctIdx,
          explanation,
        });
      } else {
        // Subjective question
        seenInBatch.add(normQ);
        sanitizedDrafts.push({
          id: `draft-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          question: cleanQText,
          question_type: 'subjective',
          marks,
          options: ['Subjective Response'],
          correct_index: 0,
          explanation,
        });
      }
    }

    // Return at most count drafts
    const finalDrafts = sanitizedDrafts.slice(0, count);

    kernel.recordAuditLog(
      teacher,
      'course',
      'AI Quiz Questions Generated',
      course.code,
      `Generated ${finalDrafts.length} drafts for course ${course.code}`
    );

    res.json({ drafts: finalDrafts });
  });

  // Delete Quiz / Assessment Question from Teacher's Course
  app.delete('/api/teacher/courses/:id/questions/:qid', (req, res) => {
    const teacher = requireFaculty(req, res);

    if (!teacher) return;
    const courseId = Number(req.params.id);
    const course = requireOwnedCourse(teacher, courseId, res);
    if (!course) return;

    const qid = String(req.params.qid);
    course.quiz_questions = (course.quiz_questions || []).filter((q) => q.id !== qid);
    kernel.recordAuditLog(
      teacher,
      'course',
      'Removed Assessment Question',
      `${course.code} · Question ${qid}`,
      ''
    );
    kernel.saveState();
    res.json({ ok: true, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Record or Update Student Assessment Mark in Teacher's Course
  app.post('/api/teacher/courses/:id/grades', async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const courseId = Number(req.params.id);
    const course = requireOwnedCourse(teacher, courseId, res);
    if (!course) return;

    const studentId = Number(req.body?.student_id);
    const isEnrolled = kernel.state.enrollments.some(
      (e) => e.course_id === courseId && e.student_id === studentId
    );
    if (!isEnrolled) {
      res.status(400).json({ error: 'Student is not enrolled in this course.' });
      return;
    }

    const scoreNum = Number(req.body?.score);
    if (Number.isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      res.status(400).json({ error: 'Assessment score must be between 0 and 100.' });
      return;
    }

    const uKey = String(studentId);
    if (!kernel.state.quiz_scores[uKey]) kernel.state.quiz_scores[uKey] = {};
    kernel.state.quiz_scores[uKey][String(courseId)] = Number(scoreNum.toFixed(1));

    const st = kernel.state.users.find((u) => u.id === studentId);
    kernel.recordAuditLog(
      teacher,
      'submission',
      'Recorded Assessment Score',
      `${course.code} · ${st?.full_name || `Student #${studentId}`}`,
      `Score: ${scoreNum}%`
    );
    kernel.saveState();
    await kernel.flush();
    res.json({ overview: buildTeacherOverviewPayload(teacher) });
  });

  // Teacher Schedule Management
  app.post('/api/teacher/schedule', async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const { title, course_code, date, time, duration_label, type, location } = req.body || {};
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      res.status(400).json({ error: 'Schedule event title is required.' });
      return;
    }

    const nextId = await kernel.nextId('schedule_events');
    const ev: ScheduleEventRecord = {
      id: nextId,
      user_id: teacher.id,
      title: cleanTitle.slice(0, 120),
      course_code: String(course_code || 'CLASS').trim().toUpperCase(),
      date: String(date || 'Wednesday').trim(),
      time: String(time || '10:00 AM').trim(),
      duration_label: String(duration_label || '60 min').trim(),
      type: ['lecture', 'deadline', 'study', 'workshop'].includes(type) ? type : 'lecture',
      location: String(location || 'Lecture Hall').trim(),
    };
    kernel.state.schedule_events.push(ev);
    kernel.saveState();
    res.json({ event: ev, overview: buildTeacherOverviewPayload(teacher) });
  });

  app.delete('/api/teacher/schedule/:id', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const evId = Number(req.params.id);
    const ev = kernel.state.schedule_events.find((e) => e.id === evId);
    if (!ev) {
      res.status(404).json({ error: 'Schedule entry not found.' });
      return;
    }
    const ownedCodes = new Set(
      kernel.state.courses
        .filter((c) => c.faculty_id === teacher.id)
        .map((c) => c.code.toUpperCase())
    );
    if (ev.user_id !== teacher.id && !ownedCodes.has(ev.course_code.toUpperCase())) {
      res.status(403).json({ error: 'You can only remove your own schedule entries.' });
      return;
    }
    kernel.state.schedule_events = kernel.state.schedule_events.filter((e) => e.id !== evId);
    kernel.saveState();
    res.json({ ok: true, overview: buildTeacherOverviewPayload(teacher) });
  });

  // Teacher Profile Update (Disabled: Teachers can only change their login password)
  app.put('/api/teacher/profile', (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    res.status(403).json({
      error: 'Profile details such as full name cannot be modified. You may only change your login password.',
    });
  });

  app.post('/api/teacher/password', async (req, res) => {
    const teacher = requireFaculty(req, res);
    if (!teacher) return;
    const { new_password } = req.body || {};
    const nextRaw = String(new_password || '');

    if (!nextRaw) {
      res.status(400).json({ error: 'New password is required.' });
      return;
    }
    if (nextRaw.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long.' });
      return;
    }

    teacher.password_hash = await hashPasswordScrypt(nextRaw);
    teacher.token_version = (teacher.token_version || 1) + 1;
    kernel.recordAuditLog(
      teacher,
      'security',
      'Changed Account Password',
      `${teacher.full_name} (@${teacher.username})`,
      'Password updated via Teacher Profile, other sessions revoked'
    );
    kernel.saveState();
    await kernel.flush();
    res.json({ ok: true });
  });

  // ============================================================================
  // STUDENT DASHBOARD, LEARNING, ASSIGNMENTS & ASSESSMENTS ENDPOINTS (/api/student/*)
  // ============================================================================

  const requireStudent = (req: express.Request, res: express.Response): UserRecord | null => {
    const user = requireActiveUser(req, res);
    if (!user) return null;
    if (user.role !== 'student') {
      res.status(403).json({ error: 'Student privileges are required for this action.' });
      return null;
    }
    return user;
  };

  const requireStudentEnrolledCourse = (
    student: UserRecord,
    courseId: number,
    res: express.Response
  ): CourseRecord | null => {
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course || course.published === false || course.approval_status === 'archived') {
      res.status(404).json({ error: 'Course not found or unavailable.' });
      return null;
    }
    const isEnrolled = kernel.state.enrollments.some(
      (e) => e.course_id === courseId && e.student_id === student.id
    );
    if (!isEnrolled) {
      res.status(403).json({
        error: 'You must be enrolled in this course to access its learning content or assessments.',
      });
      return null;
    }
    return course;
  };

  const buildStudentOverviewPayload = (student: UserRecord) => {
    const uKey = String(student.id);
    const completedSet = new Set(kernel.state.completed_materials[uKey] || []);
    const bookmarkedSet = new Set(kernel.state.bookmarked_materials[uKey] || []);

    // All available published courses in the database
    const availableCoursesRaw = kernel.state.courses.filter(
      (c) => (c.published ?? true) && (c.approval_status || 'approved') !== 'archived'
    );

    const studentEnrollments = kernel.state.enrollments.filter((e) => e.student_id === student.id);
    const enrolledMap = new Map(studentEnrollments.map((e) => [e.course_id, e.enrolled_at]));

    // 1. Enrolled courses with published lessons and real completion tracking
    const enrolledCoursesDetail = availableCoursesRaw
      .filter((c) => enrolledMap.has(c.id))
      .map((c) => {
        const base = formatCourseForUser(c, student);
        const publishedMats = kernel.state.materials
          .filter((m) => m.course_id === c.id && (m.published ?? true))
          .sort((a, b) => (a.lesson_number || 1) - (b.lesson_number || 1))
          .map((m, idx) => ({
            ...m,
            module_title: m.module_title || 'Module 1 · Core Lessons',
            lesson_number: m.lesson_number || idx + 1,
            duration_minutes: m.duration_minutes || 20,
            video_url: m.video_url || null,
            published: m.published ?? true,
            course_code: c.code,
            course_title: c.title,
            cache_resident: kernel.cachePages.has(m.id),
            track: trackFor(`material:${m.id}`),
            completed: completedSet.has(m.id),
            bookmarked: bookmarkedSet.has(m.id),
          }));

        const completedCount = publishedMats.filter((m) => m.completed).length;
        const progressPercent =
          publishedMats.length > 0 ? Math.round((completedCount / publishedMats.length) * 100) : 0;
        const nextUncompleted = publishedMats.find((m) => !m.completed) || publishedMats[0] || null;
        const resultsPublished = c.results_published ?? true;
        const rawScore = kernel.state.quiz_scores[uKey]?.[String(c.id)] ?? null;

        return {
          ...base,
          enrolled: true,
          enrolled_at: enrolledMap.get(c.id) || c.created_at,
          results_published: resultsPublished,
          material_count: publishedMats.length,
          completed_material_count: completedCount,
          progress_percent: progressPercent,
          quiz_score: resultsPublished ? rawScore : null,
          materials: publishedMats,
          next_lesson_id: nextUncompleted ? nextUncompleted.id : null,
          next_lesson_title: nextUncompleted ? nextUncompleted.title : null,
        };
      });

    const enrolledCourseIds = new Set(enrolledCoursesDetail.map((c) => c.id));

    // 2. Catalog courses for Explore Courses
    const catalogCourses = availableCoursesRaw.map((c) => {
      const base = formatCourseForUser(c, student);
      const publishedMats = kernel.state.materials.filter(
        (m) => m.course_id === c.id && (m.published ?? true)
      );
      const downloadableCount = publishedMats.filter((m) => Boolean(m.original_name)).length;
      const videoCount = publishedMats.filter((m) => Boolean(m.video_url)).length;
      const moduleSet = Array.from(
        new Set(publishedMats.map((m) => m.module_title || 'Module 1 · Core Lessons'))
      );

      return {
        ...base,
        enrolled: enrolledCourseIds.has(c.id),
        material_count: publishedMats.length,
        published_lessons_count: publishedMats.length,
        downloadable_resources_count: downloadableCount,
        video_resources_count: videoCount,
        sample_modules: moduleSet.slice(0, 6),
      };
    });

    // 3. Assignments strictly belonging to the student's enrolled courses
    const nowMs = Date.now();
    const studentAssignments = kernel.state.assignments
      .filter((a) => enrolledCourseIds.has(a.course_id))
      .map((a) => {
        const course = availableCoursesRaw.find((c) => c.id === a.course_id);
        const faculty = kernel.state.users.find((u) => u.id === course?.faculty_id);
        const mySubRaw =
          kernel.state.submissions.find(
            (s) => s.assignment_id === a.id && s.student_id === student.id
          ) || null;

        const dueMs = new Date(a.due_at).getTime();
        const isOverdue = !Number.isNaN(dueMs) && dueMs < nowMs && !mySubRaw;

        let statusLabel:
          | 'Not Submitted'
          | 'Submitted'
          | 'Under Evaluation'
          | 'Evaluated'
          | 'Overdue' = 'Not Submitted';

        if (mySubRaw) {
          if (mySubRaw.grade !== null && mySubRaw.grade !== undefined) {
            statusLabel = 'Evaluated';
          } else {
            statusLabel = 'Under Evaluation';
          }
        } else if (isOverdue) {
          statusLabel = 'Overdue';
        } else {
          statusLabel = 'Not Submitted';
        }

        const mySub = mySubRaw
          ? {
              ...mySubRaw,
              assignment_title: a.title,
              course_code: course?.code || '',
              student_name: student.full_name,
              student_username: student.username,
            }
          : null;

        // Students can submit or update their submission as long as it has not yet been evaluated
        const canSubmit = !mySubRaw || mySubRaw.grade === null || mySubRaw.grade === undefined;

        return {
          id: a.id,
          course_id: a.course_id,
          course_code: course?.code || 'COURSE',
          course_title: course?.title || 'Course',
          faculty_name: faculty?.full_name || 'Instructor',
          title: a.title,
          description: a.description,
          due_at: a.due_at,
          max_score: a.max_score,
          reference_link: a.reference_link || null,
          status_label: statusLabel,
          is_overdue: isOverdue,
          can_submit: canSubmit,
          my_submission: mySub,
        };
      });

    // 4. Assessments for enrolled courses (respecting results_published)
    const assessments = enrolledCoursesDetail.map((c) => {
      const rawCourse = availableCoursesRaw.find((rc) => rc.id === c.id);
      const rawQuestions = rawCourse?.quiz_questions || [];
      const resultsPublished = c.results_published;
      const attemptRecord = kernel.state.assessment_attempts?.[uKey]?.[String(c.id)] || null;
      const rawScore = kernel.state.quiz_scores[uKey]?.[String(c.id)];
      const hasScore = rawScore !== undefined && rawScore !== null;
      const attempted = Boolean(attemptRecord) || hasScore;

      const sanitizedQuestions = rawQuestions.map((q) => {
        const baseQ: {
          id: string;
          question: string;
          question_type: 'mcq' | 'subjective';
          marks: number;
          options: string[];
          correct_index?: number;
          explanation?: string;
        } = {
          id: q.id,
          question: q.question,
          question_type: q.question_type || 'mcq',
          marks: q.marks || 10,
          options: q.options || [],
        };
        // Only expose correct_index and explanation after attempt AND when teacher has published results
        if (resultsPublished && attempted) {
          baseQ.correct_index = q.correct_index;
          baseQ.explanation = q.explanation;
        }
        return baseQ;
      });

      const totalMarks = rawQuestions.reduce((sum, q) => sum + (q.marks || 10), 0);

      return {
        course_id: c.id,
        course_code: c.code,
        course_title: c.title,
        faculty_name: c.faculty_name,
        question_count: rawQuestions.length,
        total_marks: totalMarks,
        duration_minutes: Math.max(10, rawQuestions.length * 5),
        results_published: resultsPublished,
        attempted,
        submitted_at: attemptRecord?.submitted_at || null,
        published_score: resultsPublished && hasScore ? Number(rawScore) : null,
        questions: sanitizedQuestions,
        saved_answers: attemptRecord?.answers || undefined,
      };
    });

    // 5. Summary Card Calculations (strictly from real database records)
    const enrolledCount = enrolledCoursesDetail.length;
    const completedCoursesCount = enrolledCoursesDetail.filter(
      (c) => c.material_count > 0 && c.completed_material_count >= c.material_count
    ).length;
    const pendingAssignmentsCount = studentAssignments.filter((a) => !a.my_submission).length;

    const performanceSamples: number[] = [];
    for (const asmt of assessments) {
      if (asmt.results_published && asmt.published_score !== null) {
        performanceSamples.push(asmt.published_score);
      }
    }
    for (const asgn of studentAssignments) {
      if (
        asgn.my_submission &&
        asgn.my_submission.grade !== null &&
        asgn.my_submission.grade !== undefined &&
        asgn.max_score > 0
      ) {
        performanceSamples.push(
          Number(((asgn.my_submission.grade / asgn.max_score) * 100).toFixed(1))
        );
      }
    }
    const averagePerformance =
      performanceSamples.length > 0
        ? Number(
            (
              performanceSamples.reduce((acc, v) => acc + v, 0) / performanceSamples.length
            ).toFixed(1)
          )
        : null;

    // 6. Upcoming Deadlines (from enrolled course assignments and schedule)
    const upcomingDeadlines: Array<{
      id: string;
      kind: 'assignment' | 'schedule';
      title: string;
      course_code: string;
      course_title: string;
      due_label: string;
      status_label: string;
    }> = [];

    for (const asgn of studentAssignments) {
      upcomingDeadlines.push({
        id: `asgn-${asgn.id}`,
        kind: 'assignment',
        title: asgn.title,
        course_code: asgn.course_code,
        course_title: asgn.course_title,
        due_label: asgn.due_at,
        status_label: asgn.status_label,
      });
    }

    const enrolledCodes = new Set(enrolledCoursesDetail.map((c) => c.code.toUpperCase()));
    const relevantSchedule = kernel.state.schedule_events.filter(
      (ev) =>
        ev.user_id === student.id ||
        enrolledCodes.has(String(ev.course_code || '').toUpperCase())
    );
    for (const ev of relevantSchedule.slice(0, 6)) {
      const matchedCourse = enrolledCoursesDetail.find(
        (c) => c.code.toUpperCase() === String(ev.course_code || '').toUpperCase()
      );
      upcomingDeadlines.push({
        id: `sched-${ev.id}`,
        kind: 'schedule',
        title: ev.title,
        course_code: ev.course_code,
        course_title: matchedCourse?.title || ev.location,
        due_label: `${ev.date} · ${ev.time}`,
        status_label: ev.type,
      });
    }

    // 7. Recent Activity (actual database records belonging to this student)
    const recentActivity: Array<{
      id: string;
      type: 'lesson' | 'assignment' | 'assessment' | 'enrollment';
      title: string;
      course_code: string;
      detail: string;
      timestamp: string;
    }> = [];

    for (const asgn of studentAssignments) {
      if (asgn.my_submission) {
        recentActivity.push({
          id: `sub-${asgn.my_submission.id}`,
          type: 'assignment',
          title:
            asgn.my_submission.grade !== null
              ? `Evaluated: ${asgn.title}`
              : `Submitted: ${asgn.title}`,
          course_code: asgn.course_code,
          detail:
            asgn.my_submission.grade !== null
              ? `Score: ${asgn.my_submission.grade}/${asgn.max_score}`
              : 'Submitted for instructor evaluation',
          timestamp: asgn.my_submission.graded_at || asgn.my_submission.submitted_at,
        });
      }
    }

    for (const asmt of assessments) {
      if (asmt.attempted) {
        recentActivity.push({
          id: `asmt-${asmt.course_id}`,
          type: 'assessment',
          title: `Course Assessment: ${asmt.course_title}`,
          course_code: asmt.course_code,
          detail:
            asmt.results_published && asmt.published_score !== null
              ? `Published Result: ${asmt.published_score}%`
              : 'Submitted · Awaiting result publication',
          timestamp: asmt.submitted_at || nowIso(),
        });
      }
    }

    for (const c of enrolledCoursesDetail) {
      const completedLessons = c.materials.filter((m) => m.completed);
      for (const mat of completedLessons.slice(-3)) {
        recentActivity.push({
          id: `mat-${mat.id}`,
          type: 'lesson',
          title: `Completed Lesson: ${mat.title}`,
          course_code: c.code,
          detail: mat.module_title,
          timestamp: mat.created_at,
        });
      }
      recentActivity.push({
        id: `enr-${c.id}`,
        type: 'enrollment',
        title: `Enrolled in ${c.title}`,
        course_code: c.code,
        detail: `Instructor: ${c.faculty_name}`,
        timestamp: c.enrolled_at,
      });
    }

    recentActivity.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return {
      student: sanitizeUser(student),
      stats: {
        enrolled_courses: enrolledCount,
        completed_courses: completedCoursesCount,
        pending_assignments: pendingAssignmentsCount,
        average_performance: averagePerformance,
      },
      enrolled_courses: enrolledCoursesDetail,
      catalog_courses: catalogCourses,
      assignments: studentAssignments,
      assessments,
      recent_activity: recentActivity.slice(0, 12),
      upcoming_deadlines: upcomingDeadlines.slice(0, 10),
    };
  };

  app.get('/api/student/overview', (req, res) => {
    const student = requireStudent(req, res);
    if (!student) return;
    res.json(buildStudentOverviewPayload(student));
  });

  // Enroll in an available published course
  app.post('/api/student/courses/:id/enroll', async (req, res) => {
    const student = requireStudent(req, res);
    if (!student) return;
    const courseId = Number(req.params.id);
    const course = kernel.state.courses.find((c) => c.id === courseId);
    if (!course || course.published === false || course.approval_status === 'archived') {
      res.status(404).json({ error: 'This course is not available for enrollment.' });
      return;
    }

    const alreadyEnrolled = kernel.state.enrollments.some(
      (e) => e.course_id === courseId && e.student_id === student.id
    );
    if (alreadyEnrolled) {
      res.status(400).json({ error: 'You are already enrolled in this course.' });
      return;
    }

    kernel.state.enrollments.push({
      student_id: student.id,
      course_id: courseId,
      enrolled_at: nowIso(),
    });
    kernel.recordAuditLog(
      student,
      'course',
      'Enrolled in Course',
      `${course.code} · ${course.title}`,
      `Student: ${student.full_name}`
    );
    kernel.saveState();
    await kernel.flush();

    res.json({ enrolled: true, overview: buildStudentOverviewPayload(student) });
  });

  // Toggle or mark lesson completion (strictly for enrolled courses)
  app.post('/api/student/materials/:id/complete', (req, res) => {
    const student = requireStudent(req, res);
    if (!student) return;
    const matId = Number(req.params.id);
    const mat = kernel.state.materials.find((m) => m.id === matId && (m.published ?? true));
    if (!mat) {
      res.status(404).json({ error: 'Lesson not found.' });
      return;
    }
    const course = requireStudentEnrolledCourse(student, mat.course_id, res);
    if (!course) return;

    const uKey = String(student.id);
    const current = new Set(kernel.state.completed_materials[uKey] || []);
    const desiredState =
      req.body?.completed !== undefined ? Boolean(req.body.completed) : !current.has(matId);

    if (desiredState) {
      current.add(matId);
    } else {
      current.delete(matId);
    }

    kernel.state.completed_materials[uKey] = Array.from(current);
    kernel.saveState();

    res.json({
      completed: desiredState,
      overview: buildStudentOverviewPayload(student),
    });
  });

  // Submit or update assignment (strictly for enrolled courses and when permitted)
  app.post('/api/student/assignments/:id/submit', uploadMiddleware('file'), async (req, res) => {
    const student = requireStudent(req, res);
    if (!student) return;
    const asgnId = Number(req.params.id);
    const asgn = kernel.state.assignments.find((a) => a.id === asgnId);
    if (!asgn) {
      res.status(404).json({ error: 'Assignment not found.' });
      return;
    }
    const course = requireStudentEnrolledCourse(student, asgn.course_id, res);
    if (!course) return;

    const existingSub = kernel.state.submissions.find(
      (s) => s.assignment_id === asgnId && s.student_id === student.id
    );
    if (existingSub && existingSub.grade !== null && existingSub.grade !== undefined) {
      res.status(400).json({
        error: 'This assignment submission has already been evaluated and locked by the instructor.',
      });
      return;
    }

    const { body } = req.body || {};
    const cleanBody = String(body || '').trim();
    if (!cleanBody && !req.file && !existingSub?.stored_name) {
      res.status(400).json({
        error: 'Please enter a text submission or attach a file before submitting.',
      });
      return;
    }

    let originalName: string | null = existingSub?.original_name || null;
    let storedName: string | null = existingSub?.stored_name || null;
    let fileSize: number = existingSub?.file_size || 0;
    let contentType: string | null = existingSub?.content_type || null;

    if (req.file) {
      const buf = req.file.buffer;
      const currentSubSize = existingSub?.file_size || 0;
      if (kernel.courseStorageUsed(asgn.course_id) - currentSubSize + buf.length > MAX_COURSE_STORAGE_BYTES) {
        res.status(400).json({ error: 'Course storage quota (50 MB) exceeded.' });
        return;
      }
      try {
        const saved = await kernel.saveUpload(req.file.originalname, buf);
        originalName = saved.originalName;
        storedName = saved.storedName;
        fileSize = saved.size;
        contentType = saved.contentType;
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'File upload failed.' });
        return;
      }
    }

    if (existingSub) {
      existingSub.body = cleanBody.slice(0, 20000);
      existingSub.original_name = originalName;
      existingSub.stored_name = storedName;
      existingSub.file_size = fileSize;
      existingSub.content_type = contentType;
      existingSub.submitted_at = nowIso();
    } else {
      const nextId = await kernel.nextId('submissions');
      kernel.state.submissions.push({
        id: nextId,
        assignment_id: asgnId,
        student_id: student.id,
        body: cleanBody.slice(0, 20000),
        original_name: originalName,
        stored_name: storedName,
        file_size: fileSize,
        content_type: contentType,
        submitted_at: nowIso(),
        grade: null,
        feedback: null,
        graded_at: null,
      });
    }

    kernel.recordAuditLog(
      student,
      'submission',
      existingSub ? 'Updated Assignment Submission' : 'Submitted Assignment',
      `${course.code} · ${asgn.title}`,
      originalName ? `File: ${originalName}` : 'Text response'
    );
    kernel.saveState();
    await kernel.flush();

    res.json({ overview: buildStudentOverviewPayload(student) });
  });

  // Submit Course Assessment Attempt
  app.post('/api/student/courses/:id/assessment/submit', async (req, res) => {
    const student = requireStudent(req, res);
    if (!student) return;
    const courseId = Number(req.params.id);
    const course = requireStudentEnrolledCourse(student, courseId, res);
    if (!course) return;

    const questions = course.quiz_questions || [];
    if (questions.length === 0) {
      res.status(400).json({ error: 'No assessment questions are configured for this course.' });
      return;
    }

    const rawAnswers =
      req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const sanitizedAnswers: Record<string, string | number> = {};

    let earnedMarks = 0;
    let totalMarks = 0;

    for (const q of questions) {
      const qMarks = q.marks || 10;
      totalMarks += qMarks;
      const ans = rawAnswers[q.id];
      if (ans !== undefined && ans !== null) {
        sanitizedAnswers[q.id] = typeof ans === 'number' ? ans : String(ans).slice(0, 4000);
      }

      if ((q.question_type || 'mcq') === 'mcq') {
        if (typeof ans === 'number' && ans === q.correct_index) {
          earnedMarks += qMarks;
        }
      } else {
        // Subjective response: award provisional credit if non-empty, pending instructor review/update
        if (typeof ans === 'string' && ans.trim().length >= 10) {
          earnedMarks += qMarks;
        }
      }
    }

    const scorePercent =
      totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;

    const uKey = String(student.id);
    const cKey = String(courseId);

    if (!kernel.state.assessment_attempts) {
      kernel.state.assessment_attempts = {};
    }
    if (!kernel.state.assessment_attempts[uKey]) {
      kernel.state.assessment_attempts[uKey] = {};
    }
    kernel.state.assessment_attempts[uKey][cKey] = {
      submitted_at: nowIso(),
      answers: sanitizedAnswers,
      auto_score_percent: scorePercent,
    };

    if (!kernel.state.quiz_scores[uKey]) {
      kernel.state.quiz_scores[uKey] = {};
    }
    kernel.state.quiz_scores[uKey][cKey] = scorePercent;

    kernel.recordAuditLog(
      student,
      'submission',
      'Submitted Course Assessment',
      `${course.code} · ${course.title}`,
      `Questions answered: ${Object.keys(sanitizedAnswers).length}/${questions.length}`
    );
    kernel.saveState();
    await kernel.flush();

    res.json({
      submitted: true,
      results_published: course.results_published ?? true,
      published_score: (course.results_published ?? true) ? scorePercent : null,
      overview: buildStudentOverviewPayload(student),
    });
  });

  // Update Student Profile (Disabled: Students can only change their login password)
  app.put('/api/student/profile', (req, res) => {
    const student = requireStudent(req, res);
    if (!student) return;
    res.status(403).json({
      error: 'Profile details such as full name cannot be modified. You may only change your login password.',
    });
  });

  // Change Student Password Securely
  app.post('/api/student/password', async (req, res) => {
    const student = requireStudent(req, res);
    if (!student) return;
    const { new_password } = req.body || {};
    const nextRaw = String(new_password || '');

    if (!nextRaw) {
      res.status(400).json({ error: 'New password is required.' });
      return;
    }
    if (nextRaw.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long.' });
      return;
    }

    student.password_hash = await hashPasswordScrypt(nextRaw);
    student.token_version = (student.token_version || 1) + 1;
    kernel.recordAuditLog(
      student,
      'security',
      'Changed Account Password',
      `${student.full_name} (@${student.username})`,
      'Password updated via Student Profile, other sessions revoked'
    );
    kernel.saveState();
    await kernel.flush();
    res.json({ ok: true });
  });

  // Authenticated & Authorized Course Material Download
  app.get('/api/materials/:id/download', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;

    const mat = kernel.state.materials.find((m) => m.id === Number(req.params.id));
    if (!mat || !mat.stored_name) {
      res.status(404).send('Attachment not found');
      return;
    }

    const course = kernel.state.courses.find((c) => c.id === mat.course_id);
    if (!course) {
      res.status(404).send('Course not found');
      return;
    }

    const isEnrolled = kernel.state.enrollments.some(
      (e) => e.course_id === course.id && e.student_id === user.id
    );
    const isCourseFaculty = course.faculty_id === user.id;
    const isAdmin = user.role === 'admin';

    if (!isAdmin && !isCourseFaculty && !isEnrolled) {
      res.status(403).send('You do not have access to download this course material.');
      return;
    }

    try {
      const data = kernel.readUploadInternal(mat.stored_name);
      const originalName = mat.original_name || 'material.bin';
      const safeFilename = originalName.replace(/["\r\n\0]/g, '_');
      const encodedFilename = encodeURIComponent(safeFilename);

      res.setHeader('Content-Type', mat.content_type || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.send(data);
    } catch (e) {
      res.status(404).send(e instanceof Error ? e.message : 'File error');
    }
  });

  // Authenticated & Authorized Student Submission Download
  app.get('/api/submissions/:id/download', (req, res) => {
    const user = requireActiveUser(req, res);
    if (!user) return;

    const sub = kernel.state.submissions.find((s) => s.id === Number(req.params.id));
    if (!sub || !sub.stored_name) {
      res.status(404).send('Submission file not found');
      return;
    }

    const asgn = kernel.state.assignments.find((a) => a.id === sub.assignment_id);
    const course = asgn ? kernel.state.courses.find((c) => c.id === asgn.course_id) : null;

    const isOwner = sub.student_id === user.id;
    const isCourseFaculty = course ? course.faculty_id === user.id : false;
    const isAdmin = user.role === 'admin';

    if (!isAdmin && !isCourseFaculty && !isOwner) {
      res.status(403).send('You do not have permission to download this submission.');
      return;
    }

    try {
      const data = kernel.readUploadInternal(sub.stored_name);
      const originalName = sub.original_name || 'submission.bin';
      const safeFilename = originalName.replace(/["\r\n\0]/g, '_');
      const encodedFilename = encodeURIComponent(safeFilename);

      res.setHeader('Content-Type', sub.content_type || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.send(data);
    } catch (e) {
      res.status(404).send(e instanceof Error ? e.message : 'File error');
    }
  });

  // Authenticated Admin Backup Download
  app.get('/api/os/backups/:filename', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const filename = path.basename(req.params.filename);
    let data: Buffer | null = null;

    if (kernel.fileStore) {
      data = await kernel.fileStore.get(filename);
    }
    if (!data) {
      const target = path.join(BACKUP_DIR, filename);
      if (fs.existsSync(target)) {
        data = kernel.performDiskIo(trackFor(filename), `download backup ${filename}`, () =>
          fs.readFileSync(target)
        ).result;
      }
    }

    if (!data) {
      res.status(404).send('Backup archive not found');
      return;
    }

    const safeFilename = filename.replace(/["\r\n\0]/g, '_');
    const encodedFilename = encodeURIComponent(safeFilename);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.send(data);
  });

  // 404 handler for unmatched /api routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Central error handling middleware (always returns clean JSON, never HTML or stack traces/paths)
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    const status =
      typeof err.status === 'number'
        ? err.status
        : typeof err.statusCode === 'number'
        ? err.statusCode
        : 500;

    if (err.type === 'entity.too.large' || status === 413) {
      return res.status(413).json({ error: 'Request body exceeds size limit.' });
    }

    if (err instanceof multer.MulterError || err.code === 'LIMIT_FILE_SIZE') {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File exceeds 5MB limit.' });
      }
      return res.status(400).json({ error: err.message || 'File upload error.' });
    }

    let message = 'An unexpected internal error occurred.';
    if (err.message && typeof err.message === 'string') {
      const safe = err.message.replace(/(\/[a-zA-Z0-9_.-]+)+/g, '[path]').trim();
      if (safe && status < 500) {
        message = safe;
      }
    }

    return res.status(status).json({ error: message });
  });

  return { app, kernel };
}

export async function startServer() {
  process.on('unhandledRejection', (reason) => {
    console.warn('[SERVER] Unhandled promise rejection notice:', reason instanceof Error ? reason.message : reason);
  });

  const { app, kernel } = await createApp();

  // Wire graceful shutdown handlers to flush pending writes
  const handleShutdown = async (signal: string) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Flushing pending persistence writes...`);
    try {
      await kernel.flush();
      console.log('[SHUTDOWN] Persistence flush complete. Exiting gracefully.');
    } catch (err) {
      console.error('[SHUTDOWN] Error during final flush:', err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const demoActive = isDemoModeEnabled();
    console.log(`\n======================================================`);
    console.log(`🎓 SmartLearn LMS Server listening on http://localhost:${PORT}`);
    console.log(`   • LMS_DEMO_MODE: ${demoActive ? 'ENABLED (demo buttons and endpoints active)' : 'DISABLED (production mode)'}`);
    if (demoActive) {
      console.warn(`   ⚠️  [NOTICE] Demo mode is enabled. To disable in production, set LMS_DEMO_MODE=false.`);
    }
    console.log(`   • ADMIN_EMAILS: ${ADMIN_EMAILS.size > 0 ? Array.from(ADMIN_EMAILS).join(', ') : 'None configured (add comma-separated emails to ADMIN_EMAILS in .env)'}`);
    console.log(`   • SESSION_SECRET: ${process.env.SESSION_SECRET ? 'Configured from environment' : 'Ephemeral secret active (safe fallback)'}`);
    console.log(`   • PERSISTENCE: ${kernel.persistenceStatus.backend.toUpperCase()} (${kernel.persistenceStatus.isDurable ? 'DURABLE - Firestore' : 'NON-DURABLE - ' + (kernel.persistenceStatus.warning || 'local file')})`);
    console.log(`   • STORAGE: ${kernel.storageStatus.backend.toUpperCase()} (${kernel.storageStatus.isDurable ? 'DURABLE - Firebase Storage' : 'NON-DURABLE - ' + (kernel.storageStatus.warning || 'local disk')})`);
    console.log(`   • AI: ${isAiConfigured() ? 'ENABLED' : 'DISABLED'}`);
    console.log(`======================================================\n`);
  });
}

export { kernel };

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}

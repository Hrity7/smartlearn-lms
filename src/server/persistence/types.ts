export interface LMSState {
  users: any[];
  courses: any[];
  enrollments: any[];
  materials: any[];
  assignments: any[];
  submissions: any[];
  announcements: any[];
  notifications: any[];
  completed_materials: Record<string, number[]>;
  bookmarked_materials: Record<string, number[]>;
  student_notes: any[];
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
  schedule_events: any[];
  jobs: any[];
  departments?: any[];
  subjects?: any[];
  batches?: any[];
  audit_logs?: any[];
  login_activity?: any[];
  platform_settings?: any;
  settings: {
    scheduler_policy: 'fcfs' | 'sjf' | 'srtf' | 'priority' | 'rr';
    time_quantum: number;
    disk_policy: 'fcfs' | 'sstf' | 'scan' | 'cscan';
    cache_capacity: number;
  };
}

export interface DirtyTracker {
  upsertedDocs: Record<string, Record<string, any>>;
  deletedDocIds: Record<string, string[]>;
  upsertedKeyedMaps: Record<string, Record<string, any>>;
  deletedKeyedMapKeys: Record<string, string[]>;
  singletons: Record<string, any>;
  hasChanges: boolean;
}

export interface StateStore {
  readonly name: string;
  readonly isDurable: boolean;
  load(): Promise<LMSState | null>;
  saveDirty(state: LMSState, dirty: DirtyTracker): Promise<void>;
  nextId(collection: string, currentState?: LMSState): Promise<number>;
  close?(): Promise<void>;
}

export const ARRAY_COLLECTIONS = [
  'users',
  'courses',
  'enrollments',
  'materials',
  'assignments',
  'submissions',
  'announcements',
  'notifications',
  'departments',
  'subjects',
  'batches',
  'schedule_events',
  'jobs',
  'student_notes',
  'audit_logs',
  'login_activity',
] as const;

export const KEYED_MAP_COLLECTIONS = [
  'completed_materials',
  'bookmarked_materials',
  'quiz_scores',
  'assessment_attempts',
] as const;

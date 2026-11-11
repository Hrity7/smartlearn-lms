export type UserRole = 'admin' | 'faculty' | 'student';
export type AccountStatus = 'active' | 'deactivated';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: UserRole;
  status?: AccountStatus;
  created_at: string;
  last_login_at?: string | null;
  department_id?: number | null;
  department_name?: string;
  batch_id?: number | null;
  batch_name?: string;
  bio?: string;
  weekly_goal_hours?: number;
  notifications_enabled?: boolean;
  study_streak_days?: number;
  enrolled_course_count?: number;
  assigned_course_count?: number;
}

export interface QuizQuestion {
  id: string;
  question: string;
  question_type?: 'mcq' | 'subjective';
  marks?: number;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface Course {
  id: number;
  code: string;
  title: string;
  category: string;
  level: string;
  estimated_hours: number;
  accent_theme: 'lavender' | 'mint' | 'peach';
  description: string;
  faculty_id: number;
  faculty_name: string;
  faculty_title?: string;
  published?: boolean;
  approval_status?: 'approved' | 'pending' | 'archived';
  department_id?: number | null;
  department_name?: string;
  created_at: string;
  enrolled: boolean;
  student_count: number;
  material_count: number;
  completed_material_count: number;
  progress_percent: number;
  assignment_count: number;
  announcement_count: number;
  storage_used: number;
  storage_limit: number;
  quiz_score?: number | null;
  overall_completion_rate?: number;
}

export interface Material {
  id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  module_title: string;
  lesson_number: number;
  duration_minutes: number;
  video_summary?: string;
  video_url?: string | null;
  published?: boolean;
  key_takeaways?: string[];
  title: string;
  body: string;
  original_name: string | null;
  stored_name: string | null;
  file_size: number;
  content_type: string | null;
  created_by: number;
  created_at: string;
  cache_resident: boolean;
  track: number;
  completed: boolean;
  bookmarked: boolean;
}

export interface StudentNote {
  id: number;
  user_id: number;
  course_id: number;
  material_id: number;
  material_title: string;
  timestamp_label: string;
  content: string;
  created_at: string;
}

export interface ScheduleEvent {
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

export interface WeeklyActivityDay {
  day: string;
  hours: number;
  lessons: number;
}

export interface Submission {
  id: number;
  assignment_id: number;
  assignment_title?: string;
  course_code?: string;
  student_id: number;
  student_name: string;
  student_username: string;
  body: string;
  original_name: string | null;
  stored_name: string | null;
  file_size: number;
  submitted_at: string;
  grade: number | null;
  feedback: string | null;
  graded_at: string | null;
}

export interface Assignment {
  id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  title: string;
  description: string;
  due_at: string;
  max_score: number;
  reference_link?: string | null;
  created_by: number;
  created_at: string;
  submission_count: number;
  graded_count: number;
  my_submission: Submission | null;
  submissions?: Submission[];
}

export interface Announcement {
  id: number;
  course_id: number | null;
  course_code?: string;
  course_title?: string;
  target_audience?: 'all' | 'students' | 'teachers' | 'course';
  title: string;
  body: string;
  author_id: number;
  author_name: string;
  author_role?: UserRole;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export interface SearchResultItem {
  id: number;
  title: string;
  course_id: number;
  course_code: string;
  course_title: string;
  snippet: string;
  score: number;
  matched_terms: string[];
  cache_resident: boolean;
}

/* ============================================================================
   ADMINISTRATOR & ACADEMIC MANAGEMENT TYPES
   ============================================================================ */

export interface Department {
  id: number;
  code: string;
  name: string;
  description: string;
  head_faculty_id: number | null;
  head_faculty_name?: string;
  course_count?: number;
  subject_count?: number;
  batch_count?: number;
  created_at: string;
}

export interface AcademicSubject {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  department_name?: string;
  credits: number;
  semester: string;
  created_at: string;
}

export interface ClassBatch {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  department_name?: string;
  academic_year: string;
  semester: string;
  advisor_faculty_id: number | null;
  advisor_faculty_name?: string;
  student_ids: number[];
  course_ids: number[];
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor_id: number;
  actor_name: string;
  actor_role: UserRole;
  action: string;
  category: 'user' | 'course' | 'academic' | 'announcement' | 'security' | 'settings' | 'submission';
  target_label: string;
  details: string;
  created_at: string;
}

export interface LoginActivityEntry {
  id: number;
  user_id: number | null;
  username: string;
  role: UserRole | 'unknown';
  status: 'success' | 'failed' | 'blocked';
  message: string;
  timestamp: string;
}

export interface PlatformSettings {
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

export interface AdminAssignmentMonitorItem {
  id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  faculty_name: string;
  title: string;
  description: string;
  due_at: string;
  max_score: number;
  enrolled_students: number;
  submission_count: number;
  graded_count: number;
  pending_evaluation_count: number;
  overdue_missing_count: number;
  average_score: number | null;
  submissions: Submission[];
}

export interface AdminOverviewPayload {
  stats: {
    total_users: number;
    active_users: number;
    deactivated_users: number;
    total_students: number;
    total_teachers: number;
    total_admins: number;
    total_courses: number;
    active_courses: number;
    pending_courses: number;
    total_enrollments: number;
    total_materials: number;
    total_assignments: number;
    total_submissions: number;
    graded_submissions: number;
    pending_evaluations: number;
    total_announcements: number;
    total_departments: number;
    total_subjects: number;
    total_batches: number;
    overall_completion_rate: number | null;
    overall_average_grade: number | null;
    storage_used_bytes: number;
  };
  analytics: {
    course_engagement: Array<{
      course_id: number;
      course_code: string;
      course_title: string;
      faculty_name: string;
      enrolled_students: number;
      material_count: number;
      assignment_count: number;
      submission_count: number;
      average_completion_percent: number;
      average_grade: number | null;
    }>;
    teacher_activity: Array<{
      faculty_id: number;
      full_name: string;
      username: string;
      email: string;
      status: AccountStatus;
      assigned_courses: number;
      materials_uploaded: number;
      assignments_created: number;
      submissions_evaluated: number;
      pending_evaluations: number;
      announcements_posted: number;
    }>;
    student_performance: Array<{
      student_id: number;
      full_name: string;
      username: string;
      email: string;
      status: AccountStatus;
      enrolled_courses: number;
      completed_lessons: number;
      submissions_count: number;
      graded_submissions_count: number;
      average_grade: number | null;
      average_completion_percent: number;
      quiz_average: number | null;
    }>;
  };
  users: User[];
  courses: Course[];
  enrollments: Array<{
    student_id: number;
    student_name: string;
    student_username: string;
    course_id: number;
    course_code: string;
    course_title: string;
    enrolled_at: string;
  }>;
  departments: Department[];
  subjects: AcademicSubject[];
  batches: ClassBatch[];
  assignments_monitoring: AdminAssignmentMonitorItem[];
  announcements: Announcement[];
  audit_logs: AuditLogEntry[];
  login_activity: LoginActivityEntry[];
  platform_settings: PlatformSettings;
  backups: Array<{ filename: string; bytes: number; created_at: string }>;
}

/* ============================================================================
   TEACHER DASHBOARD TYPES
   ============================================================================ */

export interface TeacherCourseStudentSummary {
  student_id: number;
  full_name: string;
  username: string;
  email: string;
  enrolled_at: string;
  completed_lessons: number;
  total_lessons: number;
  progress_percent: number;
  assignments_submitted: number;
  assignments_total: number;
  assignment_average_percent: number | null;
  assessment_score: number | null;
  subjective_remarks?: string | null;
}

export interface TeacherCourseDetail extends Course {
  results_published: boolean;
  materials: Material[];
  quiz_questions: QuizQuestion[];
  enrolled_students: TeacherCourseStudentSummary[];
}

export interface TeacherStudentRecord {
  student_id: number;
  full_name: string;
  username: string;
  email: string;
  status: AccountStatus;
  department_name?: string;
  batch_name?: string;
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
  overall_progress_percent: number;
  overall_grade_percent: number | null;
}

export interface TeacherAssignmentRecord {
  id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  title: string;
  description: string;
  due_at: string;
  max_score: number;
  reference_link: string | null;
  created_at: string;
  enrolled_count: number;
  submission_count: number;
  graded_count: number;
  pending_count: number;
  submissions: Array<
    Submission & {
      student_email?: string;
      max_score?: number;
    }
  >;
}

export interface TeacherOverviewPayload {
  teacher: User;
  stats: {
    my_courses: number;
    total_students: number;
    pending_evaluations: number;
    upcoming_classes: number;
  };
  courses: TeacherCourseDetail[];
  students: TeacherStudentRecord[];
  assignments: TeacherAssignmentRecord[];
  schedule: ScheduleEvent[];
}

/* ============================================================================
   STUDENT DASHBOARD TYPES
   ============================================================================ */

export type StudentAssignmentStatus =
  | 'Not Submitted'
  | 'Submitted'
  | 'Under Evaluation'
  | 'Evaluated'
  | 'Overdue';

export interface StudentEnrolledCourseDetail extends Course {
  enrolled_at: string;
  results_published: boolean;
  materials: Material[];
  next_lesson_id: number | null;
  next_lesson_title: string | null;
}

export interface StudentCatalogCourse extends Course {
  published_lessons_count: number;
  downloadable_resources_count: number;
  video_resources_count: number;
  sample_modules: string[];
}

export interface StudentAssignmentItem {
  id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  faculty_name: string;
  title: string;
  description: string;
  due_at: string;
  max_score: number;
  reference_link: string | null;
  status_label: StudentAssignmentStatus;
  is_overdue: boolean;
  can_submit: boolean;
  my_submission: Submission | null;
}

export interface StudentAssessmentQuestionClient {
  id: string;
  question: string;
  question_type: 'mcq' | 'subjective';
  marks: number;
  options: string[];
  // Only populated when results_published is true and student has attempted
  correct_index?: number;
  explanation?: string;
}

export interface StudentAssessmentAttempt {
  course_id: number;
  student_id: number;
  submitted_at: string;
  answers: Record<string, string | number>;
  auto_score_percent: number;
}

export interface StudentAssessmentItem {
  course_id: number;
  course_code: string;
  course_title: string;
  faculty_name: string;
  question_count: number;
  total_marks: number;
  duration_minutes: number;
  results_published: boolean;
  attempted: boolean;
  submitted_at: string | null;
  published_score: number | null;
  questions: StudentAssessmentQuestionClient[];
  saved_answers?: Record<string, string | number>;
}

export interface StudentActivityItem {
  id: string;
  type: 'lesson' | 'assignment' | 'assessment' | 'enrollment';
  title: string;
  course_code: string;
  detail: string;
  timestamp: string;
}

export interface StudentOverviewPayload {
  student: User;
  stats: {
    enrolled_courses: number;
    completed_courses: number;
    pending_assignments: number;
    average_performance: number | null;
  };
  enrolled_courses: StudentEnrolledCourseDetail[];
  catalog_courses: StudentCatalogCourse[];
  assignments: StudentAssignmentItem[];
  assessments: StudentAssessmentItem[];
  recent_activity: StudentActivityItem[];
  upcoming_deadlines: Array<{
    id: string;
    kind: 'assignment' | 'schedule';
    title: string;
    course_code: string;
    course_title: string;
    due_label: string;
    status_label: string;
  }>;
}



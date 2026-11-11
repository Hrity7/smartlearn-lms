import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Award,
  Search,
  FileText,
  Download,
  ExternalLink,
  Video,
  Play,
  Lock,
  LogOut,
  RefreshCw,
  AlertCircle,
  X,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Layers,
  User as UserIcon,
} from 'lucide-react';
import {
  StudentOverviewPayload,
  StudentEnrolledCourseDetail,
  StudentCatalogCourse,
  StudentAssignmentItem,
  StudentAssessmentItem,
  Material,
} from '../types/lms';
import {
  auth,
} from '../utils/firebase';
import { downloadFileWithAuth, getSessionToken, apiFetch } from '../utils/api';

export type StudentSection =
  | 'student_dashboard'
  | 'student_learning'
  | 'student_explore'
  | 'student_assignments'
  | 'student_assessments'
  | 'student_progress'
  | 'student_settings';

interface StudentDashboardViewProps {
  activeUserId: number;
  sessionToken?: string | null;
  activeSection: StudentSection;
  onNavigateSection: (section: StudentSection) => void;
  onOpenCourseWorkspace: (
    courseId: number,
    assignmentId?: number | null,
    materialId?: number | null
  ) => void;
  onRefreshGlobalData: () => void;
  onSignOut: () => void;
}

export const StudentDashboardView: React.FC<StudentDashboardViewProps> = ({
  activeUserId,
  sessionToken,
  activeSection,
  onNavigateSection,
  onOpenCourseWorkspace,
  onRefreshGlobalData,
  onSignOut,
}) => {
  const [data, setData] = useState<StudentOverviewPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 2. My Learning state
  const [learningCourseId, setLearningCourseId] = useState<number | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<number | null>(null);
  const [togglingLessonId, setTogglingLessonId] = useState<number | null>(null);

  // 3. Explore Courses state
  const [exploreSearch, setExploreSearch] = useState<string>('');
  const [exploreCategory, setExploreCategory] = useState<string>('ALL');
  const [inspectingCatalogCourse, setInspectingCatalogCourse] =
    useState<StudentCatalogCourse | null>(null);
  const [enrollingCourseId, setEnrollingCourseId] = useState<number | null>(null);

  // 4. Assignments state
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<
    'ALL' | 'Not Submitted' | 'Submitted' | 'Under Evaluation' | 'Evaluated' | 'Overdue'
  >('ALL');
  const [assignmentCourseFilter, setAssignmentCourseFilter] = useState<string>('ALL');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);
  const [submissionBody, setSubmissionBody] = useState<string>('');
  const [submissionFileName, setSubmissionFileName] = useState<string>('');
  const [submissionFileSizeKb, setSubmissionFileSizeKb] = useState<number>(0);
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submittingAssignment, setSubmittingAssignment] = useState<boolean>(false);

  // 5. Assessments & Results state
  const [activeAssessmentCourseId, setActiveAssessmentCourseId] = useState<number | null>(null);
  const [assessmentRunnerOpen, setAssessmentRunnerOpen] = useState<boolean>(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [assessmentAnswers, setAssessmentAnswers] = useState<Record<string, string | number>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [submittingAssessment, setSubmittingAssessment] = useState<boolean>(false);
  const [submissionConfirmation, setSubmissionConfirmation] = useState<{
    course_title: string;
    results_published: boolean;
    published_score: number | null;
  } | null>(null);
  const [reviewingAssessment, setReviewingAssessment] = useState<StudentAssessmentItem | null>(
    null
  );

  // 7. Profile & Settings state
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    email: '',
    bio: '',
    weekly_goal_hours: 16,
    notifications_enabled: true,
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  const getHeaders = useCallback(
    (includeJson = false): Record<string, string> => {
      const headers: Record<string, string> = {};
      const token = sessionToken || getSessionToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-lms-session-token'] = token;
      }
      if (includeJson) {
        headers['Content-Type'] = 'application/json';
      }
      return headers;
    },
    [sessionToken]
  );

  const fetchStudentOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/student/overview', {
        headers: getHeaders(false),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to load student dashboard' }));
        throw new Error(err.error || 'Failed to load student dashboard');
      }
      const payload: StudentOverviewPayload = await res.json();
      setData(payload);

      if (payload.enrolled_courses.length > 0) {
        setLearningCourseId((prev) => {
          const valid =
            prev && payload.enrolled_courses.some((c) => c.id === prev)
              ? prev
              : payload.enrolled_courses[0].id;
          return valid;
        });
      } else {
        setLearningCourseId(null);
      }

      setProfileForm({
        full_name: payload.student.full_name || '',
        email: payload.student.email || '',
        bio: payload.student.bio || '',
        weekly_goal_hours: payload.student.weekly_goal_hours ?? 16,
        notifications_enabled: payload.student.notifications_enabled ?? true,
      });
    } catch (e: any) {
      setError(e.message || 'Unable to load student data.');
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => {
    fetchStudentOverview();
  }, [fetchStudentOverview]);

  // Active enrolled course in My Learning
  const activeLearningCourse: StudentEnrolledCourseDetail | null = useMemo(() => {
    if (!data || data.enrolled_courses.length === 0) return null;
    if (learningCourseId) {
      const found = data.enrolled_courses.find((c) => c.id === learningCourseId);
      if (found) return found;
    }
    return data.enrolled_courses[0];
  }, [data, learningCourseId]);

  useEffect(() => {
    if (!activeLearningCourse) {
      setActiveLessonId(null);
      return;
    }
    setActiveLessonId((prev) => {
      if (prev && activeLearningCourse.materials.some((m) => m.id === prev)) {
        return prev;
      }
      return (
        activeLearningCourse.next_lesson_id ||
        activeLearningCourse.materials[0]?.id ||
        null
      );
    });
  }, [activeLearningCourse]);

  const activeLesson: Material | null = useMemo(() => {
    if (!activeLearningCourse || !activeLessonId) return null;
    return (
      activeLearningCourse.materials.find((m) => m.id === activeLessonId) ||
      activeLearningCourse.materials[0] ||
      null
    );
  }, [activeLearningCourse, activeLessonId]);

  const groupedModules = useMemo(() => {
    if (!activeLearningCourse) return [];
    const map = new Map<string, Material[]>();
    for (const m of activeLearningCourse.materials) {
      const modTitle = m.module_title || 'Module 1 · Core Lessons';
      if (!map.has(modTitle)) map.set(modTitle, []);
      map.get(modTitle)!.push(m);
    }
    return Array.from(map.entries()).map(([moduleTitle, lessons]) => ({
      moduleTitle,
      lessons,
    }));
  }, [activeLearningCourse]);

  // Explore Courses filtering
  const availableCategories = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.catalog_courses.map((c) => c.category))).sort();
  }, [data]);

  const filteredCatalogCourses = useMemo(() => {
    if (!data) return [];
    const q = exploreSearch.trim().toLowerCase();
    return data.catalog_courses.filter((c) => {
      const matchesSearch =
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.faculty_name.toLowerCase().includes(q);
      const matchesCat = exploreCategory === 'ALL' || c.category === exploreCategory;
      return matchesSearch && matchesCat;
    });
  }, [data, exploreSearch, exploreCategory]);

  // Assignments filtering
  const filteredAssignments = useMemo(() => {
    if (!data) return [];
    return data.assignments.filter((a) => {
      const matchesCourse =
        assignmentCourseFilter === 'ALL' || String(a.course_id) === assignmentCourseFilter;
      if (!matchesCourse) return false;
      if (assignmentStatusFilter === 'ALL') return true;
      if (assignmentStatusFilter === 'Submitted') {
        return a.my_submission !== null;
      }
      return a.status_label === assignmentStatusFilter;
    });
  }, [data, assignmentCourseFilter, assignmentStatusFilter]);

  const activeAssignment: StudentAssignmentItem | null = useMemo(() => {
    if (!data) return null;
    if (selectedAssignmentId) {
      const found = data.assignments.find((a) => a.id === selectedAssignmentId);
      if (found) return found;
    }
    return filteredAssignments[0] || null;
  }, [data, selectedAssignmentId, filteredAssignments]);

  useEffect(() => {
    if (activeAssignment) {
      setSubmissionBody(activeAssignment.my_submission?.body || '');
      setSubmissionFileName('');
      setSubmissionFileSizeKb(0);
      setSubmissionFile(null);
    }
  }, [activeAssignment]);

  // Active Assessment for Runner
  const activeAssessmentForRunner: StudentAssessmentItem | null = useMemo(() => {
    if (!data || !activeAssessmentCourseId) return null;
    return data.assessments.find((a) => a.course_id === activeAssessmentCourseId) || null;
  }, [data, activeAssessmentCourseId]);

  // Countdown timer for active assessment attempt
  useEffect(() => {
    if (!assessmentRunnerOpen || remainingSeconds <= 0) return;
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [assessmentRunnerOpen, remainingSeconds]);

  // Handlers
  const handleResumeCourse = (course: StudentEnrolledCourseDetail) => {
    setLearningCourseId(course.id);
    if (course.next_lesson_id) {
      setActiveLessonId(course.next_lesson_id);
    } else if (course.materials[0]) {
      setActiveLessonId(course.materials[0].id);
    }
    onNavigateSection('student_learning');
  };

  const handleToggleLessonComplete = async (lesson: Material) => {
    setTogglingLessonId(lesson.id);
    try {
      const res = await fetch(`/api/student/materials/${lesson.id}/complete`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({ completed: !lesson.completed }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update lesson progress');
      setData(out.overview);
      showToast(
        'success',
        !lesson.completed
          ? `Marked "${lesson.title}" as completed.`
          : `Marked "${lesson.title}" as in-progress.`
      );
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setTogglingLessonId(null);
    }
  };

  const handleEnrollCourse = async (courseId: number) => {
    setEnrollingCourseId(courseId);
    try {
      const res = await fetch(`/api/student/courses/${courseId}/enroll`, {
        method: 'POST',
        headers: getHeaders(true),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to enroll in course');
      setData(out.overview);
      setInspectingCatalogCourse(null);
      setLearningCourseId(courseId);
      showToast('success', 'Successfully enrolled in course.');
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setEnrollingCourseId(null);
    }
  };

  const handleAssignmentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmissionFile(file);
    setSubmissionFileName(file.name);
    setSubmissionFileSizeKb(Math.max(1, Math.round(file.size / 1024)));
  };

  const handleSubmitAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAssignment) return;
    setSubmittingAssignment(true);
    try {
      const formData = new FormData();
      formData.append('body', submissionBody);
      if (submissionFile) {
        formData.append('file', submissionFile);
      }
      const res = await apiFetch(`/api/student/assignments/${activeAssignment.id}/submit`, {
        method: 'POST',
        body: formData,
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to submit assignment');
      setData(out.overview);
      setSubmissionFileName('');
      setSubmissionFileSizeKb(0);
      setSubmissionFile(null);
      showToast('success', `Assignment "${activeAssignment.title}" submitted.`);
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmittingAssignment(false);
    }
  };

  const handleStartAssessment = (asmt: StudentAssessmentItem) => {
    if (asmt.question_count === 0) {
      showToast('error', 'No questions are available for this assessment yet.');
      return;
    }
    setActiveAssessmentCourseId(asmt.course_id);
    setCurrentQuestionIndex(0);
    setAssessmentAnswers(asmt.saved_answers ? { ...asmt.saved_answers } : {});
    setRemainingSeconds(asmt.duration_minutes * 60);
    setSubmissionConfirmation(null);
    setAssessmentRunnerOpen(true);
  };

  const handleSubmitAssessment = async () => {
    if (!activeAssessmentForRunner) return;
    setSubmittingAssessment(true);
    try {
      const res = await fetch(
        `/api/student/courses/${activeAssessmentForRunner.course_id}/assessment/submit`,
        {
          method: 'POST',
          headers: getHeaders(true),
          body: JSON.stringify({
            answers: assessmentAnswers,
          }),
        }
      );
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to submit assessment');
      setData(out.overview);
      setAssessmentRunnerOpen(false);
      setSubmissionConfirmation({
        course_title: activeAssessmentForRunner.course_title,
        results_published: out.results_published,
        published_score: out.published_score,
      });
      showToast('success', 'Assessment submitted successfully.');
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmittingAssessment(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/student/profile', {
        method: 'PUT',
        headers: getHeaders(true),
        body: JSON.stringify(profileForm),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update profile');
      setData(out.overview);
      showToast('success', 'Student profile updated.');
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showToast('error', 'New passwords do not match.');
      return;
    }
    try {
      const res = await fetch('/api/student/password', {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          new_password: passwordForm.new_password,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to change password');
      showToast('success', 'Password changed successfully.');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'Evaluated':
        return 'bg-[#EBF3EE] text-[#2F6A4F]';
      case 'Under Evaluation':
      case 'Submitted':
        return 'bg-[#EAE4DA] text-[#315C83]';
      case 'Overdue':
        return 'bg-[#F9EBEB] text-[#993B3B]';
      default:
        return 'bg-[#FBF3E6] text-[#946326]';
    }
  };

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[420px]">
        <div className="flex items-center gap-3 text-sm text-[#73777C]">
          <RefreshCw className="w-4 h-4 animate-spin text-[#315C83]" />
          <span>Loading student workspace...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6 max-w-lg mx-auto text-center space-y-3">
          <AlertCircle className="w-6 h-6 text-[#993B3B] mx-auto" />
          <h3 className="text-base font-semibold text-[#252B32]">
            Unable to load Student Dashboard
          </h3>
          <p className="text-xs text-[#73777C]">{error || 'No data returned from server.'}</p>
          <button
            onClick={fetchStudentOverview}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const totalCompletedLessons = data.enrolled_courses.reduce(
    (sum, c) => sum + c.completed_material_count,
    0
  );
  const ongoingCoursesCount = Math.max(
    0,
    data.stats.enrolled_courses - data.stats.completed_courses
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Feedback Toast */}
      {toast && (
        <div
          className={`flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-medium ${
            toast.type === 'success'
              ? 'bg-[#EBF3EE] border-[#B7D4C2] text-[#2F6A4F]'
              : 'bg-[#F9EBEB] border-[#DEB8B8] text-[#993B3B]'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{toast.text}</span>
          </div>
          <button
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =====================================================================
          1. STUDENT DASHBOARD
      ===================================================================== */}
      {activeSection === 'student_dashboard' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">
                Student Dashboard
              </h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Welcome back, {data.student.full_name}. Track your enrolled courses, pending assignments, and academic progress.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onNavigateSection('student_explore')}
                className="px-3.5 py-2 rounded-lg text-xs font-medium border border-[#DDD6CA] bg-[#FAF8F5] text-[#252B32] hover:bg-[#EAE4DA] transition-colors cursor-pointer"
              >
                Explore Courses
              </button>
              <button
                onClick={() => onNavigateSection('student_learning')}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5" />
                My Learning
              </button>
            </div>
          </div>

          {/* 4 Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">Enrolled Courses</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.enrolled_courses}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#315C83]">
                <BookOpen className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">Completed Courses</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.completed_courses}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#2F6A4F]">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">Pending Assignments</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.pending_assignments}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#946326]">
                <Clock className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">Average Performance</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.average_performance !== null
                    ? `${data.stats.average_performance}%`
                    : '—'}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#315C83]">
                <Award className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Below Summary Cards: Continue Learning, Upcoming Deadlines, Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Continue Learning */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[#252B32]">Continue Learning</h2>
                  <button
                    onClick={() => onNavigateSection('student_learning')}
                    className="text-xs font-medium text-[#315C83] hover:underline cursor-pointer"
                  >
                    All courses
                  </button>
                </div>

                {data.enrolled_courses.length === 0 ? (
                  <div className="py-6 text-center space-y-2">
                    <p className="text-xs text-[#73777C]">
                      You are not enrolled in any courses yet.
                    </p>
                    <button
                      onClick={() => onNavigateSection('student_explore')}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer"
                    >
                      Browse Catalog
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-[#EAE4DA]">
                    {data.enrolled_courses.slice(0, 4).map((course) => (
                      <div key={course.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-[11px] font-semibold text-[#315C83]">
                              {course.code}
                            </span>
                            <p className="text-xs font-medium text-[#252B32] truncate">
                              {course.title}
                            </p>
                            <p className="text-[11px] text-[#73777C]">
                              {course.completed_material_count}/{course.material_count} lessons completed
                            </p>
                          </div>
                          <button
                            onClick={() => handleResumeCourse(course)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors shrink-0 cursor-pointer"
                          >
                            Resume
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-[#EAE4DA] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#315C83]"
                              style={{ width: `${course.progress_percent}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-medium text-[#555A60]">
                            {course.progress_percent}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Deadlines */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[#252B32]">Upcoming Deadlines</h2>
                  <button
                    onClick={() => onNavigateSection('student_assignments')}
                    className="text-xs font-medium text-[#315C83] hover:underline cursor-pointer"
                  >
                    View assignments
                  </button>
                </div>

                {data.upcoming_deadlines.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-6 text-center">
                    No upcoming assignment or assessment deadlines.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA]">
                    {data.upcoming_deadlines.slice(0, 5).map((item) => (
                      <div
                        key={item.id}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="text-[11px] font-semibold text-[#315C83]">
                            {item.course_code}
                          </span>
                          <p className="text-xs font-medium text-[#252B32] truncate">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-[#73777C]">Due: {item.due_label}</p>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 capitalize ${getStatusBadgeStyle(
                            item.status_label
                          )}`}
                        >
                          {item.status_label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[#252B32]">Recent Activity</h2>
                  <button
                    onClick={() => onNavigateSection('student_progress')}
                    className="text-xs font-medium text-[#315C83] hover:underline cursor-pointer"
                  >
                    My progress
                  </button>
                </div>

                {data.recent_activity.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-6 text-center">
                    No learning activity recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA]">
                    {data.recent_activity.slice(0, 5).map((act) => (
                      <div key={act.id} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between text-[11px] text-[#73777C]">
                          <span className="font-semibold text-[#315C83]">{act.course_code}</span>
                          <span>{act.timestamp.slice(0, 10)}</span>
                        </div>
                        <p className="text-xs font-medium text-[#252B32] truncate mt-0.5">
                          {act.title}
                        </p>
                        <p className="text-[11px] text-[#73777C] truncate">{act.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. MY LEARNING (Enrolled Courses, Modules & Lessons, Videos, PDFs, Progress)
      ===================================================================== */}
      {activeSection === 'student_learning' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">My Learning</h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Access your enrolled courses, study modules, video lectures, and downloadable materials.
              </p>
            </div>
            <button
              onClick={() => onNavigateSection('student_explore')}
              className="px-3.5 py-2 rounded-lg text-xs font-medium border border-[#DDD6CA] bg-[#FAF8F5] text-[#252B32] hover:bg-[#EAE4DA] transition-colors self-start cursor-pointer"
            >
              Explore More Courses
            </button>
          </div>

          {data.enrolled_courses.length === 0 ? (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-8 text-center space-y-3">
              <BookOpen className="w-6 h-6 text-[#315C83] mx-auto" />
              <h3 className="text-sm font-semibold text-[#252B32]">
                You have not enrolled in any courses yet
              </h3>
              <p className="text-xs text-[#73777C] max-w-md mx-auto">
                Visit the Explore Courses section to browse available courses and start learning.
              </p>
              <button
                onClick={() => onNavigateSection('student_explore')}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer"
              >
                Explore Available Courses
              </button>
            </div>
          ) : (
            <>
              {/* Enrolled Course Selector Tabs */}
              <div className="flex flex-wrap items-center gap-2">
                {data.enrolled_courses.map((course) => {
                  const isSelected = activeLearningCourse?.id === course.id;
                  return (
                    <button
                      key={course.id}
                      onClick={() => setLearningCourseId(course.id)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer flex items-center gap-2 ${
                        isSelected
                          ? 'bg-[#315C83] text-white border-[#315C83]'
                          : 'bg-[#FAF8F5] text-[#252B32] border-[#DDD6CA] hover:bg-[#EAE4DA]'
                      }`}
                    >
                      <span>{course.code}</span>
                      <span className="opacity-75">·</span>
                      <span className="truncate max-w-[180px]">{course.title}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-[#EAE4DA] text-[#555A60]'
                        }`}
                      >
                        {course.progress_percent}%
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeLearningCourse && (
                <div className="space-y-6">
                  {/* Course Summary Bar */}
                  <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#73777C]">
                          <span className="font-semibold text-[#315C83]">
                            {activeLearningCourse.code}
                          </span>
                          <span>·</span>
                          <span>{activeLearningCourse.category}</span>
                          <span>·</span>
                          <span>Instructor: {activeLearningCourse.faculty_name}</span>
                        </div>
                        <h2 className="text-lg font-semibold text-[#252B32]">
                          {activeLearningCourse.title}
                        </h2>
                        <p className="text-xs text-[#555A60] max-w-3xl">
                          {activeLearningCourse.description}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {activeLearningCourse.next_lesson_id && (
                          <button
                            onClick={() =>
                              setActiveLessonId(activeLearningCourse.next_lesson_id)
                            }
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Resume Next Lesson
                          </button>
                        )}
                        <button
                          onClick={() =>
                            onOpenCourseWorkspace(
                              activeLearningCourse.id,
                              null,
                              activeLesson?.id || null
                            )
                          }
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors cursor-pointer"
                        >
                          Open Full Reader & Notes
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-4 pt-4 border-t border-[#EAE4DA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="text-xs text-[#555A60]">
                        Completed{' '}
                        <strong className="text-[#252B32]">
                          {activeLearningCourse.completed_material_count}
                        </strong>{' '}
                        of{' '}
                        <strong className="text-[#252B32]">
                          {activeLearningCourse.material_count}
                        </strong>{' '}
                        published lessons
                      </div>
                      <div className="flex items-center gap-3 sm:w-64">
                        <div className="flex-1 h-2 bg-[#EAE4DA] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#315C83] transition-all"
                            style={{ width: `${activeLearningCourse.progress_percent}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-[#252B32]">
                          {activeLearningCourse.progress_percent}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Modules & Lesson Viewer Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Course Modules & Lessons List */}
                    <div className="lg:col-span-4 space-y-3">
                      <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 space-y-4">
                        <h3 className="text-sm font-semibold text-[#252B32]">
                          Course Modules & Lessons
                        </h3>

                        {groupedModules.length === 0 ? (
                          <p className="text-xs text-[#73777C] py-6 text-center">
                            No published lessons in this course yet.
                          </p>
                        ) : (
                          <div className="space-y-4">
                            {groupedModules.map((group) => (
                              <div key={group.moduleTitle} className="space-y-1.5">
                                <p className="text-[11px] font-semibold text-[#73777C] uppercase tracking-wide px-1">
                                  {group.moduleTitle}
                                </p>
                                <div className="space-y-1">
                                  {group.lessons.map((lesson) => {
                                    const isCurrent = activeLesson?.id === lesson.id;
                                    return (
                                      <button
                                        key={lesson.id}
                                        onClick={() => setActiveLessonId(lesson.id)}
                                        className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                                          isCurrent
                                            ? 'bg-white border-[#315C83]'
                                            : 'bg-[#FAF8F5] border-[#EAE4DA] hover:bg-[#F3EFEA]'
                                        }`}
                                      >
                                        <div className="flex items-start gap-2 min-w-0">
                                          <CheckCircle2
                                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                                              lesson.completed
                                                ? 'text-[#2F6A4F]'
                                                : 'text-[#C6BEB0]'
                                            }`}
                                          />
                                          <div className="min-w-0">
                                            <p className="font-medium text-[#252B32] truncate">
                                              {lesson.lesson_number}. {lesson.title}
                                            </p>
                                            <p className="text-[11px] text-[#73777C]">
                                              {lesson.duration_minutes} mins
                                              {lesson.video_url ? ' · Video' : ''}
                                              {lesson.original_name ? ' · Resource' : ''}
                                            </p>
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Active Lesson Content & Media */}
                    <div className="lg:col-span-8">
                      <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                        {!activeLesson ? (
                          <p className="text-xs text-[#73777C] py-12 text-center">
                            Select a lesson from the module list to start studying.
                          </p>
                        ) : (
                          <div className="space-y-5">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-[#EAE4DA]">
                              <div>
                                <p className="text-xs font-medium text-[#315C83]">
                                  {activeLesson.module_title} · Lesson {activeLesson.lesson_number}
                                </p>
                                <h3 className="text-base font-semibold text-[#252B32] mt-0.5">
                                  {activeLesson.title}
                                </h3>
                                <p className="text-[11px] text-[#73777C] mt-0.5">
                                  Estimated study time: {activeLesson.duration_minutes} minutes
                                </p>
                              </div>

                              <button
                                onClick={() => handleToggleLessonComplete(activeLesson)}
                                disabled={togglingLessonId === activeLesson.id}
                                className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                                  activeLesson.completed
                                    ? 'bg-[#EBF3EE] border border-[#B7D4C2] text-[#2F6A4F]'
                                    : 'bg-[#315C83] text-white hover:bg-[#274B6B]'
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {activeLesson.completed
                                  ? 'Completed (Click to Undo)'
                                  : 'Mark as Completed'}
                              </button>
                            </div>

                            {/* Video Resource Section */}
                            {activeLesson.video_url && (
                              <div className="bg-white border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#315C83] shrink-0">
                                    <Video className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[#252B32]">
                                      Video Lecture Resource
                                    </p>
                                    <p className="text-[11px] text-[#73777C] truncate">
                                      {activeLesson.video_url}
                                    </p>
                                  </div>
                                </div>
                                <a
                                  href={activeLesson.video_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors inline-flex items-center gap-1.5 shrink-0"
                                >
                                  <span>Watch Video</span>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            )}

                            {/* Downloadable PDF / Presentation / Document Attachment */}
                            {activeLesson.original_name && (
                              <div className="bg-white border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#315C83] shrink-0">
                                    <FileText className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[#252B32] truncate">
                                      {activeLesson.original_name}
                                    </p>
                                    <p className="text-[11px] text-[#73777C]">
                                      Downloadable Learning Material (
                                      {Math.max(1, Math.round((activeLesson.file_size || 1024) / 1024))}{' '}
                                      KB)
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    downloadFileWithAuth(
                                      `/api/materials/${activeLesson.id}/download`,
                                      activeLesson.original_name || 'material.bin'
                                    ).catch((err) =>
                                      showToast('error', err instanceof Error ? err.message : 'Download failed')
                                    );
                                  }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5 text-[#315C83]" />
                                  <span>Download</span>
                                </button>
                              </div>
                            )}

                            {/* Lesson Lecture Notes Body */}
                            <div className="bg-white border border-[#EAE4DA] rounded-xl p-4">
                              <h4 className="text-xs font-semibold text-[#73777C] uppercase mb-2">
                                Lecture Notes & Study Material
                              </h4>
                              <div className="text-xs text-[#252B32] leading-relaxed whitespace-pre-line">
                                {activeLesson.body}
                              </div>
                            </div>

                            {/* Prev / Next Lesson Controls */}
                            {(() => {
                              const allLessons = activeLearningCourse.materials;
                              const idx = allLessons.findIndex((m) => m.id === activeLesson.id);
                              const prevLesson = idx > 0 ? allLessons[idx - 1] : null;
                              const nextLesson =
                                idx >= 0 && idx < allLessons.length - 1 ? allLessons[idx + 1] : null;

                              return (
                                <div className="flex items-center justify-between pt-3 border-t border-[#EAE4DA]">
                                  <button
                                    disabled={!prevLesson}
                                    onClick={() => prevLesson && setActiveLessonId(prevLesson.id)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] disabled:opacity-40 transition-colors inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                    Previous Lesson
                                  </button>
                                  <button
                                    disabled={!nextLesson}
                                    onClick={() => nextLesson && setActiveLessonId(nextLesson.id)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] disabled:opacity-40 transition-colors inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    Next Lesson
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          3. EXPLORE COURSES (Search, Filter by Category, Details, Enroll)
      ===================================================================== */}
      {activeSection === 'student_explore' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">
                Explore Courses
              </h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Discover available published courses, inspect learning resources, and enroll.
              </p>
            </div>
          </div>

          {/* Search and Category Filter */}
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#73777C] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={exploreSearch}
                onChange={(e) => setExploreSearch(e.target.value)}
                placeholder="Search courses by title, code, or instructor..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
              />
            </div>

            <select
              value={exploreCategory}
              onChange={(e) => setExploreCategory(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
            >
              <option value="ALL">All Categories ({data.catalog_courses.length})</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Course Cards Grid */}
          {filteredCatalogCourses.length === 0 ? (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-8 text-center">
              <p className="text-sm font-medium text-[#252B32]">No courses available</p>
              <p className="text-xs text-[#73777C] mt-1">
                No published courses match your search or category filter.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredCatalogCourses.map((course) => (
                <div
                  key={course.id}
                  className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-[#73777C]">
                      <span className="font-semibold text-[#315C83]">{course.code}</span>
                      <span>
                        {course.category} · {course.level}
                      </span>
                    </div>

                    <h2 className="text-base font-semibold text-[#252B32]">{course.title}</h2>
                    <p className="text-xs text-[#555A60] line-clamp-3 leading-relaxed">
                      {course.description}
                    </p>

                    <div className="pt-2 text-[11px] text-[#73777C] space-y-1">
                      <p>
                        <strong className="text-[#252B32]">Instructor:</strong>{' '}
                        {course.faculty_name}
                      </p>
                      <p>
                        <strong className="text-[#252B32]">Resources:</strong>{' '}
                        {course.published_lessons_count} lessons · {course.estimated_hours}h study time
                        {course.downloadable_resources_count > 0
                          ? ` · ${course.downloadable_resources_count} files`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#EAE4DA] flex items-center justify-between gap-2">
                    <button
                      onClick={() => setInspectingCatalogCourse(course)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors cursor-pointer"
                    >
                      View Details
                    </button>

                    {course.enrolled ? (
                      <button
                        onClick={() => {
                          setLearningCourseId(course.id);
                          onNavigateSection('student_learning');
                        }}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#EBF3EE] border border-[#B7D4C2] text-[#2F6A4F] cursor-pointer"
                      >
                        Enrolled · Open Course
                      </button>
                    ) : (
                      <button
                        onClick={() => handleEnrollCourse(course.id)}
                        disabled={enrollingCourseId === course.id}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {enrollingCourseId === course.id ? 'Enrolling...' : 'Enroll Now'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          4. ASSIGNMENTS (Enrolled Course Assignments, Submit File/Text, Statuses, Feedback)
      ===================================================================== */}
      {activeSection === 'student_assignments' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">Assignments</h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                View assignments for your enrolled courses, submit work, and review instructor marks and feedback.
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 bg-[#EAE4DA] p-1 rounded-lg">
              {(
                [
                  'ALL',
                  'Not Submitted',
                  'Submitted',
                  'Under Evaluation',
                  'Evaluated',
                  'Overdue',
                ] as const
              ).map((st) => (
                <button
                  key={st}
                  onClick={() => setAssignmentStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    assignmentStatusFilter === st
                      ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                      : 'text-[#555A60] hover:text-[#252B32]'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st}
                </button>
              ))}
            </div>

            <select
              value={assignmentCourseFilter}
              onChange={(e) => setAssignmentCourseFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg text-[#252B32]"
            >
              <option value="ALL">All Enrolled Courses</option>
              {data.enrolled_courses.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>

          {data.assignments.length === 0 ? (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-8 text-center">
              <p className="text-xs text-[#73777C]">
                No assignments found for your enrolled courses.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Assignment List */}
              <div className="lg:col-span-5 space-y-2.5">
                <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 space-y-2.5">
                  <h2 className="text-sm font-semibold text-[#252B32] mb-2">
                    Assignments ({filteredAssignments.length})
                  </h2>
                  {filteredAssignments.length === 0 ? (
                    <p className="text-xs text-[#73777C] py-6 text-center">
                      No assignments match the selected filter.
                    </p>
                  ) : (
                    filteredAssignments.map((asgn) => {
                      const isSelected = activeAssignment?.id === asgn.id;
                      return (
                        <div
                          key={asgn.id}
                          onClick={() => setSelectedAssignmentId(asgn.id)}
                          className={`p-3.5 rounded-xl border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-white border-[#315C83]'
                              : 'bg-[#FAF8F5] border-[#DDD6CA] hover:bg-[#F3EFEA]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[11px] font-semibold text-[#315C83]">
                                {asgn.course_code}
                              </span>
                              <h3 className="text-xs font-semibold text-[#252B32] mt-0.5">
                                {asgn.title}
                              </h3>
                            </div>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 ${getStatusBadgeStyle(
                                asgn.status_label
                              )}`}
                            >
                              {asgn.status_label}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-[#73777C] mt-2 pt-2 border-t border-[#EAE4DA]">
                            <span>Due: {asgn.due_at}</span>
                            <span>
                              {asgn.my_submission?.grade !== null &&
                              asgn.my_submission?.grade !== undefined
                                ? `Score: ${asgn.my_submission.grade}/${asgn.max_score}`
                                : `Max: ${asgn.max_score} pts`}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Assignment Detail & Submission Form */}
              <div className="lg:col-span-7">
                <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                  {!activeAssignment ? (
                    <p className="text-xs text-[#73777C] py-12 text-center">
                      Select an assignment on the left to view instructions and submit your work.
                    </p>
                  ) : (
                    <div className="space-y-5">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-[#EAE4DA]">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-[#73777C]">
                            <span className="font-semibold text-[#315C83]">
                              {activeAssignment.course_code}
                            </span>
                            <span>·</span>
                            <span>{activeAssignment.course_title}</span>
                          </div>
                          <h2 className="text-base font-semibold text-[#252B32] mt-1">
                            {activeAssignment.title}
                          </h2>
                          <p className="text-[11px] text-[#73777C] mt-0.5">
                            Instructor: {activeAssignment.faculty_name} · Deadline:{' '}
                            <strong>{activeAssignment.due_at}</strong> · Max Marks:{' '}
                            <strong>{activeAssignment.max_score}</strong>
                          </p>
                        </div>

                        <span
                          className={`text-xs px-2.5 py-1 rounded-md font-medium self-start ${getStatusBadgeStyle(
                            activeAssignment.status_label
                          )}`}
                        >
                          {activeAssignment.status_label}
                        </span>
                      </div>

                      {/* Instructions & Reference Link */}
                      <div className="bg-white border border-[#EAE4DA] rounded-xl p-4 space-y-2">
                        <h3 className="text-xs font-semibold text-[#73777C] uppercase">
                          Assignment Instructions
                        </h3>
                        <p className="text-xs text-[#252B32] leading-relaxed whitespace-pre-line">
                          {activeAssignment.description}
                        </p>
                        {activeAssignment.reference_link && (
                          <div className="pt-2">
                            <a
                              href={activeAssignment.reference_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#315C83] hover:underline"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Open Attached Reference Material
                            </a>
                          </div>
                        )}
                      </div>

                      {/* Published Evaluation & Teacher Feedback */}
                      {activeAssignment.my_submission &&
                        activeAssignment.my_submission.grade !== null &&
                        activeAssignment.my_submission.grade !== undefined && (
                          <div className="bg-[#EBF3EE] border border-[#B7D4C2] rounded-xl p-4 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-[#2F6A4F]">
                                Evaluation Published
                              </span>
                              <span className="text-sm font-bold text-[#2F6A4F]">
                                {activeAssignment.my_submission.grade} /{' '}
                                {activeAssignment.max_score}
                              </span>
                            </div>
                            {activeAssignment.my_submission.feedback && (
                              <p className="text-xs text-[#252B32]">
                                <strong>Instructor Feedback:</strong>{' '}
                                {activeAssignment.my_submission.feedback}
                              </p>
                            )}
                          </div>
                        )}

                      {/* Existing Submission Summary */}
                      {activeAssignment.my_submission && (
                        <div className="bg-white border border-[#DDD6CA] rounded-xl p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#252B32]">
                              Your Submitted Work
                            </span>
                            <span className="text-[11px] text-[#73777C]">
                              Submitted {activeAssignment.my_submission.submitted_at}
                            </span>
                          </div>
                          {activeAssignment.my_submission.body && (
                            <p className="text-xs text-[#555A60] whitespace-pre-line">
                              {activeAssignment.my_submission.body}
                            </p>
                          )}
                          {activeAssignment.my_submission.original_name && (
                            <button
                              type="button"
                              onClick={() => {
                                const sub = activeAssignment.my_submission;
                                if (!sub) return;
                                downloadFileWithAuth(
                                  `/api/submissions/${sub.id}/download`,
                                  sub.original_name || 'submission.bin'
                                ).catch((err) =>
                                  showToast('error', err instanceof Error ? err.message : 'Download failed')
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EAE4DA] text-[#252B32] text-xs font-medium hover:bg-[#DDD6CA] cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5 text-[#315C83]" />
                              <span>{activeAssignment.my_submission.original_name}</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Submit / Update Form */}
                      {activeAssignment.can_submit ? (
                        <form
                          onSubmit={handleSubmitAssignment}
                          className="space-y-3 pt-2 border-t border-[#EAE4DA]"
                        >
                          <h3 className="text-xs font-semibold text-[#252B32]">
                            {activeAssignment.my_submission
                              ? 'Update Your Submission'
                              : 'Submit Assignment'}
                          </h3>
                          <div>
                            <label className="block text-xs font-medium text-[#555A60] mb-1">
                              Written Submission / Notes
                            </label>
                            <textarea
                              rows={4}
                              value={submissionBody}
                              onChange={(e) => setSubmissionBody(e.target.value)}
                              placeholder="Write your assignment response, solution notes, or summary..."
                              className="w-full px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-[#555A60] mb-1">
                              Attach Submission File (PDF, Document, Code Archive)
                            </label>
                            <input
                              type="file"
                              onChange={handleAssignmentFileChange}
                              className="w-full text-xs text-[#555A60] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-[#EAE4DA] file:text-[#252B32] hover:file:bg-[#DDD6CA]"
                            />
                            {submissionFileName && (
                              <p className="text-[11px] text-[#2F6A4F] mt-1">
                                Selected: {submissionFileName} ({submissionFileSizeKb} KB)
                              </p>
                            )}
                          </div>

                          <div className="pt-1">
                            <button
                              type="submit"
                              disabled={submittingAssignment}
                              className="px-4 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] disabled:opacity-50 transition-colors cursor-pointer"
                            >
                              {submittingAssignment
                                ? 'Submitting...'
                                : activeAssignment.my_submission
                                ? 'Update Submission'
                                : 'Submit Assignment'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="text-xs text-[#73777C] italic pt-2 border-t border-[#EAE4DA]">
                          This assignment has been evaluated and further submission changes are locked.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          5. RESULT (Quizzes/Tests, Timed Attempt Runner, Published Results)
      ===================================================================== */}
      {activeSection === 'student_assessments' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">
                Result
              </h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Attempt course quizzes and assessments, view submission confirmations, and check published results.
              </p>
            </div>
          </div>

          {/* Submission Confirmation Banner */}
          {submissionConfirmation && (
            <div className="bg-[#EBF3EE] border border-[#B7D4C2] rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-[#2F6A4F]">
                  Assessment Submitted — {submissionConfirmation.course_title}
                </p>
                <p className="text-xs text-[#252B32]">
                  {submissionConfirmation.results_published &&
                  submissionConfirmation.published_score !== null
                    ? `Your assessment has been recorded. Published Score: ${submissionConfirmation.published_score}%`
                    : 'Your responses have been saved. Marks and answer review will be visible once your instructor publishes the results.'}
                </p>
              </div>
              <button
                onClick={() => setSubmissionConfirmation(null)}
                className="text-[#2F6A4F] hover:opacity-75 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {data.assessments.length === 0 ? (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-8 text-center">
              <p className="text-xs text-[#73777C]">
                Enroll in a course to access its quizzes and assessments.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {data.assessments.map((asmt) => (
                <div
                  key={asmt.course_id}
                  className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#315C83]">
                        {asmt.course_code}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                          asmt.attempted
                            ? asmt.results_published
                              ? 'bg-[#EBF3EE] text-[#2F6A4F]'
                              : 'bg-[#FBF3E6] text-[#946326]'
                            : 'bg-[#EAE4DA] text-[#555A60]'
                        }`}
                      >
                        {asmt.attempted
                          ? asmt.results_published
                            ? 'Result Published'
                            : 'Submitted · Pending Publication'
                          : 'Available'}
                      </span>
                    </div>

                    <h2 className="text-base font-semibold text-[#252B32]">
                      {asmt.course_title} — Assessment
                    </h2>
                    <p className="text-xs text-[#73777C]">
                      Instructor: {asmt.faculty_name}
                    </p>

                    <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DA]">
                        <span className="text-[11px] text-[#73777C] block">Questions</span>
                        <strong className="text-[#252B32]">{asmt.question_count}</strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DA]">
                        <span className="text-[11px] text-[#73777C] block">Time Limit</span>
                        <strong className="text-[#252B32]">{asmt.duration_minutes} mins</strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DA]">
                        <span className="text-[11px] text-[#73777C] block">Published Result</span>
                        <strong className="text-[#252B32]">
                          {asmt.results_published && asmt.published_score !== null
                            ? `${asmt.published_score}%`
                            : asmt.attempted
                            ? 'Pending'
                            : '—'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#EAE4DA] flex items-center justify-between gap-2">
                    {asmt.attempted && asmt.results_published ? (
                      <button
                        onClick={() => setReviewingAssessment(asmt)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors cursor-pointer"
                      >
                        Review Answers & Feedback
                      </button>
                    ) : (
                      <span className="text-[11px] text-[#73777C]">
                        {asmt.attempted
                          ? 'Answer key hidden until results are published'
                          : `${asmt.total_marks} total marks`}
                      </span>
                    )}

                    <button
                      onClick={() => handleStartAssessment(asmt)}
                      disabled={asmt.question_count === 0}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {asmt.attempted ? 'Retake Assessment' : 'Start Assessment'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          6. MY PROGRESS (Academic Progress Summary, Course Progress, Published Results, Submissions)
      ===================================================================== */}
      {activeSection === 'student_progress' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">My Progress</h1>
            <p className="text-xs text-[#73777C] mt-0.5">
              Comprehensive record of your course completion, published assessment results, and assignment submission history.
            </p>
          </div>

          {/* 4 Academic Progress Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4">
              <p className="text-xs font-medium text-[#73777C]">Total Enrolled Courses</p>
              <p className="text-2xl font-semibold text-[#252B32] mt-1">
                {data.stats.enrolled_courses}
              </p>
            </div>
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4">
              <p className="text-xs font-medium text-[#73777C]">Completed Courses</p>
              <p className="text-2xl font-semibold text-[#252B32] mt-1">
                {data.stats.completed_courses}
              </p>
            </div>
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4">
              <p className="text-xs font-medium text-[#73777C]">Ongoing Courses</p>
              <p className="text-2xl font-semibold text-[#252B32] mt-1">{ongoingCoursesCount}</p>
            </div>
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4">
              <p className="text-xs font-medium text-[#73777C]">Completed Lessons</p>
              <p className="text-2xl font-semibold text-[#252B32] mt-1">
                {totalCompletedLessons}
              </p>
            </div>
          </div>

          {/* Course-wise Progress Percentages */}
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[#252B32] mb-4">
              Course-wise Progress
            </h2>
            {data.enrolled_courses.length === 0 ? (
              <p className="text-xs text-[#73777C] py-6 text-center">
                No enrolled courses to track.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                      <th className="py-2 pr-4">Course</th>
                      <th className="py-2 px-4">Instructor</th>
                      <th className="py-2 px-4">Completed Lessons</th>
                      <th className="py-2 px-4">Progress</th>
                      <th className="py-2 pl-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA] text-xs">
                    {data.enrolled_courses.map((course) => (
                      <tr key={course.id}>
                        <td className="py-3 pr-4">
                          <span className="font-semibold text-[#315C83]">{course.code}</span>
                          <p className="font-medium text-[#252B32]">{course.title}</p>
                        </td>
                        <td className="py-3 px-4 text-[#555A60]">{course.faculty_name}</td>
                        <td className="py-3 px-4 text-[#555A60]">
                          {course.completed_material_count} / {course.material_count}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-28 h-1.5 bg-[#EAE4DA] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#315C83]"
                                style={{ width: `${course.progress_percent}%` }}
                              />
                            </div>
                            <span className="font-medium text-[#252B32]">
                              {course.progress_percent}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 pl-4 text-right">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                              course.material_count > 0 &&
                              course.completed_material_count >= course.material_count
                                ? 'bg-[#EBF3EE] text-[#2F6A4F]'
                                : 'bg-[#EAE4DA] text-[#555A60]'
                            }`}
                          >
                            {course.material_count > 0 &&
                            course.completed_material_count >= course.material_count
                              ? 'Completed'
                              : 'Ongoing'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Published Assessment Performance & Assignment Submission History */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Published Assessment Performance */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-[#252B32] mb-4">
                Published Assessment Performance
              </h2>
              {data.assessments.length === 0 ? (
                <p className="text-xs text-[#73777C] py-6 text-center">
                  No assessments available.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                        <th className="py-2 pr-3">Course</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 pl-3 text-right">Published Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4DA] text-xs">
                      {data.assessments.map((asmt) => (
                        <tr key={asmt.course_id}>
                          <td className="py-2.5 pr-3">
                            <span className="font-semibold text-[#315C83]">
                              {asmt.course_code}
                            </span>
                            <p className="font-medium text-[#252B32]">{asmt.course_title}</p>
                          </td>
                          <td className="py-2.5 px-3 text-[#555A60]">
                            {asmt.attempted
                              ? asmt.results_published
                                ? 'Published'
                                : 'Awaiting Publication'
                              : 'Not Attempted'}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-semibold text-[#252B32]">
                            {asmt.results_published && asmt.published_score !== null
                              ? `${asmt.published_score}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Assignment Submission History */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-[#252B32] mb-4">
                Assignment Submission History
              </h2>
              {data.assignments.length === 0 ? (
                <p className="text-xs text-[#73777C] py-6 text-center">
                  No assignments recorded.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                        <th className="py-2 pr-3">Assignment</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 pl-3 text-right">Marks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4DA] text-xs">
                      {data.assignments.map((asgn) => (
                        <tr key={asgn.id}>
                          <td className="py-2.5 pr-3">
                            <span className="font-semibold text-[#315C83]">
                              {asgn.course_code}
                            </span>
                            <p className="font-medium text-[#252B32]">{asgn.title}</p>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-medium ${getStatusBadgeStyle(
                                asgn.status_label
                              )}`}
                            >
                              {asgn.status_label}
                            </span>
                          </td>
                          <td className="py-2.5 pl-3 text-right font-semibold text-[#252B32]">
                            {asgn.my_submission?.grade !== null &&
                            asgn.my_submission?.grade !== undefined
                              ? `${asgn.my_submission.grade}/${asgn.max_score}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          7. PROFILE (Read-Only Personal Details, Change Login Password Only, Sign Out)
      ===================================================================== */}
      {activeSection === 'student_settings' && (
        <div className="space-y-6 max-w-4xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">
                Profile
              </h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                View your student profile details and update your login password.
              </p>
            </div>
            <button
              onClick={onSignOut}
              className="px-3.5 py-2 rounded-lg text-xs font-medium border border-[#DEB8B8] bg-[#F9EBEB] text-[#993B3B] hover:bg-[#F3DCDC] transition-colors flex items-center gap-1.5 self-start cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Read-Only Personal Details Card */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#252B32]">Student Profile</h2>
                  <p className="text-[11px] text-[#73777C]">Username: @{data.student.username}</p>
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#EAE4DA] text-[#315C83]">
                  Role: Student (Read-only)
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#73777C] mb-1">
                  Full Name (Read-only)
                </label>
                <div className="w-full px-3 py-2 text-xs bg-[#EAE4DA]/60 border border-[#DDD6CA] rounded-lg text-[#252B32] font-medium select-text">
                  {data.student.full_name}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#73777C] mb-1">
                  Registered Email (Read-only)
                </label>
                <div className="w-full px-3 py-2 text-xs bg-[#EAE4DA]/60 border border-[#DDD6CA] rounded-lg text-[#252B32] select-text">
                  {data.student.email}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#73777C] mb-1">
                  Personal Bio & Study Interests (Read-only)
                </label>
                <div className="w-full px-3 py-2 text-xs bg-[#EAE4DA]/60 border border-[#DDD6CA] rounded-lg text-[#555A60] min-h-[64px]">
                  {data.student.bio || 'Enrolled Student'}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#73777C] mb-1">
                  Database & Auth Provider
                </label>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#EAE4DA]/50 border border-[#DDD6CA] text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#54866A]" />
                    <span className="font-medium text-[#252B32]">
                      {auth.currentUser ? 'Google Account (Firebase Auth)' : 'SmartLearn Identity'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[#315C83] bg-white px-2 py-0.5 rounded border border-[#DDD6CA]">
                    Firestore Synced
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-[#73777C] pt-1">
                Profile identity details are managed by the platform administrator and cannot be modified. You can update your login password using the form on the right.
              </p>
            </div>

            {/* Change Password Form */}
            <form
              onSubmit={handleChangePassword}
              className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 space-y-4 self-start"
            >
              <div className="border-b border-[#EAE4DA] pb-3">
                <h2 className="text-sm font-semibold text-[#252B32] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[#315C83]" />
                  Change Password
                </h2>
                <p className="text-[11px] text-[#73777C]">
                  Update your password securely.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordForm.new_password}
                  onChange={(e) =>
                    setPasswordForm({ ...passwordForm, new_password: e.target.value })
                  }
                  placeholder="At least 6 characters"
                  className="w-full px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordForm.confirm_password}
                  onChange={(e) =>
                    setPasswordForm({ ...passwordForm, confirm_password: e.target.value })
                  }
                  placeholder="Re-enter new password"
                  className="w-full px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODALS
      ===================================================================== */}

      {/* Course Details Modal (in Explore Courses) */}
      {inspectingCatalogCourse && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-start justify-between border-b border-[#EAE4DA] pb-3">
              <div>
                <span className="text-xs font-semibold text-[#315C83]">
                  {inspectingCatalogCourse.code} · {inspectingCatalogCourse.category}
                </span>
                <h3 className="text-base font-semibold text-[#252B32] mt-0.5">
                  {inspectingCatalogCourse.title}
                </h3>
              </div>
              <button
                onClick={() => setInspectingCatalogCourse(null)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-[#555A60] leading-relaxed">
                {inspectingCatalogCourse.description}
              </p>

              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-white border border-[#EAE4DA]">
                <div>
                  <span className="text-[11px] text-[#73777C] block">Instructor</span>
                  <strong className="text-[#252B32]">{inspectingCatalogCourse.faculty_name}</strong>
                </div>
                <div>
                  <span className="text-[11px] text-[#73777C] block">Level & Duration</span>
                  <strong className="text-[#252B32]">
                    {inspectingCatalogCourse.level} · {inspectingCatalogCourse.estimated_hours}h
                  </strong>
                </div>
                <div>
                  <span className="text-[11px] text-[#73777C] block">Published Lessons</span>
                  <strong className="text-[#252B32]">
                    {inspectingCatalogCourse.published_lessons_count} lessons
                  </strong>
                </div>
                <div>
                  <span className="text-[11px] text-[#73777C] block">Learning Resources</span>
                  <strong className="text-[#252B32]">
                    {inspectingCatalogCourse.downloadable_resources_count} files ·{' '}
                    {inspectingCatalogCourse.video_resources_count} videos
                  </strong>
                </div>
              </div>

              {inspectingCatalogCourse.sample_modules.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-[#73777C] uppercase mb-1.5">
                    Included Course Modules
                  </p>
                  <ul className="space-y-1 text-[#252B32]">
                    {inspectingCatalogCourse.sample_modules.map((mod, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#315C83]" />
                        <span>{mod}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
              <button
                onClick={() => setInspectingCatalogCourse(null)}
                className="px-3 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer"
              >
                Close
              </button>
              {inspectingCatalogCourse.enrolled ? (
                <button
                  onClick={() => {
                    const cId = inspectingCatalogCourse.id;
                    setInspectingCatalogCourse(null);
                    setLearningCourseId(cId);
                    onNavigateSection('student_learning');
                  }}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white cursor-pointer"
                >
                  Go to My Learning
                </button>
              ) : (
                <button
                  onClick={() => handleEnrollCourse(inspectingCatalogCourse.id)}
                  disabled={enrollingCourseId === inspectingCatalogCourse.id}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] cursor-pointer"
                >
                  {enrollingCourseId === inspectingCatalogCourse.id
                    ? 'Enrolling...'
                    : 'Enroll in Course'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Timed Assessment Attempt Modal */}
      {assessmentRunnerOpen && activeAssessmentForRunner && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-2xl w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <div>
                <span className="text-xs font-semibold text-[#315C83]">
                  {activeAssessmentForRunner.course_code} Assessment
                </span>
                <h3 className="text-base font-semibold text-[#252B32]">
                  {activeAssessmentForRunner.course_title}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-lg bg-[#EAE4DA] text-xs font-semibold text-[#252B32] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#315C83]" />
                  <span>{formatTimer(remainingSeconds)}</span>
                </div>
                <button
                  onClick={() => setAssessmentRunnerOpen(false)}
                  className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Question Navigation Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {activeAssessmentForRunner.questions.map((q, idx) => {
                const answered =
                  assessmentAnswers[q.id] !== undefined &&
                  String(assessmentAnswers[q.id]).trim() !== '';
                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentQuestionIndex(idx)}
                    className={`w-7 h-7 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      currentQuestionIndex === idx
                        ? 'bg-[#315C83] text-white border-[#315C83]'
                        : answered
                        ? 'bg-[#EBF3EE] text-[#2F6A4F] border-[#B7D4C2]'
                        : 'bg-white text-[#555A60] border-[#DDD6CA]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Current Question Body */}
            {(() => {
              const q = activeAssessmentForRunner.questions[currentQuestionIndex];
              if (!q) return null;

              return (
                <div className="bg-white border border-[#DDD6CA] rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between text-xs text-[#73777C]">
                    <span>
                      Question {currentQuestionIndex + 1} of{' '}
                      {activeAssessmentForRunner.questions.length}
                    </span>
                    <span>
                      {q.question_type === 'subjective' ? 'Subjective Response' : 'Multiple Choice'}{' '}
                      · {q.marks} marks
                    </span>
                  </div>

                  <p className="text-sm font-medium text-[#252B32]">{q.question}</p>

                  {q.question_type === 'subjective' ? (
                    <textarea
                      rows={4}
                      value={String(assessmentAnswers[q.id] || '')}
                      onChange={(e) =>
                        setAssessmentAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      placeholder="Type your detailed answer here..."
                      className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
                    />
                  ) : (
                    <div className="space-y-2">
                      {q.options.map((opt, oIdx) => {
                        const isSelected = assessmentAnswers[q.id] === oIdx;
                        return (
                          <label
                            key={oIdx}
                            className={`flex items-center gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#EAE4DA] border-[#315C83] font-medium text-[#252B32]'
                                : 'bg-[#FAF8F5] border-[#EAE4DA] text-[#555A60] hover:bg-[#F3EFEA]'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`q-${q.id}`}
                              checked={isSelected}
                              onChange={() =>
                                setAssessmentAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: oIdx,
                                }))
                              }
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Navigation & Submit Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-[#EAE4DA]">
              <button
                type="button"
                disabled={currentQuestionIndex === 0}
                onClick={() => setCurrentQuestionIndex((i) => Math.max(0, i - 1))}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] disabled:opacity-40 cursor-pointer"
              >
                Previous
              </button>

              <div className="flex items-center gap-2">
                {currentQuestionIndex < activeAssessmentForRunner.questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentQuestionIndex((i) =>
                        Math.min(activeAssessmentForRunner.questions.length - 1, i + 1)
                      )
                    }
                    className="px-3.5 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] bg-white text-[#252B32] hover:bg-[#EAE4DA] cursor-pointer"
                  >
                    Next Question
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={handleSubmitAssessment}
                  disabled={submittingAssessment}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] disabled:opacity-50 cursor-pointer"
                >
                  {submittingAssessment ? 'Submitting...' : 'Submit Assessment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Published Assessment Results Review Modal */}
      {reviewingAssessment && reviewingAssessment.results_published && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-lg my-8">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <div>
                <span className="text-xs font-semibold text-[#315C83]">
                  {reviewingAssessment.course_code} · Published Assessment Review
                </span>
                <h3 className="text-base font-semibold text-[#252B32]">
                  {reviewingAssessment.course_title} — Score: {reviewingAssessment.published_score}%
                </h3>
              </div>
              <button
                onClick={() => setReviewingAssessment(null)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              {reviewingAssessment.questions.map((q, idx) => {
                const studentAns = reviewingAssessment.saved_answers?.[q.id];
                return (
                  <div
                    key={q.id}
                    className="p-3.5 rounded-xl bg-white border border-[#EAE4DA] space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between text-[#73777C]">
                      <span className="font-semibold text-[#252B32]">Question {idx + 1}</span>
                      <span>{q.marks} marks</span>
                    </div>
                    <p className="font-medium text-[#252B32]">{q.question}</p>

                    {q.question_type !== 'subjective' && q.options.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {q.options.map((opt, oIdx) => {
                          const isCorrect = q.correct_index === oIdx;
                          const isChosen = studentAns === oIdx;
                          return (
                            <div
                              key={oIdx}
                              className={`px-2.5 py-1.5 rounded border text-[11px] flex items-center justify-between ${
                                isCorrect
                                  ? 'bg-[#EBF3EE] border-[#B7D4C2] text-[#2F6A4F] font-medium'
                                  : isChosen
                                  ? 'bg-[#F9EBEB] border-[#DEB8B8] text-[#993B3B]'
                                  : 'bg-[#FAF8F5] border-[#EAE4DA] text-[#555A60]'
                              }`}
                            >
                              <span>{opt}</span>
                              {isCorrect && <span>Correct Answer</span>}
                              {!isCorrect && isChosen && <span>Your Answer</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {q.question_type === 'subjective' && (
                      <div className="p-2 rounded bg-[#FAF8F5] border border-[#EAE4DA] text-[11px] text-[#555A60]">
                        <strong>Your Response:</strong>{' '}
                        {studentAns !== undefined ? String(studentAns) : 'No response recorded'}
                      </div>
                    )}

                    {q.explanation && (
                      <p className="text-[11px] text-[#2F6A4F] pt-1">
                        <strong>Explanation / Rubric:</strong> {q.explanation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-3 border-t border-[#EAE4DA]">
              <button
                onClick={() => setReviewingAssessment(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white cursor-pointer"
              >
                Close Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

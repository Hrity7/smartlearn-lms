import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen,
  Users,
  ClipboardCheck,
  Calendar,
  Plus,
  Search,
  Edit3,
  Trash2,
  Eye,
  CheckCircle2,
  FileText,
  Download,
  Settings,
  X,
  RefreshCw,
  AlertCircle,
  Lock,
  ExternalLink,
  Video,
  LogOut,
  Sparkles,
} from 'lucide-react';
import {
  TeacherOverviewPayload,
  TeacherCourseDetail,
  TeacherStudentRecord,
  TeacherAssignmentRecord,
  Material,
  Submission,
} from '../types/lms';
import { downloadFileWithAuth, getSessionToken, apiFetch } from '../utils/api';

export type TeacherSection =
  | 'teacher_dashboard'
  | 'teacher_courses'
  | 'teacher_students'
  | 'teacher_assignments'
  | 'teacher_assessments'
  | 'teacher_schedule'
  | 'teacher_settings';

interface TeacherDashboardViewProps {
  activeUserId: number;
  sessionToken?: string | null;
  activeSection: TeacherSection;
  onNavigateSection: (section: TeacherSection) => void;
  onOpenCourseWorkspace: (courseId: number) => void;
  onRefreshGlobalData: () => void;
  onSignOut: () => void;
}

export const TeacherDashboardView: React.FC<TeacherDashboardViewProps> = ({
  activeUserId,
  sessionToken,
  activeSection,
  onNavigateSection,
  onOpenCourseWorkspace,
  onRefreshGlobalData,
  onSignOut,
}) => {
  const [data, setData] = useState<TeacherOverviewPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Course management state
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<TeacherCourseDetail | null>(null);
  const [courseForm, setCourseForm] = useState({
    title: '',
    code: '',
    category: '',
    level: '',
    estimated_hours: 14,
    description: '',
    published: true,
    results_published: true,
  });

  // Lesson / Material modal state
  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Material | null>(null);
  const [lessonForm, setLessonForm] = useState<{
    module_title: string;
    lesson_number: number;
    title: string;
    duration_minutes: number;
    body: string;
    video_url: string;
    file_name: string;
    file_size_kb: number;
    selectedFile: File | null;
    published: boolean;
  }>({
    module_title: '',
    lesson_number: 1,
    title: '',
    duration_minutes: 30,
    body: '',
    video_url: '',
    file_name: '',
    file_size_kb: 0,
    selectedFile: null,
    published: true,
  });

  // Students section state
  const [studentSearch, setStudentSearch] = useState('');
  const [studentCourseFilter, setStudentCourseFilter] = useState<string>('ALL');
  const [inspectingStudent, setInspectingStudent] = useState<TeacherStudentRecord | null>(null);

  // Assignments section state
  const [assignmentCourseFilter, setAssignmentCourseFilter] = useState<string>('ALL');
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<TeacherAssignmentRecord | null>(null);
  const [assignmentForm, setAssignmentForm] = useState({
    course_id: 0,
    title: '',
    due_at: '',
    max_score: 100,
    description: '',
    reference_link: '',
  });
  const [activeSubmissionsAssignmentId, setActiveSubmissionsAssignmentId] = useState<number | null>(null);
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState<'ALL' | 'PENDING' | 'EVALUATED'>('ALL');
  const [gradingSubmission, setGradingSubmission] = useState<Submission | null>(null);
  const [gradeForm, setGradeForm] = useState({
    grade: '',
    feedback: '',
  });

  // Assessments & Grades section state
  const [assessmentCourseId, setAssessmentCourseId] = useState<number | null>(null);
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [questionForm, setQuestionForm] = useState({
    question_type: 'mcq' as 'mcq' | 'subjective',
    marks: 10,
    question: '',
    options: ['', '', '', ''],
    correct_index: 0,
    explanation: '',
  });
  const [studentMarkInputs, setStudentMarkInputs] = useState<Record<number, string>>({});
  const [savingStudentMarkId, setSavingStudentMarkId] = useState<number | null>(null);

  // Gemini AI Quiz Generator state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiSelectedLessons, setAiSelectedLessons] = useState<number[]>([]);
  const [aiTopic, setAiTopic] = useState('');
  const [aiCount, setAiCount] = useState(3);
  const [aiDifficulty, setAiDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [aiMcqRatio, setAiMcqRatio] = useState(0.8);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDrafts, setAiDrafts] = useState<
    Array<{
      id: string;
      question: string;
      question_type: 'mcq' | 'subjective';
      marks: number;
      options: string[];
      correct_index: number;
      explanation: string;
      selected: boolean;
    }>
  >([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAdding, setAiAdding] = useState(false);


  // Schedule section state
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    course_code: '',
    date: 'Monday',
    time: '10:00 AM',
    duration_label: '60 min',
    type: 'lecture' as 'lecture' | 'deadline' | 'study' | 'workshop',
    location: 'Room 204',
  });

  // Settings & Profile state
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    email: '',
    bio: '',
    weekly_goal_hours: 12,
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

  const fetchTeacherData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/teacher/overview', {
        headers: getHeaders(false),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to load teacher dashboard' }));
        throw new Error(err.error || 'Failed to load teacher dashboard');
      }
      const payload: TeacherOverviewPayload = await res.json();
      setData(payload);

      if (payload.courses.length > 0) {
        setSelectedCourseId((prev) =>
          prev && payload.courses.some((c) => c.id === prev) ? prev : payload.courses[0].id
        );
        setAssessmentCourseId((prev) =>
          prev && payload.courses.some((c) => c.id === prev) ? prev : payload.courses[0].id
        );
      } else {
        setSelectedCourseId(null);
        setAssessmentCourseId(null);
      }

      setProfileForm({
        full_name: payload.teacher.full_name || '',
        email: payload.teacher.email || '',
        bio: payload.teacher.bio || '',
        weekly_goal_hours: payload.teacher.weekly_goal_hours ?? 12,
        notifications_enabled: payload.teacher.notifications_enabled ?? true,
      });
    } catch (e: any) {
      setError(e.message || 'Could not load teacher data');
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => {
    fetchTeacherData();
  }, [fetchTeacherData]);

  useEffect(() => {
    fetch('/api/ai/status', { headers: getHeaders(false) })
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((d) => setAiEnabled(Boolean(d?.enabled)))
      .catch(() => setAiEnabled(false));
  }, [getHeaders]);


  const activeCourse = useMemo(() => {
    if (!data || !selectedCourseId) return null;
    return data.courses.find((c) => c.id === selectedCourseId) || data.courses[0] || null;
  }, [data, selectedCourseId]);

  const activeAssessmentCourse = useMemo(() => {
    if (!data || !assessmentCourseId) return null;
    return data.courses.find((c) => c.id === assessmentCourseId) || data.courses[0] || null;
  }, [data, assessmentCourseId]);

  useEffect(() => {
    if (activeAssessmentCourse) {
      const nextMarks: Record<number, string> = {};
      activeAssessmentCourse.enrolled_students.forEach((stu) => {
        nextMarks[stu.student_id] =
          stu.assessment_score !== null && stu.assessment_score !== undefined
            ? String(stu.assessment_score)
            : '';
      });
      setStudentMarkInputs(nextMarks);
    }
  }, [activeAssessmentCourse]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    if (!data) return [];
    return data.students.filter((stu) => {
      const q = studentSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        stu.full_name.toLowerCase().includes(q) ||
        stu.email.toLowerCase().includes(q) ||
        stu.username.toLowerCase().includes(q);
      const matchesCourse =
        studentCourseFilter === 'ALL' ||
        stu.courses.some((c) => String(c.course_id) === studentCourseFilter);
      return matchesSearch && matchesCourse;
    });
  }, [data, studentSearch, studentCourseFilter]);

  // Filtered assignments
  const filteredAssignments = useMemo(() => {
    if (!data) return [];
    return data.assignments.filter((asgn) => {
      if (assignmentCourseFilter === 'ALL') return true;
      return String(asgn.course_id) === assignmentCourseFilter;
    });
  }, [data, assignmentCourseFilter]);

  const activeAssignmentForSubmissions = useMemo(() => {
    if (!data) return null;
    if (activeSubmissionsAssignmentId) {
      const found = data.assignments.find((a) => a.id === activeSubmissionsAssignmentId);
      if (found) return found;
    }
    return filteredAssignments[0] || null;
  }, [data, activeSubmissionsAssignmentId, filteredAssignments]);

  // Handlers for Course Edit / Publish
  const openEditCourseModal = (course: TeacherCourseDetail) => {
    setEditingCourse(course);
    setCourseForm({
      title: course.title,
      code: course.code,
      category: course.category,
      level: course.level || 'Intermediate',
      estimated_hours: course.estimated_hours || 14,
      description: course.description,
      published: course.published !== false,
      results_published: course.results_published !== false,
    });
    setCourseModalOpen(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourse) return;
    try {
      const res = await fetch(`/api/teacher/courses/${editingCourse.id}`, {
        method: 'PUT',
        headers: getHeaders(true),
        body: JSON.stringify(courseForm),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update course');
      showToast('success', 'Course settings updated.');
      setCourseModalOpen(false);
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleToggleCoursePublished = async (course: TeacherCourseDetail) => {
    try {
      const res = await fetch(`/api/teacher/courses/${course.id}`, {
        method: 'PUT',
        headers: getHeaders(true),
        body: JSON.stringify({ published: course.published === false }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update status');
      showToast(
        'success',
        `Course "${course.title}" is now ${course.published === false ? 'Published' : 'Unpublished'}.`
      );
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  // Handlers for Lessons / Materials
  const openCreateLessonModal = (course: TeacherCourseDetail) => {
    setEditingLesson(null);
    const nextNum = (course.materials?.length || 0) + 1;
    setLessonForm({
      module_title: `Module ${Math.ceil(nextNum / 2)}: Core Concepts`,
      lesson_number: nextNum,
      title: '',
      duration_minutes: 30,
      body: '',
      video_url: '',
      file_name: '',
      file_size_kb: 0,
      selectedFile: null,
      published: true,
    });
    setLessonModalOpen(true);
  };

  const openEditLessonModal = (lesson: Material) => {
    setEditingLesson(lesson);
    setLessonForm({
      module_title: lesson.module_title || 'Module 1',
      lesson_number: lesson.lesson_number || 1,
      title: lesson.title || '',
      duration_minutes: lesson.duration_minutes || 30,
      body: lesson.body || '',
      video_url: lesson.video_url || '',
      file_name: lesson.original_name || '',
      file_size_kb: lesson.file_size ? Math.max(1, Math.round(lesson.file_size / 1024)) : 0,
      selectedFile: null,
      published: lesson.published !== false,
    });
    setLessonModalOpen(true);
  };

  const handleLessonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLessonForm((prev) => ({
      ...prev,
      file_name: file.name,
      file_size_kb: Math.max(1, Math.round(file.size / 1024)),
      selectedFile: file,
    }));
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourse) return;
    try {
      const url = editingLesson
        ? `/api/teacher/materials/${editingLesson.id}`
        : `/api/teacher/courses/${activeCourse.id}/materials`;
      const method = editingLesson ? 'PUT' : 'POST';
      const formData = new FormData();
      formData.append('module_title', lessonForm.module_title);
      formData.append('lesson_number', String(lessonForm.lesson_number));
      formData.append('title', lessonForm.title);
      formData.append('duration_minutes', String(lessonForm.duration_minutes));
      formData.append('body', lessonForm.body);
      formData.append('video_url', lessonForm.video_url || '');
      formData.append('published', String(lessonForm.published));
      if (lessonForm.selectedFile) {
        formData.append('file', lessonForm.selectedFile);
      }
      const res = await apiFetch(url, {
        method,
        body: formData,
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to save lesson');
      showToast('success', editingLesson ? 'Lesson updated.' : 'Lesson added to course.');
      setLessonModalOpen(false);
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleToggleLessonPublish = async (lesson: Material) => {
    try {
      const res = await fetch(`/api/teacher/materials/${lesson.id}`, {
        method: 'PUT',
        headers: getHeaders(true),
        body: JSON.stringify({ published: lesson.published === false }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update lesson status');
      showToast(
        'success',
        `Lesson "${lesson.title}" ${lesson.published === false ? 'published' : 'unpublished'}.`
      );
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteLesson = async (lessonId: number) => {
    try {
      const res = await fetch(`/api/teacher/materials/${lessonId}`, {
        method: 'DELETE',
        headers: getHeaders(false),
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        throw new Error(out.error || 'Failed to delete lesson');
      }
      showToast('success', 'Lesson removed.');
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  // Handlers for Assignments & Submissions
  const openCreateAssignmentModal = () => {
    const defaultCourseId =
      assignmentCourseFilter !== 'ALL'
        ? Number(assignmentCourseFilter)
        : data?.courses[0]?.id || 0;
    setEditingAssignment(null);
    setAssignmentForm({
      course_id: defaultCourseId,
      title: '',
      due_at: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      max_score: 100,
      description: '',
      reference_link: '',
    });
    setAssignmentModalOpen(true);
  };

  const openEditAssignmentModal = (asgn: TeacherAssignmentRecord) => {
    setEditingAssignment(asgn);
    setAssignmentForm({
      course_id: asgn.course_id,
      title: asgn.title,
      due_at: asgn.due_at ? asgn.due_at.slice(0, 10) : '',
      max_score: asgn.max_score,
      description: asgn.description,
      reference_link: asgn.reference_link || '',
    });
    setAssignmentModalOpen(true);
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingAssignment
        ? `/api/teacher/assignments/${editingAssignment.id}`
        : '/api/teacher/assignments';
      const method = editingAssignment ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: getHeaders(true),
        body: JSON.stringify(assignmentForm),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to save assignment');
      showToast('success', editingAssignment ? 'Assignment updated.' : 'Assignment created.');
      setAssignmentModalOpen(false);
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteAssignment = async (assignmentId: number) => {
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}`, {
        method: 'DELETE',
        headers: getHeaders(false),
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        throw new Error(out.error || 'Failed to delete assignment');
      }
      showToast('success', 'Assignment deleted.');
      if (activeSubmissionsAssignmentId === assignmentId) {
        setActiveSubmissionsAssignmentId(null);
      }
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const openGradeModal = (sub: Submission) => {
    setGradingSubmission(sub);
    setGradeForm({
      grade: sub.grade !== null && sub.grade !== undefined ? String(sub.grade) : '',
      feedback: sub.feedback || '',
    });
  };

  const handleSaveSubmissionGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gradingSubmission) return;
    try {
      const res = await fetch(`/api/teacher/submissions/${gradingSubmission.id}/grade`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          grade: Number(gradeForm.grade),
          feedback: gradeForm.feedback,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to save evaluation');
      showToast('success', `Evaluated submission for ${gradingSubmission.student_name}.`);
      setGradingSubmission(null);
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  // Handlers for Assessments & Grades
  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAssessmentCourse) return;
    try {
      const res = await fetch(`/api/teacher/courses/${activeAssessmentCourse.id}/questions`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(questionForm),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to create question');
      showToast('success', 'Assessment question added.');
      setQuestionModalOpen(false);
      setQuestionForm({
        question_type: 'mcq',
        marks: 10,
        question: '',
        options: ['', '', '', ''],
        correct_index: 0,
        explanation: '',
      });
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!activeAssessmentCourse) return;
    try {
      const res = await fetch(
        `/api/teacher/courses/${activeAssessmentCourse.id}/questions/${encodeURIComponent(questionId)}`,
        {
          method: 'DELETE',
          headers: getHeaders(false),
        }
      );
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        throw new Error(out.error || 'Failed to remove question');
      }
      showToast('success', 'Question deleted.');
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleOpenAiModal = () => {
    if (!activeAssessmentCourse) return;
    const publishedMaterials = activeAssessmentCourse.materials.filter((m) => m.published !== false);
    setAiSelectedLessons(publishedMaterials.map((m) => m.id));
    setAiTopic('');
    setAiCount(3);
    setAiDifficulty('medium');
    setAiMcqRatio(0.8);
    setAiDrafts([]);
    setAiError(null);
    setAiModalOpen(true);
  };

  const handleGenerateAiQuestions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAssessmentCourse) return;
    setAiGenerating(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/teacher/courses/${activeAssessmentCourse.id}/ai/generate-questions`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          material_ids: aiSelectedLessons.length > 0 ? aiSelectedLessons : undefined,
          topic: aiTopic.trim() || undefined,
          count: aiCount,
          difficulty: aiDifficulty,
          mcq_ratio: aiMcqRatio,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate questions with AI.');
      }
      const rawDrafts = (data.drafts || []) as any[];
      if (rawDrafts.length === 0) {
        throw new Error('No new non-duplicate questions could be generated from this lesson content.');
      }
      setAiDrafts(
        rawDrafts.map((d) => ({
          ...d,
          selected: true,
        }))
      );
    } catch (err: any) {
      setAiError(err.message || 'Error communicating with AI service.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAddSelectedAiQuestions = async () => {
    if (!activeAssessmentCourse) return;
    const toAdd = aiDrafts.filter((d) => d.selected);
    if (toAdd.length === 0) {
      showToast('error', 'Please select at least one question to add.');
      return;
    }
    setAiAdding(true);
    try {
      let addedCount = 0;
      for (const draft of toAdd) {
        const payload = {
          question: draft.question,
          question_type: draft.question_type,
          marks: draft.marks,
          options: draft.options,
          correct_index: draft.correct_index,
          explanation: draft.explanation,
        };
        const res = await fetch(`/api/teacher/courses/${activeAssessmentCourse.id}/questions`, {
          method: 'POST',
          headers: getHeaders(true),
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          addedCount += 1;
        }
      }
      showToast('success', `Added ${addedCount} AI-generated question(s) to assessment.`);
      setAiModalOpen(false);
      setAiDrafts([]);
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to add questions.');
    } finally {
      setAiAdding(false);
    }
  };

  const handleSaveStudentAssessmentMark = async (studentId: number) => {
    if (!activeAssessmentCourse) return;
    const rawVal = studentMarkInputs[studentId];
    if (rawVal === undefined || rawVal.trim() === '') {
      showToast('error', 'Please enter a valid mark between 0 and 100.');
      return;
    }
    setSavingStudentMarkId(studentId);
    try {
      const res = await fetch(`/api/teacher/courses/${activeAssessmentCourse.id}/grades`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          student_id: studentId,
          score: Number(rawVal),
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update mark');
      showToast('success', 'Student assessment score saved.');
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSavingStudentMarkId(null);
    }
  };

  const handleToggleResultsPublished = async (course: TeacherCourseDetail) => {
    try {
      const res = await fetch(`/api/teacher/courses/${course.id}`, {
        method: 'PUT',
        headers: getHeaders(true),
        body: JSON.stringify({ results_published: course.results_published === false }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update result visibility');
      showToast(
        'success',
        `Assessment results ${course.results_published === false ? 'published' : 'hidden'}.`
      );
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  // Handlers for Schedule
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/teacher/schedule', {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(scheduleForm),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to add schedule entry');
      showToast('success', 'Class session added to schedule.');
      setScheduleModalOpen(false);
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    try {
      const res = await fetch(`/api/teacher/schedule/${scheduleId}`, {
        method: 'DELETE',
        headers: getHeaders(false),
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        throw new Error(out.error || 'Failed to remove schedule session');
      }
      showToast('success', 'Schedule entry removed.');
      await fetchTeacherData();
      onRefreshGlobalData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  // Handlers for Teacher Profile & Password
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/teacher/profile', {
        method: 'PUT',
        headers: getHeaders(true),
        body: JSON.stringify(profileForm),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update profile');
      showToast('success', 'Profile settings updated.');
      await fetchTeacherData();
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
      const res = await fetch('/api/teacher/password', {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          new_password: passwordForm.new_password,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed to update password');
      showToast('success', 'Password changed successfully.');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[420px]">
        <div className="flex items-center gap-3 text-sm text-[#73777C]">
          <RefreshCw className="w-4 h-4 animate-spin text-[#315C83]" />
          <span>Loading teacher workspace...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6 max-w-lg mx-auto text-center space-y-3">
          <AlertCircle className="w-6 h-6 text-[#993B3B] mx-auto" />
          <h3 className="text-base font-semibold text-[#252B32]">Unable to load Teacher Workspace</h3>
          <p className="text-xs text-[#73777C]">{error || 'No data returned from server.'}</p>
          <button
            onClick={fetchTeacherData}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const pendingAssignments = data.assignments.filter((a) => a.pending_count > 0);

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
          <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =====================================================================
          1. TEACHER DASHBOARD OVERVIEW
      ===================================================================== */}
      {activeSection === 'teacher_dashboard' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">
                Teacher Dashboard
              </h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Welcome back, {data.teacher.full_name}. Overview of your assigned courses and pending evaluations.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onNavigateSection('teacher_courses')}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Manage Courses
              </button>
            </div>
          </div>

          {/* 4 Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">My Courses</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.my_courses}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#315C83]">
                <BookOpen className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">Total Students</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.total_students}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#2F6A4F]">
                <Users className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">Pending Evaluations</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.pending_evaluations}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#946326]">
                <ClipboardCheck className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#73777C]">Upcoming Classes</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1">
                  {data.stats.upcoming_classes}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-[#EAE4DA] flex items-center justify-center text-[#315C83]">
                <Calendar className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Below Summary Cards: My Courses, Pending Tasks, Upcoming Schedule */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* My Courses */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[#252B32]">My Courses</h2>
                  <button
                    onClick={() => onNavigateSection('teacher_courses')}
                    className="text-xs font-medium text-[#315C83] hover:underline cursor-pointer"
                  >
                    View all
                  </button>
                </div>

                {data.courses.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-6 text-center">
                    No courses currently assigned to your account.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA]">
                    {data.courses.slice(0, 5).map((course) => (
                      <div
                        key={course.id}
                        className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#315C83]">
                              {course.code}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                course.published !== false
                                  ? 'bg-[#EBF3EE] text-[#2F6A4F]'
                                  : 'bg-[#EAE4DA] text-[#73777C]'
                              }`}
                            >
                              {course.published !== false ? 'Published' : 'Draft'}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-[#252B32] truncate mt-0.5">
                            {course.title}
                          </p>
                          <p className="text-[11px] text-[#73777C]">
                            {course.student_count} students · {course.material_count} lessons
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedCourseId(course.id);
                            onNavigateSection('teacher_courses');
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors shrink-0 cursor-pointer"
                        >
                          Manage
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Pending Tasks (Assignments Awaiting Evaluation) */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[#252B32]">Pending Tasks</h2>
                  <button
                    onClick={() => onNavigateSection('teacher_assignments')}
                    className="text-xs font-medium text-[#315C83] hover:underline cursor-pointer"
                  >
                    All assignments
                  </button>
                </div>

                {pendingAssignments.length === 0 ? (
                  <div className="py-6 text-center space-y-1">
                    <p className="text-xs font-medium text-[#252B32]">All caught up</p>
                    <p className="text-xs text-[#73777C]">
                      No student submissions are currently awaiting evaluation.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#EAE4DA]">
                    {pendingAssignments.slice(0, 5).map((asgn) => (
                      <div
                        key={asgn.id}
                        className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="text-[11px] font-medium text-[#73777C]">
                            {asgn.course_code} · Due {asgn.due_at}
                          </span>
                          <p className="text-xs font-medium text-[#252B32] truncate mt-0.5">
                            {asgn.title}
                          </p>
                          <p className="text-[11px] text-[#946326] font-medium">
                            {asgn.pending_count} pending evaluation
                            {asgn.pending_count === 1 ? '' : 's'}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setActiveSubmissionsAssignmentId(asgn.id);
                            onNavigateSection('teacher_assignments');
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors shrink-0 cursor-pointer"
                        >
                          Evaluate
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Schedule */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[#252B32]">Upcoming Schedule</h2>
                  <button
                    onClick={() => onNavigateSection('teacher_schedule')}
                    className="text-xs font-medium text-[#315C83] hover:underline cursor-pointer"
                  >
                    Full schedule
                  </button>
                </div>

                {data.schedule.length === 0 && data.assignments.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-6 text-center">
                    No upcoming classes or deadlines scheduled.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA]">
                    {data.schedule.slice(0, 4).map((item) => (
                      <div key={item.id} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#252B32]">
                            {item.date} · {item.time}
                          </span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#EAE4DA] text-[#555A60] capitalize">
                            {item.type}
                          </span>
                        </div>
                        <p className="text-xs text-[#555A60] truncate mt-0.5">
                          {item.course_code}: {item.title}
                        </p>
                        <p className="text-[11px] text-[#73777C]">{item.location}</p>
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
          2. MY COURSES (Course Details, Modules/Lessons, PDFs, Video Links, Enrolled Students)
      ===================================================================== */}
      {activeSection === 'teacher_courses' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">My Courses</h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Manage modules, lessons, downloadable documents, video resources, and course visibility.
              </p>
            </div>
          </div>

          {data.courses.length === 0 ? (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-8 text-center">
              <p className="text-sm font-medium text-[#252B32]">No courses assigned</p>
              <p className="text-xs text-[#73777C] mt-1">
                Courses assigned to you by the Administrator will appear here.
              </p>
            </div>
          ) : (
            <>
              {/* Course Selector Bar */}
              <div className="flex flex-wrap items-center gap-2">
                {data.courses.map((course) => {
                  const isSelected = activeCourse?.id === course.id;
                  return (
                    <button
                      key={course.id}
                      onClick={() => setSelectedCourseId(course.id)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer flex items-center gap-2 ${
                        isSelected
                          ? 'bg-[#315C83] text-white border-[#315C83]'
                          : 'bg-[#FAF8F5] text-[#252B32] border-[#DDD6CA] hover:bg-[#EAE4DA]'
                      }`}
                    >
                      <span>{course.code}</span>
                      <span className="opacity-80">·</span>
                      <span className="truncate max-w-[180px]">{course.title}</span>
                    </button>
                  );
                })}
              </div>

              {activeCourse && (
                <div className="space-y-6">
                  {/* Course Overview Header Card */}
                  <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#EAE4DA] text-[#315C83]">
                            {activeCourse.code}
                          </span>
                          <span className="text-xs text-[#73777C]">{activeCourse.category}</span>
                          <span className="text-xs text-[#73777C]">· {activeCourse.level}</span>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                              activeCourse.published !== false
                                ? 'bg-[#EBF3EE] text-[#2F6A4F]'
                                : 'bg-[#EAE4DA] text-[#73777C]'
                            }`}
                          >
                            {activeCourse.published !== false ? 'Published' : 'Unpublished'}
                          </span>
                        </div>
                        <h2 className="text-lg font-semibold text-[#252B32]">
                          {activeCourse.title}
                        </h2>
                        <p className="text-xs text-[#555A60] max-w-3xl leading-relaxed">
                          {activeCourse.description}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          onClick={() => onOpenCourseWorkspace(activeCourse.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Open Course View
                        </button>
                        <button
                          onClick={() => handleToggleCoursePublished(activeCourse)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors cursor-pointer"
                        >
                          {activeCourse.published !== false ? 'Unpublish' : 'Publish'}
                        </button>
                        <button
                          onClick={() => openEditCourseModal(activeCourse)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit Details
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-[#EAE4DA]">
                      <div>
                        <span className="text-[11px] text-[#73777C]">Enrolled Students</span>
                        <p className="text-sm font-semibold text-[#252B32]">
                          {activeCourse.student_count}
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#73777C]">Published Lessons</span>
                        <p className="text-sm font-semibold text-[#252B32]">
                          {activeCourse.materials.filter((m) => m.published !== false).length} /{' '}
                          {activeCourse.materials.length}
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#73777C]">Average Progress</span>
                        <p className="text-sm font-semibold text-[#252B32]">
                          {activeCourse.overall_completion_rate ?? activeCourse.progress_percent}%
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#73777C]">Assignments</span>
                        <p className="text-sm font-semibold text-[#252B32]">
                          {activeCourse.assignment_count}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Modules & Lessons Management */}
                  <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-[#252B32]">
                          Course Modules & Learning Materials
                        </h3>
                        <p className="text-xs text-[#73777C]">
                          Add lessons, upload PDFs/presentations, attach video links, and control visibility.
                        </p>
                      </div>
                      <button
                        onClick={() => openCreateLessonModal(activeCourse)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors flex items-center gap-1.5 self-start cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Lesson / Material
                      </button>
                    </div>

                    {activeCourse.materials.length === 0 ? (
                      <div className="py-8 text-center border border-dashed border-[#DDD6CA] rounded-lg">
                        <p className="text-xs text-[#73777C]">
                          No modules or lessons created for this course yet.
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                              <th className="py-2.5 pr-4">#</th>
                              <th className="py-2.5 px-4">Module</th>
                              <th className="py-2.5 px-4">Lesson Title</th>
                              <th className="py-2.5 px-4">Resources</th>
                              <th className="py-2.5 px-4">Status</th>
                              <th className="py-2.5 pl-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EAE4DA] text-xs">
                            {activeCourse.materials.map((mat) => (
                              <tr key={mat.id} className="hover:bg-[#F3EFEA]/60">
                                <td className="py-3 pr-4 font-medium text-[#73777C]">
                                  {mat.lesson_number}
                                </td>
                                <td className="py-3 px-4 text-[#555A60]">{mat.module_title}</td>
                                <td className="py-3 px-4">
                                  <p className="font-medium text-[#252B32]">{mat.title}</p>
                                  <p className="text-[11px] text-[#73777C]">
                                    {mat.duration_minutes} mins
                                  </p>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {mat.original_name && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          downloadFileWithAuth(
                                            `/api/materials/${mat.id}/download`,
                                            mat.original_name || 'material.bin'
                                          ).catch((err) =>
                                            showToast('error', err instanceof Error ? err.message : 'Download failed')
                                          );
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EAE4DA] text-[#252B32] hover:bg-[#DDD6CA] text-[11px] cursor-pointer"
                                      >
                                        <FileText className="w-3 h-3 text-[#315C83]" />
                                        <span className="truncate max-w-[120px]">
                                          {mat.original_name}
                                        </span>
                                      </button>
                                    )}
                                    {mat.video_url && (
                                      <a
                                        href={mat.video_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EAE4DA] text-[#315C83] hover:bg-[#DDD6CA] text-[11px]"
                                      >
                                        <Video className="w-3 h-3" />
                                        <span>Video</span>
                                      </a>
                                    )}
                                    {!mat.original_name && !mat.video_url && (
                                      <span className="text-[11px] text-[#73777C]">Reading Notes</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <button
                                    onClick={() => handleToggleLessonPublish(mat)}
                                    className={`text-[11px] px-2 py-0.5 rounded font-medium cursor-pointer ${
                                      mat.published !== false
                                        ? 'bg-[#EBF3EE] text-[#2F6A4F]'
                                        : 'bg-[#EAE4DA] text-[#73777C]'
                                    }`}
                                  >
                                    {mat.published !== false ? 'Published' : 'Hidden'}
                                  </button>
                                </td>
                                <td className="py-3 pl-4 text-right">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      onClick={() => openEditLessonModal(mat)}
                                      className="p-1.5 rounded hover:bg-[#EAE4DA] text-[#555A60] cursor-pointer"
                                      title="Edit Lesson"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteLesson(mat.id)}
                                      className="p-1.5 rounded hover:bg-[#F9EBEB] text-[#993B3B] cursor-pointer"
                                      title="Delete Lesson"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Enrolled Students in this Course */}
                  <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#252B32] mb-3">
                      Enrolled Students ({activeCourse.enrolled_students.length})
                    </h3>
                    {activeCourse.enrolled_students.length === 0 ? (
                      <p className="text-xs text-[#73777C]">
                        No students are currently enrolled in this course.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                              <th className="py-2 pr-4">Student</th>
                              <th className="py-2 px-4">Email</th>
                              <th className="py-2 px-4">Course Progress</th>
                              <th className="py-2 pl-4 text-right">Assessment Score</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EAE4DA] text-xs">
                            {activeCourse.enrolled_students.map((stu) => (
                              <tr key={stu.student_id}>
                                <td className="py-2.5 pr-4 font-medium text-[#252B32]">
                                  {stu.full_name}
                                </td>
                                <td className="py-2.5 px-4 text-[#555A60]">{stu.email}</td>
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-24 h-1.5 bg-[#EAE4DA] rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-[#315C83]"
                                        style={{ width: `${stu.progress_percent}%` }}
                                      />
                                    </div>
                                    <span className="text-[#555A60]">{stu.progress_percent}%</span>
                                  </div>
                                </td>
                                <td className="py-2.5 pl-4 text-right font-medium text-[#252B32]">
                                  {stu.assessment_score !== null ? `${stu.assessment_score}%` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          3. MY STUDENTS (Search, Filter by Course, Academic Profile Modal)
      ===================================================================== */}
      {activeSection === 'teacher_students' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">My Students</h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Students enrolled across your assigned courses and their academic progress.
              </p>
            </div>
          </div>

          {/* Search & Course Filter */}
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#73777C] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Search students by name or email..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
              />
            </div>
            <select
              value={studentCourseFilter}
              onChange={(e) => setStudentCourseFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
            >
              <option value="ALL">All My Courses ({data.courses.length})</option>
              {data.courses.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>

          {/* Students Table */}
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
            {filteredStudents.length === 0 ? (
              <p className="text-xs text-[#73777C] py-8 text-center">
                No enrolled students match your current filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                      <th className="py-2.5 pr-4">Student Name</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4">Enrolled Courses</th>
                      <th className="py-2.5 px-4">Avg Progress</th>
                      <th className="py-2.5 px-4">Overall Grade</th>
                      <th className="py-2.5 pl-4 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA] text-xs">
                    {filteredStudents.map((stu) => (
                      <tr key={stu.student_id} className="hover:bg-[#F3EFEA]/60">
                        <td className="py-3 pr-4 font-medium text-[#252B32]">{stu.full_name}</td>
                        <td className="py-3 px-4 text-[#555A60]">{stu.email}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {stu.courses.map((c) => (
                              <span
                                key={c.course_id}
                                className="px-2 py-0.5 rounded bg-[#EAE4DA] text-[#315C83] text-[11px] font-medium"
                              >
                                {c.course_code}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-[#EAE4DA] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#315C83]"
                                style={{ width: `${stu.overall_progress_percent}%` }}
                              />
                            </div>
                            <span className="font-medium text-[#252B32]">
                              {stu.overall_progress_percent}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[#555A60]">
                          {stu.overall_grade_percent !== null
                            ? `${stu.overall_grade_percent}%`
                            : '—'}
                        </td>
                        <td className="py-3 pl-4 text-right">
                          <button
                            onClick={() => setInspectingStudent(stu)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors cursor-pointer"
                          >
                            View Profile
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          4. ASSIGNMENTS (Create/Edit/Delete, View & Grade Submissions)
      ===================================================================== */}
      {activeSection === 'teacher_assignments' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">Assignments</h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Create assignments, manage deadlines, download student submissions, and record grades.
              </p>
            </div>
            <button
              onClick={openCreateAssignmentModal}
              disabled={data.courses.length === 0}
              className="px-3.5 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] disabled:opacity-50 transition-colors flex items-center gap-1.5 self-start cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Assignment
            </button>
          </div>

          {/* Filter by course */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setAssignmentCourseFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  assignmentCourseFilter === 'ALL'
                    ? 'bg-[#315C83] text-white border-[#315C83]'
                    : 'bg-[#FAF8F5] text-[#252B32] border-[#DDD6CA] hover:bg-[#EAE4DA]'
                }`}
              >
                All Courses
              </button>
              {data.courses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setAssignmentCourseFilter(String(c.id))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    assignmentCourseFilter === String(c.id)
                      ? 'bg-[#315C83] text-white border-[#315C83]'
                      : 'bg-[#FAF8F5] text-[#252B32] border-[#DDD6CA] hover:bg-[#EAE4DA]'
                  }`}
                >
                  {c.code}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Assignments List */}
            <div className="lg:col-span-5 space-y-3">
              <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-4">
                <h2 className="text-sm font-semibold text-[#252B32] mb-3">
                  Course Assignments ({filteredAssignments.length})
                </h2>
                {filteredAssignments.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-6 text-center">
                    No assignments found for the selected filter.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {filteredAssignments.map((asgn) => {
                      const isSelected = activeAssignmentForSubmissions?.id === asgn.id;
                      return (
                        <div
                          key={asgn.id}
                          onClick={() => setActiveSubmissionsAssignmentId(asgn.id)}
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
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditAssignmentModal(asgn);
                                }}
                                className="p-1 rounded hover:bg-[#EAE4DA] text-[#555A60] cursor-pointer"
                                title="Edit Assignment"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteAssignment(asgn.id);
                                }}
                                className="p-1 rounded hover:bg-[#F9EBEB] text-[#993B3B] cursor-pointer"
                                title="Delete Assignment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-[#73777C] mt-1 line-clamp-2">
                            {asgn.description}
                          </p>
                          <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t border-[#EAE4DA] text-[11px]">
                            <span className="text-[#555A60]">
                              Due: <strong>{asgn.due_at}</strong> · Max {asgn.max_score} pts
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-[#2F6A4F] font-medium">
                                {asgn.graded_count} graded
                              </span>
                              {asgn.pending_count > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-[#FBF3E6] text-[#946326] font-medium">
                                  {asgn.pending_count} pending
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Student Submissions Panel */}
            <div className="lg:col-span-7">
              <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                {!activeAssignmentForSubmissions ? (
                  <p className="text-xs text-[#73777C] py-12 text-center">
                    Select an assignment on the left to inspect and evaluate student submissions.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#EAE4DA]">
                      <div>
                        <span className="text-xs font-semibold text-[#315C83]">
                          {activeAssignmentForSubmissions.course_code}
                        </span>
                        <h3 className="text-sm font-semibold text-[#252B32]">
                          {activeAssignmentForSubmissions.title} — Submissions
                        </h3>
                        {activeAssignmentForSubmissions.reference_link && (
                          <a
                            href={activeAssignmentForSubmissions.reference_link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-[#315C83] hover:underline mt-0.5"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Reference Resource
                          </a>
                        )}
                      </div>

                      <div className="flex items-center gap-1 bg-[#EAE4DA] p-1 rounded-lg self-start">
                        {(['ALL', 'PENDING', 'EVALUATED'] as const).map((st) => (
                          <button
                            key={st}
                            onClick={() => setSubmissionStatusFilter(st)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                              submissionStatusFilter === st
                                ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                                : 'text-[#555A60] hover:text-[#252B32]'
                            }`}
                          >
                            {st === 'ALL' ? 'All' : st === 'PENDING' ? 'Pending' : 'Evaluated'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(() => {
                      const subs = activeAssignmentForSubmissions.submissions.filter((s) => {
                        if (submissionStatusFilter === 'PENDING') return s.grade === null;
                        if (submissionStatusFilter === 'EVALUATED') return s.grade !== null;
                        return true;
                      });

                      if (subs.length === 0) {
                        return (
                          <p className="text-xs text-[#73777C] py-8 text-center">
                            No submissions found for this filter.
                          </p>
                        );
                      }

                      return (
                        <div className="divide-y divide-[#EAE4DA]">
                          {subs.map((sub) => (
                            <div
                              key={sub.id}
                              className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-[#252B32]">
                                    {sub.student_name}
                                  </span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                      sub.grade !== null
                                        ? 'bg-[#EBF3EE] text-[#2F6A4F]'
                                        : 'bg-[#FBF3E6] text-[#946326]'
                                    }`}
                                  >
                                    {sub.grade !== null
                                      ? `Graded: ${sub.grade}/${activeAssignmentForSubmissions.max_score}`
                                      : 'Pending Evaluation'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[#73777C]">
                                  Submitted {sub.submitted_at}
                                </p>
                                {sub.body && (
                                  <p className="text-xs text-[#555A60] bg-white border border-[#EAE4DA] rounded-lg p-2 mt-1">
                                    "{sub.body}"
                                  </p>
                                )}
                                {sub.feedback && (
                                  <p className="text-[11px] text-[#2F6A4F] mt-1">
                                    <strong>Feedback:</strong> {sub.feedback}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {sub.original_name && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      downloadFileWithAuth(
                                        `/api/submissions/${sub.id}/download`,
                                        sub.original_name || 'submission.bin'
                                      ).catch((err) =>
                                        showToast('error', err instanceof Error ? err.message : 'Download failed')
                                      );
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[#DDD6CA] text-[#252B32] hover:bg-[#EAE4DA] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Download className="w-3.5 h-3.5 text-[#315C83]" />
                                    <span className="max-w-[110px] truncate">
                                      {sub.original_name}
                                    </span>
                                  </button>
                                )}
                                <button
                                  onClick={() => openGradeModal(sub)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors cursor-pointer"
                                >
                                  {sub.grade !== null ? 'Update Grade' : 'Evaluate'}
                                </button>
                              </div>
                            </div>
                          ))}
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

      {/* =====================================================================
          5. REMARKS (Quizzes/Tests, Objective & Subjective, Gradebook)
      ===================================================================== */}
      {activeSection === 'teacher_assessments' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">
                Remarks
              </h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Manage objective and subjective quiz questions, evaluate student performance, and publish remarks.
              </p>
            </div>
          </div>

          {data.courses.length === 0 ? (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-8 text-center">
              <p className="text-xs text-[#73777C]">No courses assigned to manage assessments.</p>
            </div>
          ) : (
            <>
              {/* Course Selector */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {data.courses.map((course) => (
                    <button
                      key={course.id}
                      onClick={() => setAssessmentCourseId(course.id)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        activeAssessmentCourse?.id === course.id
                          ? 'bg-[#315C83] text-white border-[#315C83]'
                          : 'bg-[#FAF8F5] text-[#252B32] border-[#DDD6CA] hover:bg-[#EAE4DA]'
                      }`}
                    >
                      {course.code} · {course.title}
                    </button>
                  ))}
                </div>

                {activeAssessmentCourse && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleResultsPublished(activeAssessmentCourse)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        activeAssessmentCourse.results_published !== false
                          ? 'bg-[#EBF3EE] border-[#B7D4C2] text-[#2F6A4F]'
                          : 'bg-[#FAF8F5] border-[#DDD6CA] text-[#555A60]'
                      }`}
                    >
                      {activeAssessmentCourse.results_published !== false
                        ? 'Results Published'
                        : 'Results Hidden (Click to Publish)'}
                    </button>
                    <button
                      onClick={handleOpenAiModal}
                      disabled={!aiEnabled}
                      title={
                        aiEnabled
                          ? 'Generate assessment questions using Gemini AI'
                          : 'Gemini AI features are not configured on the server'
                      }
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                        aiEnabled
                          ? 'bg-gradient-to-r from-[#2F6A4F] to-[#255740] text-white hover:brightness-110 cursor-pointer shadow-sm'
                          : 'bg-[#EAE4DA] text-[#8C9298] cursor-not-allowed border border-[#DDD6CA]'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate with AI
                    </button>
                    <button
                      onClick={() => setQuestionModalOpen(true)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Question
                    </button>
                  </div>
                )}
              </div>

              {activeAssessmentCourse && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Assessment Questions List */}
                  <div className="lg:col-span-6">
                    <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[#252B32]">
                          Assessment Questions ({activeAssessmentCourse.quiz_questions.length})
                        </h2>
                        <span className="text-xs text-[#73777C]">
                          Total Marks:{' '}
                          {activeAssessmentCourse.quiz_questions.reduce(
                            (acc, q) => acc + (q.marks || 10),
                            0
                          )}
                        </span>
                      </div>

                      {activeAssessmentCourse.quiz_questions.length === 0 ? (
                        <p className="text-xs text-[#73777C] py-6 text-center">
                          No questions added to this course assessment yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-[#EAE4DA]">
                          {activeAssessmentCourse.quiz_questions.map((q, idx) => (
                            <div key={q.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-[#315C83]">
                                    Q{idx + 1}.
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EAE4DA] text-[#252B32] font-medium uppercase">
                                    {q.question_type === 'subjective' ? 'Subjective' : 'Objective MCQ'}
                                  </span>
                                  <span className="text-[11px] text-[#73777C]">
                                    ({q.marks || 10} marks)
                                  </span>
                                </div>
                                <button
                                  onClick={() => handleDeleteQuestion(q.id)}
                                  className="p-1 rounded hover:bg-[#F9EBEB] text-[#993B3B] cursor-pointer"
                                  title="Delete Question"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <p className="text-xs font-medium text-[#252B32]">{q.question}</p>
                              {q.question_type !== 'subjective' && q.options?.length > 0 && (
                                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                                  {q.options.map((opt, oIdx) => (
                                    <li
                                      key={oIdx}
                                      className={`text-[11px] px-2 py-1 rounded border ${
                                        oIdx === q.correct_index
                                          ? 'bg-[#EBF3EE] border-[#B7D4C2] text-[#2F6A4F] font-medium'
                                          : 'bg-white border-[#EAE4DA] text-[#555A60]'
                                      }`}
                                    >
                                      {opt}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {q.explanation && (
                                <p className="text-[11px] text-[#73777C] italic">
                                  Rubric / Explanation: {q.explanation}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Student Gradebook & Assessment Marks */}
                  <div className="lg:col-span-6">
                    <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 space-y-4">
                      <div>
                        <h2 className="text-sm font-semibold text-[#252B32]">
                          Student Performance & Assessment Marks
                        </h2>
                        <p className="text-xs text-[#73777C]">
                          Enter or update overall assessment marks (0–100%) including subjective evaluation.
                        </p>
                      </div>

                      {activeAssessmentCourse.enrolled_students.length === 0 ? (
                        <p className="text-xs text-[#73777C] py-6 text-center">
                          No students enrolled in this course.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                                <th className="py-2 pr-3">Student</th>
                                <th className="py-2 px-3">Progress</th>
                                <th className="py-2 px-3">Mark (0-100)</th>
                                <th className="py-2 pl-3 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EAE4DA] text-xs">
                              {activeAssessmentCourse.enrolled_students.map((stu) => (
                                <tr key={stu.student_id}>
                                  <td className="py-2.5 pr-3">
                                    <p className="font-medium text-[#252B32]">{stu.full_name}</p>
                                    <p className="text-[11px] text-[#73777C]">{stu.email}</p>
                                  </td>
                                  <td className="py-2.5 px-3 text-[#555A60]">
                                    {stu.progress_percent}%
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={studentMarkInputs[stu.student_id] ?? ''}
                                      onChange={(e) =>
                                        setStudentMarkInputs((prev) => ({
                                          ...prev,
                                          [stu.student_id]: e.target.value,
                                        }))
                                      }
                                      placeholder="—"
                                      className="w-20 px-2.5 py-1 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
                                    />
                                  </td>
                                  <td className="py-2.5 pl-3 text-right">
                                    <button
                                      onClick={() =>
                                        handleSaveStudentAssessmentMark(stu.student_id)
                                      }
                                      disabled={savingStudentMarkId === stu.student_id}
                                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] disabled:opacity-50 transition-colors cursor-pointer"
                                    >
                                      {savingStudentMarkId === stu.student_id ? 'Saving...' : 'Save'}
                                    </button>
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
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          6. SCHEDULE (Upcoming Classes, Assignment Deadlines, Assessment Dates)
      ===================================================================== */}
      {activeSection === 'teacher_schedule' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">Schedule</h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                Upcoming classes, laboratory sessions, assessment dates, and assignment deadlines.
              </p>
            </div>
            <button
              onClick={() => {
                setScheduleForm({
                  title: '',
                  course_code: data.courses[0]?.code || 'COURSE',
                  date: 'Monday',
                  time: '10:00 AM',
                  duration_label: '60 min',
                  type: 'lecture',
                  location: 'Room 204',
                });
                setScheduleModalOpen(true);
              }}
              disabled={data.courses.length === 0}
              className="px-3.5 py-2 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] disabled:opacity-50 transition-colors flex items-center gap-1.5 self-start cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Class / Session
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Weekly Class & Assessment Sessions */}
            <div className="lg:col-span-7">
              <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                <h2 className="text-sm font-semibold text-[#252B32] mb-4">
                  Scheduled Classes & Assessment Sessions ({data.schedule.length})
                </h2>

                {data.schedule.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-8 text-center">
                    No scheduled sessions found for your courses.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#DDD6CA] text-[11px] font-semibold text-[#73777C] uppercase">
                          <th className="py-2 pr-4">Day & Time</th>
                          <th className="py-2 px-4">Course & Session</th>
                          <th className="py-2 px-4">Room / Type</th>
                          <th className="py-2 pl-4 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAE4DA] text-xs">
                        {data.schedule.map((item) => (
                          <tr key={item.id}>
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-[#252B32]">{item.date}</p>
                              <p className="text-[11px] text-[#73777C]">
                                {item.time} ({item.duration_label})
                              </p>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-[11px] font-semibold text-[#315C83]">
                                {item.course_code}
                              </span>
                              <p className="font-medium text-[#252B32]">{item.title}</p>
                            </td>
                            <td className="py-3 px-4">
                              <p className="text-[#252B32]">{item.location}</p>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EAE4DA] text-[#555A60] capitalize">
                                {item.type}
                              </span>
                            </td>
                            <td className="py-3 pl-4 text-right">
                              <button
                                onClick={() => handleDeleteSchedule(item.id)}
                                className="p-1.5 rounded hover:bg-[#F9EBEB] text-[#993B3B] cursor-pointer"
                                title="Delete Session"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Assignment Deadlines */}
            <div className="lg:col-span-5">
              <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5">
                <h2 className="text-sm font-semibold text-[#252B32] mb-4">
                  Assignment Deadlines ({data.assignments.length})
                </h2>

                {data.assignments.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-8 text-center">
                    No assignment deadlines scheduled.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA]">
                    {data.assignments.map((asgn) => (
                      <div
                        key={asgn.id}
                        className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                      >
                        <div>
                          <span className="text-[11px] font-semibold text-[#315C83]">
                            {asgn.course_code}
                          </span>
                          <p className="text-xs font-medium text-[#252B32]">{asgn.title}</p>
                          <p className="text-[11px] text-[#73777C]">
                            {asgn.submission_count} submissions
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-semibold text-[#252B32]">
                            {asgn.due_at}
                          </span>
                          <p className="text-[11px] text-[#73777C]">
                            {asgn.pending_count > 0 ? `${asgn.pending_count} pending` : 'Up to date'}
                          </p>
                        </div>
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
          7. PROFILE (Read-Only Profile Info, Change Login Password Only, Sign Out)
      ===================================================================== */}
      {activeSection === 'teacher_settings' && (
        <div className="space-y-6 max-w-4xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-[#252B32] tracking-tight">
                Profile
              </h1>
              <p className="text-xs text-[#73777C] mt-0.5">
                View your faculty account details and update your login password.
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
            {/* Read-Only Profile Information Card */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#252B32]">Faculty Profile</h2>
                  <p className="text-[11px] text-[#73777C]">Username: @{data.teacher.username}</p>
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#EAE4DA] text-[#315C83]">
                  Role: Teacher (Read-only)
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#73777C] mb-1">
                  Full Name (Read-only)
                </label>
                <div className="w-full px-3 py-2 text-xs bg-[#EAE4DA]/60 border border-[#DDD6CA] rounded-lg text-[#252B32] font-medium select-text">
                  {data.teacher.full_name}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#73777C] mb-1">
                  Email Address (Read-only)
                </label>
                <div className="w-full px-3 py-2 text-xs bg-[#EAE4DA]/60 border border-[#DDD6CA] rounded-lg text-[#252B32] select-text">
                  {data.teacher.email}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#73777C] mb-1">
                  Academic Bio & Department (Read-only)
                </label>
                <div className="w-full px-3 py-2 text-xs bg-[#EAE4DA]/60 border border-[#DDD6CA] rounded-lg text-[#555A60] min-h-[64px]">
                  {data.teacher.bio || 'Faculty Member'}
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
                  Update your password for signing in to the LMS.
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

      {/* Course Edit Modal */}
      {courseModalOpen && editingCourse && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <h3 className="text-sm font-semibold text-[#252B32]">Edit Course Details</h3>
              <button
                onClick={() => setCourseModalOpen(false)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveCourse} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Course Code
                  </label>
                  <input
                    type="text"
                    disabled
                    value={courseForm.code}
                    className="w-full px-3 py-1.5 text-xs bg-[#EAE4DA] border border-[#DDD6CA] rounded-lg text-[#73777C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">Level</label>
                  <input
                    type="text"
                    required
                    value={courseForm.level}
                    onChange={(e) => setCourseForm({ ...courseForm, level: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Course Title
                </label>
                <input
                  type="text"
                  required
                  value={courseForm.title}
                  onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">Category</label>
                <input
                  type="text"
                  required
                  value={courseForm.category}
                  onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  required
                  value={courseForm.description}
                  onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs text-[#252B32]">
                  <input
                    type="checkbox"
                    checked={courseForm.published}
                    onChange={(e) => setCourseForm({ ...courseForm, published: e.target.checked })}
                  />
                  Published to Students
                </label>
                <label className="flex items-center gap-2 text-xs text-[#252B32]">
                  <input
                    type="checkbox"
                    checked={courseForm.results_published}
                    onChange={(e) =>
                      setCourseForm({ ...courseForm, results_published: e.target.checked })
                    }
                  />
                  Publish Assessment Grades
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
                <button
                  type="button"
                  onClick={() => setCourseModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] cursor-pointer"
                >
                  Save Course
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lesson / Material Create & Edit Modal */}
      {lessonModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-lg my-8">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <h3 className="text-sm font-semibold text-[#252B32]">
                {editingLesson ? 'Edit Lesson / Material' : 'Add Lesson & Learning Material'}
              </h3>
              <button
                onClick={() => setLessonModalOpen(false)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveLesson} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Module Title
                  </label>
                  <input
                    type="text"
                    required
                    value={lessonForm.module_title}
                    onChange={(e) =>
                      setLessonForm({ ...lessonForm, module_title: e.target.value })
                    }
                    placeholder="e.g. Module 1: Foundations"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Lesson #
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={lessonForm.lesson_number}
                    onChange={(e) =>
                      setLessonForm({ ...lessonForm, lesson_number: Number(e.target.value) })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Lesson Title
                  </label>
                  <input
                    type="text"
                    required
                    value={lessonForm.title}
                    onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                    placeholder="Enter lesson title"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Duration (min)
                  </label>
                  <input
                    type="number"
                    min={5}
                    required
                    value={lessonForm.duration_minutes}
                    onChange={(e) =>
                      setLessonForm({ ...lessonForm, duration_minutes: Number(e.target.value) })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Lesson Content / Lecture Notes
                </label>
                <textarea
                  rows={4}
                  required
                  value={lessonForm.body}
                  onChange={(e) => setLessonForm({ ...lessonForm, body: e.target.value })}
                  placeholder="Write detailed lecture notes, reading instructions, or key takeaways..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Video Learning Resource Link (Optional)
                </label>
                <input
                  type="url"
                  value={lessonForm.video_url}
                  onChange={(e) => setLessonForm({ ...lessonForm, video_url: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=... or lecture recording URL"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Upload PDF / Document / Presentation (Optional)
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.zip"
                  onChange={handleLessonFileChange}
                  className="w-full text-xs text-[#555A60] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-[#EAE4DA] file:text-[#252B32] hover:file:bg-[#DDD6CA]"
                />
                {lessonForm.file_name && (
                  <p className="text-[11px] text-[#2F6A4F] mt-1">
                    Attached: {lessonForm.file_name} ({lessonForm.file_size_kb} KB)
                  </p>
                )}
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs text-[#252B32]">
                  <input
                    type="checkbox"
                    checked={lessonForm.published}
                    onChange={(e) => setLessonForm({ ...lessonForm, published: e.target.checked })}
                  />
                  Publish this lesson immediately
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
                <button
                  type="button"
                  onClick={() => setLessonModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] cursor-pointer"
                >
                  {editingLesson ? 'Save Lesson' : 'Add Lesson'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Student Profile Inspection Modal */}
      {inspectingStudent && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-xl w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#252B32]">
                  {inspectingStudent.full_name}
                </h3>
                <p className="text-xs text-[#73777C]">{inspectingStudent.email}</p>
              </div>
              <button
                onClick={() => setInspectingStudent(null)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-[#73777C] uppercase">
                Course Progress & Assessment Performance
              </h4>
              <div className="divide-y divide-[#EAE4DA] border border-[#DDD6CA] rounded-lg bg-white px-3">
                {inspectingStudent.courses.map((c) => (
                  <div
                    key={c.course_id}
                    className="py-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-semibold text-[#315C83]">{c.course_code}</span>
                      <p className="font-medium text-[#252B32]">{c.course_title}</p>
                      <p className="text-[11px] text-[#73777C]">
                        Lessons: {c.completed_lessons}/{c.total_lessons} · Assignments:{' '}
                        {c.assignments_submitted}/{c.assignments_total}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-[#252B32]">Progress: {c.progress_percent}%</p>
                      <p className="text-[11px] text-[#73777C]">
                        Assessment:{' '}
                        {c.assessment_score !== null ? `${c.assessment_score}%` : 'Not graded'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-white border border-[#DDD6CA]">
                  <span className="text-[11px] text-[#73777C]">Overall Course Progress</span>
                  <p className="text-base font-semibold text-[#252B32]">
                    {inspectingStudent.overall_progress_percent}%
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-white border border-[#DDD6CA]">
                  <span className="text-[11px] text-[#73777C]">Overall Academic Average</span>
                  <p className="text-base font-semibold text-[#252B32]">
                    {inspectingStudent.overall_grade_percent !== null
                      ? `${inspectingStudent.overall_grade_percent}%`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#EAE4DA]">
              <button
                onClick={() => setInspectingStudent(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Create / Edit Modal */}
      {assignmentModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <h3 className="text-sm font-semibold text-[#252B32]">
                {editingAssignment ? 'Edit Assignment' : 'Create Assignment'}
              </h3>
              <button
                onClick={() => setAssignmentModalOpen(false)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveAssignment} className="space-y-3">
              {!editingAssignment && (
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">Course</label>
                  <select
                    required
                    value={assignmentForm.course_id}
                    onChange={(e) =>
                      setAssignmentForm({ ...assignmentForm, course_id: Number(e.target.value) })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    {data.courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Assignment Title
                </label>
                <input
                  type="text"
                  required
                  value={assignmentForm.title}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })}
                  placeholder="e.g. Problem Set 3: Dynamic Programming"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Submission Deadline
                  </label>
                  <input
                    type="date"
                    required
                    value={assignmentForm.due_at}
                    onChange={(e) =>
                      setAssignmentForm({ ...assignmentForm, due_at: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Max Marks
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={assignmentForm.max_score}
                    onChange={(e) =>
                      setAssignmentForm({ ...assignmentForm, max_score: Number(e.target.value) })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Description & Instructions
                </label>
                <textarea
                  rows={3}
                  required
                  value={assignmentForm.description}
                  onChange={(e) =>
                    setAssignmentForm({ ...assignmentForm, description: e.target.value })
                  }
                  placeholder="Provide clear deliverables, formatting requirements, and evaluation criteria..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Reference Material / Starter Link (Optional)
                </label>
                <input
                  type="url"
                  value={assignmentForm.reference_link}
                  onChange={(e) =>
                    setAssignmentForm({ ...assignmentForm, reference_link: e.target.value })
                  }
                  placeholder="https://..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
                <button
                  type="button"
                  onClick={() => setAssignmentModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] cursor-pointer"
                >
                  {editingAssignment ? 'Save Changes' : 'Create Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submission Evaluation Modal */}
      {gradingSubmission && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#252B32]">Evaluate Submission</h3>
                <p className="text-xs text-[#73777C]">{gradingSubmission.student_name}</p>
              </div>
              <button
                onClick={() => setGradingSubmission(null)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSubmissionGrade} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Marks Awarded (Max {activeAssignmentForSubmissions?.max_score || 100})
                </label>
                <input
                  type="number"
                  min={0}
                  max={activeAssignmentForSubmissions?.max_score || 1000}
                  required
                  value={gradeForm.grade}
                  onChange={(e) => setGradeForm({ ...gradeForm, grade: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Instructor Feedback
                </label>
                <textarea
                  rows={3}
                  value={gradeForm.feedback}
                  onChange={(e) => setGradeForm({ ...gradeForm, feedback: e.target.value })}
                  placeholder="Provide constructive evaluation comments..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
                <button
                  type="button"
                  onClick={() => setGradingSubmission(null)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] cursor-pointer"
                >
                  Save Evaluation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Assessment Question Modal */}
      {questionModalOpen && activeAssessmentCourse && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <h3 className="text-sm font-semibold text-[#252B32]">
                Add Assessment Question ({activeAssessmentCourse.code})
              </h3>
              <button
                onClick={() => setQuestionModalOpen(false)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateQuestion} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Question Type
                  </label>
                  <select
                    value={questionForm.question_type}
                    onChange={(e) =>
                      setQuestionForm({
                        ...questionForm,
                        question_type: e.target.value as 'mcq' | 'subjective',
                      })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="mcq">Objective (Multiple Choice)</option>
                    <option value="subjective">Subjective (Written Response)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">Marks</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={questionForm.marks}
                    onChange={(e) =>
                      setQuestionForm({ ...questionForm, marks: Number(e.target.value) })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Question Prompt
                </label>
                <textarea
                  rows={2}
                  required
                  value={questionForm.question}
                  onChange={(e) =>
                    setQuestionForm({ ...questionForm, question: e.target.value })
                  }
                  placeholder="Enter the question statement..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>

              {questionForm.question_type === 'mcq' && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[#252B32]">
                    Answer Options (Select the correct option)
                  </label>
                  {questionForm.options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="correct_index"
                        checked={questionForm.correct_index === idx}
                        onChange={() => setQuestionForm({ ...questionForm, correct_index: idx })}
                      />
                      <input
                        type="text"
                        required
                        value={opt}
                        onChange={(e) => {
                          const next = [...questionForm.options];
                          next[idx] = e.target.value;
                          setQuestionForm({ ...questionForm, options: next });
                        }}
                        placeholder={`Option ${idx + 1}`}
                        className="flex-1 px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  {questionForm.question_type === 'subjective'
                    ? 'Evaluation Rubric / Model Answer'
                    : 'Answer Explanation'}
                </label>
                <textarea
                  rows={2}
                  value={questionForm.explanation}
                  onChange={(e) =>
                    setQuestionForm({ ...questionForm, explanation: e.target.value })
                  }
                  placeholder="Key points required for full credit..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
                <button
                  type="button"
                  onClick={() => setQuestionModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] cursor-pointer"
                >
                  Add Question
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Gemini AI Quiz Generator Modal */}
      {aiModalOpen && activeAssessmentCourse && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-xl max-h-[88vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-[#EBF3EE] text-[#2F6A4F] rounded-lg border border-[#B7D4C2]">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#252B32] flex items-center gap-2">
                    AI Assessment Generator · {activeAssessmentCourse.code}
                  </h3>
                  <p className="text-[11px] text-[#73777C]">
                    Curriculum-grounded quiz generation with Gemini 3.8 Flash
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAiModalOpen(false)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {aiError && (
              <div className="p-3 bg-[#F9EBEB] border border-[#E4B6B6] rounded-lg text-xs text-[#993B3B] flex items-start gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1">{aiError}</span>
              </div>
            )}

            {/* Modal Body: Settings vs Review Drafts */}
            <div className="overflow-y-auto pr-1 space-y-4 flex-1">
              {aiDrafts.length === 0 ? (
                <form onSubmit={handleGenerateAiQuestions} className="space-y-4">
                  {/* Lesson Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[#252B32]">
                        1. Select Source Lessons for Question Generation
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const pub = activeAssessmentCourse.materials
                            .filter((m) => m.published !== false)
                            .map((m) => m.id);
                          setAiSelectedLessons(aiSelectedLessons.length === pub.length ? [] : pub);
                        }}
                        className="text-[11px] text-[#315C83] hover:underline cursor-pointer"
                      >
                        {aiSelectedLessons.length ===
                        activeAssessmentCourse.materials.filter((m) => m.published !== false).length
                          ? 'Deselect All'
                          : 'Select All'}
                      </button>
                    </div>

                    {activeAssessmentCourse.materials.filter((m) => m.published !== false).length ===
                    0 ? (
                      <div className="p-3 bg-[#FBF3EB] border border-[#E9D4BA] rounded-lg text-xs text-[#8A532B]">
                        No published lessons found in this course. Please publish at least one lesson
                        with substantive text before generating questions.
                      </div>
                    ) : (
                      <div className="max-h-36 overflow-y-auto border border-[#DDD6CA] rounded-lg bg-white p-2 divide-y divide-[#EAE4DA] text-xs">
                        {activeAssessmentCourse.materials
                          .filter((m) => m.published !== false)
                          .map((mat) => {
                            const isChecked = aiSelectedLessons.includes(mat.id);
                            return (
                              <label
                                key={mat.id}
                                className="flex items-center gap-2.5 py-1.5 px-1 hover:bg-[#FAF8F5] rounded cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setAiSelectedLessons((prev) => [...prev, mat.id]);
                                    } else {
                                      setAiSelectedLessons((prev) =>
                                        prev.filter((id) => id !== mat.id)
                                      );
                                    }
                                  }}
                                  className="text-[#2F6A4F] rounded border-[#DDD6CA]"
                                />
                                <span className="font-medium text-[#252B32]">
                                  L{mat.lesson_number || '—'}: {mat.title}
                                </span>
                                <span className="text-[10px] text-[#73777C] ml-auto">
                                  {mat.module_title || 'Module'}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  {/* Topic / Focus */}
                  <div>
                    <label className="block text-xs font-semibold text-[#252B32] mb-1">
                      2. Focus Topic / Concept (Optional)
                    </label>
                    <input
                      type="text"
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      placeholder="e.g. Banker's Algorithm, deadlock conditions, or semaphore primitives"
                      className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                    />
                  </div>

                  {/* Count & Difficulty */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-[#252B32]">
                          3. Number of Questions
                        </label>
                        <span className="text-xs font-bold text-[#315C83] bg-[#EAE4DA] px-2 py-0.5 rounded">
                          {aiCount}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={aiCount}
                        onChange={(e) => setAiCount(Number(e.target.value))}
                        className="w-full accent-[#315C83]"
                      />
                      <div className="flex justify-between text-[10px] text-[#73777C]">
                        <span>1 question</span>
                        <span>5 questions</span>
                        <span>10 questions</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#252B32] mb-1">
                        4. Difficulty Level
                      </label>
                      <select
                        value={aiDifficulty}
                        onChange={(e) =>
                          setAiDifficulty(e.target.value as 'easy' | 'medium' | 'hard')
                        }
                        className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                      >
                        <option value="easy">Easy · Foundational definitions & recall</option>
                        <option value="medium">Medium · Conceptual application & analysis</option>
                        <option value="hard">Hard · Complex problem solving & edge cases</option>
                      </select>
                    </div>
                  </div>

                  {/* MCQ vs Subjective Ratio */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-[#252B32]">
                        5. Question Format Balance
                      </label>
                      <span className="text-xs text-[#252B32] font-medium">
                        {Math.round(aiMcqRatio * 100)}% Multiple Choice ·{' '}
                        {Math.round((1 - aiMcqRatio) * 100)}% Subjective
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={aiMcqRatio}
                      onChange={(e) => setAiMcqRatio(Number(e.target.value))}
                      className="w-full accent-[#2F6A4F]"
                    />
                  </div>

                  {/* Submit Generator */}
                  <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
                    <button
                      type="button"
                      onClick={() => setAiModalOpen(false)}
                      className="px-3.5 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer hover:bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={aiGenerating || aiSelectedLessons.length === 0}
                      className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#2F6A4F] text-white hover:bg-[#255740] disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      {aiGenerating ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Generating Drafts...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Generate Questions
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* Review & Edit AI Drafts */
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#EBF3EE] border border-[#B7D4C2] rounded-lg">
                    <div className="flex items-center gap-1.5 text-xs text-[#2F6A4F] font-medium">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {aiDrafts.length} draft question(s) generated. Review, edit, and select
                        which to add.
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const allSelected = aiDrafts.every((d) => d.selected);
                          setAiDrafts((prev) =>
                            prev.map((d) => ({ ...d, selected: !allSelected }))
                          );
                        }}
                        className="text-[11px] text-[#2F6A4F] hover:underline font-medium cursor-pointer"
                      >
                        {aiDrafts.every((d) => d.selected) ? 'Deselect All' : 'Select All'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAiDrafts([]);
                          setAiError(null);
                        }}
                        className="text-[11px] text-[#73777C] hover:text-[#252B32] cursor-pointer"
                      >
                        Discard & Re-run
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3.5">
                    {aiDrafts.map((draft, idx) => (
                      <div
                        key={draft.id}
                        className={`border rounded-xl p-4 transition-colors space-y-3 ${
                          draft.selected
                            ? 'bg-white border-[#B7D4C2] shadow-xs'
                            : 'bg-[#F5F2EB] border-[#DDD6CA] opacity-75'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={draft.selected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setAiDrafts((prev) =>
                                  prev.map((d) =>
                                    d.id === draft.id ? { ...d, selected: checked } : d
                                  )
                                );
                              }}
                              className="text-[#2F6A4F] rounded border-[#DDD6CA]"
                            />
                            <span className="text-xs font-bold text-[#252B32]">
                              Question {idx + 1}
                            </span>
                          </label>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-[#EBF3EE] text-[#2F6A4F] border border-[#B7D4C2] flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5" /> AI-generated · review before use
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#EAE4DA] text-[#252B32] font-semibold uppercase">
                              {draft.question_type}
                            </span>
                          </div>
                        </div>

                        {/* Question Text */}
                        <div>
                          <label className="block text-[11px] font-medium text-[#73777C] mb-1">
                            Question Prompt
                          </label>
                          <textarea
                            rows={2}
                            value={draft.question}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAiDrafts((prev) =>
                                prev.map((d) => (d.id === draft.id ? { ...d, question: val } : d))
                              );
                            }}
                            className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                          />
                        </div>

                        {/* MCQ Options */}
                        {draft.question_type === 'mcq' && (
                          <div className="space-y-1.5">
                            <label className="block text-[11px] font-medium text-[#73777C]">
                              Options (select radio for correct answer)
                            </label>
                            {draft.options.map((opt, optIdx) => (
                              <div key={optIdx} className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={`correct_idx_${draft.id}`}
                                  checked={draft.correct_index === optIdx}
                                  onChange={() => {
                                    setAiDrafts((prev) =>
                                      prev.map((d) =>
                                        d.id === draft.id ? { ...d, correct_index: optIdx } : d
                                      )
                                    );
                                  }}
                                  className="text-[#2F6A4F]"
                                />
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    const nextOpts = [...draft.options];
                                    nextOpts[optIdx] = e.target.value;
                                    setAiDrafts((prev) =>
                                      prev.map((d) =>
                                        d.id === draft.id ? { ...d, options: nextOpts } : d
                                      )
                                    );
                                  }}
                                  className="flex-1 px-2.5 py-1 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Marks & Explanation */}
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                          <div>
                            <label className="block text-[11px] font-medium text-[#73777C] mb-1">
                              Marks (1-100)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={draft.marks}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setAiDrafts((prev) =>
                                  prev.map((d) => (d.id === draft.id ? { ...d, marks: val } : d))
                                );
                              }}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                            />
                          </div>

                          <div className="sm:col-span-3">
                            <label className="block text-[11px] font-medium text-[#73777C] mb-1">
                              Explanation / Model Answer
                            </label>
                            <input
                              type="text"
                              value={draft.explanation}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAiDrafts((prev) =>
                                  prev.map((d) =>
                                    d.id === draft.id ? { ...d, explanation: val } : d
                                  )
                                );
                              }}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Actions to add */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#EAE4DA]">
                    <span className="text-xs text-[#73777C]">
                      {aiDrafts.filter((d) => d.selected).length} of {aiDrafts.length} question(s)
                      selected
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAiDrafts([]);
                          setAiModalOpen(false);
                        }}
                        className="px-3.5 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer hover:bg-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddSelectedAiQuestions}
                        disabled={aiAdding || aiDrafts.filter((d) => d.selected).length === 0}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#2F6A4F] text-white hover:bg-[#255740] disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        {aiAdding ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Adding to Assessment...
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            Add Selected Questions ({aiDrafts.filter((d) => d.selected).length})
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}



      {/* Add Schedule Session Modal */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#EAE4DA] pb-3">
              <h3 className="text-sm font-semibold text-[#252B32]">Add Class / Assessment Session</h3>
              <button
                onClick={() => setScheduleModalOpen(false)}
                className="text-[#73777C] hover:text-[#252B32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSchedule} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">Course</label>
                <select
                  required
                  value={scheduleForm.course_code}
                  onChange={(e) =>
                    setScheduleForm({ ...scheduleForm, course_code: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Session Title
                </label>
                <input
                  type="text"
                  required
                  value={scheduleForm.title}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                  placeholder="e.g. Lecture: Memory Virtualization"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">Day / Date</label>
                  <select
                    value={scheduleForm.date}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                      (d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Session Type
                  </label>
                  <select
                    value={scheduleForm.type}
                    onChange={(e) =>
                      setScheduleForm({
                        ...scheduleForm,
                        type: e.target.value as 'lecture' | 'deadline' | 'study' | 'workshop',
                      })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="lecture">Lecture</option>
                    <option value="workshop">Lab / Workshop</option>
                    <option value="deadline">Assessment / Deadline</option>
                    <option value="study">Office Hours</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">
                    Start Time
                  </label>
                  <input
                    type="text"
                    required
                    value={scheduleForm.time}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                    placeholder="10:00 AM"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#252B32] mb-1">Duration</label>
                  <input
                    type="text"
                    required
                    value={scheduleForm.duration_label}
                    onChange={(e) =>
                      setScheduleForm({ ...scheduleForm, duration_label: e.target.value })
                    }
                    placeholder="60 min"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1">
                  Room / Location
                </label>
                <input
                  type="text"
                  required
                  value={scheduleForm.location}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, location: e.target.value })}
                  placeholder="Room 302 or Online Room"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE4DA]">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#DDD6CA] text-[#555A60] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#315C83] text-white hover:bg-[#274B6B] cursor-pointer"
                >
                  Add Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

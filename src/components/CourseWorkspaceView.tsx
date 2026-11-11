import React, { useState, useEffect, useMemo } from 'react';
import {
  Course,
  Material,
  Assignment,
  Announcement,
  User,
  Submission,
  StudentNote,
  QuizQuestion,
} from '../types/lms';
import { apiFetch, downloadFileWithAuth } from '../utils/api';
import {
  BookOpen,
  Download,
  CheckCircle2,
  Circle,
  Plus,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Send,
  Award,
  Play,
  Pause,
  Bookmark,
  MessageSquare,
  Trash2,
  Volume2,
} from 'lucide-react';

interface CourseWorkspaceViewProps {
  courseId: number;
  user: User;
  activeUserId: number;
  initialAssignmentId?: number | null;
  initialMaterialId?: number | null;
  onBack: () => void;
  onRefreshBootstrap: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const CourseWorkspaceView: React.FC<CourseWorkspaceViewProps> = ({
  courseId,
  user,
  activeUserId,
  initialAssignmentId,
  initialMaterialId,
  onBack,
  onRefreshBootstrap,
}) => {
  const [course, setCourse] = useState<Course | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [activeSubTab, setActiveSubTab] = useState<
    'lessons' | 'notes' | 'quizzes_assignments' | 'announcements'
  >(initialAssignmentId ? 'quizzes_assignments' : 'lessons');

  const [openedMaterial, setOpenedMaterial] = useState<Material | null>(null);

  // Interactive Lecture Video Player State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [videoProgress, setVideoProgress] = useState<number>(28);
  const [playbackSpeed, setPlaybackSpeed] = useState<'1.0x' | '1.25x' | '1.5x'>('1.0x');
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  // Student Note Input
  const [noteInput, setNoteInput] = useState<string>('');

  // Quiz State
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);

  // Selected Assignment Detail State
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [canManageAssignment, setCanManageAssignment] = useState<boolean>(false);

  // Instructor Forms
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [matModule, setMatModule] = useState('Module 2 · Core Concepts');
  const [matTitle, setMatTitle] = useState('');
  const [matBody, setMatBody] = useState('');
  const [matDuration, setMatDuration] = useState(20);
  const [matFileName, setMatFileName] = useState<string | null>(null);
  const [matFile, setMatFile] = useState<File | null>(null);

  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [asgnTitle, setAsgnTitle] = useState('');
  const [asgnDesc, setAsgnDesc] = useState('');
  const [asgnDue, setAsgnDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });
  const [asgnMax, setAsgnMax] = useState(100);

  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');

  // Student Submission Form
  const [subBody, setSubBody] = useState('');
  const [subFileName, setSubFileName] = useState<string | null>(null);
  const [subFile, setSubFile] = useState<File | null>(null);

  // Faculty Grading Form
  const [gradeInputs, setGradeInputs] = useState<Record<number, { grade: string; feedback: string }>>({});
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const fetchCourseDetail = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/courses/${courseId}`);
      if (res.ok) {
        const data = await res.json();
        setCourse(data.course);
        const mats: Material[] = data.materials || [];
        setMaterials(mats);
        setAssignments(data.assignments || []);
        setAnnouncements(data.announcements || []);
        setNotes(data.notes || []);
        setQuizQuestions(data.quiz_questions || []);
        return mats;
      }
    } finally {
      setLoading(false);
    }
    return [];
  };

  useEffect(() => {
    fetchCourseDetail().then((mats) => {
      if (initialMaterialId) {
        handleReadMaterial(initialMaterialId);
      } else if (mats.length > 0 && !openedMaterial) {
        handleReadMaterial(mats[0].id);
      }
    });
  }, [courseId, activeUserId]);

  useEffect(() => {
    if (initialAssignmentId) {
      setActiveSubTab('quizzes_assignments');
      handleOpenAssignment(initialAssignmentId);
    }
  }, [initialAssignmentId, activeUserId]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setVideoProgress((prev) => {
        if (prev >= 100) {
          setIsPlaying(false);
          return 100;
        }
        return prev + 1;
      });
    }, 350);
    return () => clearInterval(timer);
  }, [isPlaying]);

  const handleReadMaterial = async (materialId: number) => {
    const res = await apiFetch(`/api/materials/${materialId}`);
    if (res.ok) {
      const data = await res.json();
      setOpenedMaterial(data.material);
      setIsPlaying(false);
      setActiveSlideIndex(0);
      await fetchCourseDetail();
      await onRefreshBootstrap();
    }
  };

  const handleToggleComplete = async (materialId: number) => {
    const res = await apiFetch(`/api/materials/${materialId}/complete`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      if (openedMaterial && openedMaterial.id === materialId) {
        setOpenedMaterial({ ...openedMaterial, completed: data.completed });
      }
      setStatusBanner(
        data.completed
          ? 'Lesson marked complete! Your course progress gauge has been updated.'
          : 'Lesson marked as in-progress.'
      );
      await fetchCourseDetail();
      await onRefreshBootstrap();
    }
  };

  const handleToggleBookmark = async (materialId: number) => {
    const res = await apiFetch(`/api/materials/${materialId}/bookmark`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      if (openedMaterial && openedMaterial.id === materialId) {
        setOpenedMaterial({ ...openedMaterial, bookmarked: data.bookmarked });
      }
      await fetchCourseDetail();
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openedMaterial || !noteInput.trim()) return;
    const mins = Math.floor(((openedMaterial.duration_minutes || 20) * videoProgress) / 100);
    const secs = Math.floor((((openedMaterial.duration_minutes || 20) * 60 * videoProgress) / 100) % 60);
    const timestampLabel = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const res = await apiFetch(`/api/materials/${openedMaterial.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        content: noteInput,
        timestamp_label: timestampLabel,
      }),
    });
    if (res.ok) {
      setNoteInput('');
      setStatusBanner(`Note recorded at timestamp ${timestampLabel}.`);
      await fetchCourseDetail();
      await onRefreshBootstrap();
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    const res = await apiFetch(`/api/notes/${noteId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await fetchCourseDetail();
      await onRefreshBootstrap();
    }
  };

  const handleSubmitQuiz = async () => {
    if (quizQuestions.length === 0) return;
    let correct = 0;
    quizQuestions.forEach((q) => {
      if (selectedAnswers[q.id] === q.correct_index) correct += 1;
    });
    const score = Math.round((correct / quizQuestions.length) * 100);
    setQuizSubmitted(true);
    await apiFetch(`/api/courses/${courseId}/quiz`, {
      method: 'POST',
      body: JSON.stringify({ score }),
    });
    await fetchCourseDetail();
    await onRefreshBootstrap();
  };

  const handleOpenAssignment = async (assignmentId: number) => {
    const res = await apiFetch(`/api/assignments/${assignmentId}`);
    if (res.ok) {
      const data = await res.json();
      setSelectedAssignment(data.assignment);
      setCanManageAssignment(Boolean(data.can_manage));
      setSubBody(data.assignment.my_submission?.body || '');
      const initialGrades: Record<number, { grade: string; feedback: string }> = {};
      (data.assignment.submissions || []).forEach((s: Submission) => {
        initialGrades[s.id] = {
          grade: s.grade !== null ? String(s.grade) : '95',
          feedback: s.feedback || 'Clear reasoning and strong application of course concepts.',
        };
      });
      setGradeInputs(initialGrades);
    }
  };



  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('module_title', matModule);
    formData.append('title', matTitle);
    formData.append('body', matBody);
    formData.append('duration_minutes', String(matDuration));
    if (matFile) {
      formData.append('file', matFile);
    }
    const res = await apiFetch(`/api/courses/${courseId}/materials`, {
      method: 'POST',
      body: formData,
    });
    if (res.ok) {
      setMatTitle('');
      setMatBody('');
      setMatFileName(null);
      setMatFile(null);
      setShowAddMaterial(false);
      setStatusBanner('Lesson published and added to the course curriculum.');
      await fetchCourseDetail();
      await onRefreshBootstrap();
    } else {
      const data = await res.json().catch(() => null);
      setStatusBanner(data?.error || 'Failed to publish lesson material.');
    }
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch(`/api/courses/${courseId}/assignments`, {
      method: 'POST',
      body: JSON.stringify({
        title: asgnTitle,
        description: asgnDesc,
        due_at: asgnDue,
        max_score: asgnMax,
      }),
    });
    if (res.ok) {
      setAsgnTitle('');
      setAsgnDesc('');
      setShowAddAssignment(false);
      setStatusBanner('Assignment published · Enrolled students notified.');
      await fetchCourseDetail();
      await onRefreshBootstrap();
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch(`/api/courses/${courseId}/announcements`, {
      method: 'POST',
      body: JSON.stringify({ title: annTitle, body: annBody }),
    });
    if (res.ok) {
      setAnnTitle('');
      setAnnBody('');
      setShowAddAnnouncement(false);
      setStatusBanner('Announcement posted to course feed.');
      await fetchCourseDetail();
      await onRefreshBootstrap();
    }
  };

  const handleSubmitAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment) return;
    const formData = new FormData();
    formData.append('body', subBody);
    if (subFile) {
      formData.append('file', subFile);
    }
    const res = await apiFetch(`/api/assignments/${selectedAssignment.id}/submit`, {
      method: 'POST',
      body: formData,
    });
    if (res.ok) {
      setSubFileName(null);
      setSubFile(null);
      setStatusBanner('Assignment submitted! Your instructor will be notified.');
      await handleOpenAssignment(selectedAssignment.id);
      await fetchCourseDetail();
      await onRefreshBootstrap();
    } else {
      const data = await res.json().catch(() => null);
      setStatusBanner(data?.error || 'Failed to submit assignment.');
    }
  };

  const handleGradeSubmission = async (submissionId: number) => {
    if (!selectedAssignment) return;
    const input = gradeInputs[submissionId];
    if (!input) return;
    const res = await apiFetch(`/api/submissions/${submissionId}/grade`, {
      method: 'POST',
      body: JSON.stringify({
        grade: Number(input.grade),
        feedback: input.feedback,
      }),
    });
    if (res.ok) {
      setStatusBanner('Grade recorded · Student notification dispatched.');
      await handleOpenAssignment(selectedAssignment.id);
      await fetchCourseDetail();
      await onRefreshBootstrap();
    }
  };

  const groupedModules = useMemo(() => {
    const groups = new Map<string, Material[]>();
    materials.forEach((m) => {
      const mod = m.module_title || 'Module 1 · Core Lessons';
      const list = groups.get(mod) || [];
      list.push(m);
      groups.set(mod, list);
    });
    return Array.from(groups.entries());
  }, [materials]);

  const currentLessonIndex = useMemo(() => {
    if (!openedMaterial) return -1;
    return materials.findIndex((m) => m.id === openedMaterial.id);
  }, [materials, openedMaterial]);

  const prevLesson = currentLessonIndex > 0 ? materials[currentLessonIndex - 1] : null;
  const nextLesson =
    currentLessonIndex >= 0 && currentLessonIndex < materials.length - 1
      ? materials[currentLessonIndex + 1]
      : null;

  if (loading && !course) {
    return (
      <div className="skeuo-card p-8 space-y-4">
        <div className="h-6 w-52 skeuo-tray animate-pulse" />
        <div className="h-4 w-96 skeuo-tray animate-pulse" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="skeuo-card p-8">
        <p className="text-sm text-[#73777C]">Course not found.</p>
        <button onClick={onBack} className="mt-4 skeuo-btn px-4 py-2 text-xs">
          &larr; Back to Courses
        </button>
      </div>
    );
  }

  const canManageCourse =
    user.role === 'admin' || (user.role === 'faculty' && course.faculty_id === user.id);

  return (
    <div className="space-y-6">
      {/* Course Top Workstation Deck */}
      <div className="skeuo-card p-6 sm:p-7 space-y-6 relative">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#C6BEB0] pb-4">
          <button
            onClick={onBack}
            className="skeuo-btn inline-flex items-center gap-2 px-3.5 py-2 text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#315C83]" />
            Back to Courses
          </button>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[#73777C] font-mono">
            <span className="px-2.5 py-1 skeuo-display-panel font-bold text-[#315C83]">
              {course.code}
            </span>
            <span>·</span>
            <span className="font-sans font-semibold text-[#252B32]">{course.category}</span>
            <span>·</span>
            <span className="font-sans">Instructor: {course.faculty_name}</span>
            <span>·</span>
            <span className="tabular-nums">{course.student_count} enrolled</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          <div className="lg:col-span-8 space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] engraved-label">
              {course.title}
            </h1>
            <p className="text-sm text-[#73777C] leading-relaxed max-w-3xl">
              {course.description}
            </p>
          </div>

          {/* Physical Course Progress Readout Panel */}
          <div className="lg:col-span-4 skeuo-display-panel p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#252B32] engraved-label flex items-center gap-1.5">
                <span className="skeuo-led-blue" />
                Course Completion
              </span>
              <span className="font-mono font-bold text-[#315C83] tabular-nums">
                {course.completed_material_count}/{course.material_count} ({course.progress_percent}%)
              </span>
            </div>
            <div className="skeuo-progress-track h-3 w-full">
              <div
                className="skeuo-progress-fill-blue h-full"
                style={{ width: `${Math.max(4, course.progress_percent)}%` }}
              />
            </div>
            <p className="text-[11px] text-[#73777C] flex items-center justify-between font-mono">
              <span>Archive: {formatBytes(course.storage_used)}</span>
              {course.quiz_score !== null && course.quiz_score !== undefined && (
                <span className="font-bold text-[#54866A]">
                  Quiz Score: {course.quiz_score}%
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Physical Beveled Tab Switchbank */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="flex flex-wrap items-center gap-1.5 p-1.5 skeuo-tray">
            <button
              onClick={() => setActiveSubTab('lessons')}
              className={`px-4 py-2 text-xs font-semibold rounded-[7px] transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'lessons'
                  ? 'skeuo-btn-primary'
                  : 'skeuo-btn text-[#252B32]'
              }`}
            >
              Modules &amp; Lessons ({materials.length})
            </button>
            <button
              onClick={() => setActiveSubTab('notes')}
              className={`px-4 py-2 text-xs font-semibold rounded-[7px] transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'notes'
                  ? 'skeuo-btn-primary'
                  : 'skeuo-btn text-[#252B32]'
              }`}
            >
              Notes &amp; Bookmarks ({notes.length})
            </button>
            <button
              onClick={() => setActiveSubTab('quizzes_assignments')}
              className={`px-4 py-2 text-xs font-semibold rounded-[7px] transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'quizzes_assignments'
                  ? 'skeuo-btn-primary'
                  : 'skeuo-btn text-[#252B32]'
              }`}
            >
              Quizzes &amp; Assignments ({assignments.length})
            </button>
            <button
              onClick={() => setActiveSubTab('announcements')}
              className={`px-4 py-2 text-xs font-semibold rounded-[7px] transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'announcements'
                  ? 'skeuo-btn-primary'
                  : 'skeuo-btn text-[#252B32]'
              }`}
            >
              Announcements ({announcements.length})
            </button>
          </div>

          {canManageCourse && (
            <button
              onClick={() => {
                setActiveSubTab('lessons');
                setShowAddMaterial(!showAddMaterial);
              }}
              className="skeuo-btn-brass inline-flex items-center gap-1.5 px-4 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add New Lesson
            </button>
          )}
        </div>

        {statusBanner && (
          <div className="p-3.5 skeuo-display-panel text-[#252B32] text-xs font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="skeuo-led-green" />
              {statusBanner}
            </span>
            <button
              onClick={() => setStatusBanner(null)}
              className="font-bold underline ml-4 shrink-0 text-[#315C83] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: STRUCTURED MODULES & LESSON WORKSTATION */}
      {activeSubTab === 'lessons' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Structured Curriculum Ledger (4 cols) */}
          <div className="lg:col-span-4 skeuo-card p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-[#C6BEB0] pb-3">
              <div>
                <h2 className="text-base font-bold text-[#252B32] engraved-label">
                  Course Curriculum
                </h2>
                <p className="text-xs text-[#73777C]">
                  {course.completed_material_count} of {materials.length} lessons completed
                </p>
              </div>
            </div>

            {showAddMaterial && canManageCourse && (
              <form
                onSubmit={handleCreateMaterial}
                className="skeuo-tray p-4 space-y-3"
              >
                <h3 className="text-xs font-bold text-[#252B32]">Publish New Lesson</h3>
                <input
                  type="text"
                  required
                  placeholder="Module name (e.g. Module 3 · Memory)"
                  value={matModule}
                  onChange={(e) => setMatModule(e.target.value)}
                  className="skeuo-input w-full px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  required
                  placeholder="Lesson title"
                  value={matTitle}
                  onChange={(e) => setMatTitle(e.target.value)}
                  className="skeuo-input w-full px-3 py-2 text-xs"
                />
                <textarea
                  rows={4}
                  required
                  placeholder="Lecture content and notes..."
                  value={matBody}
                  onChange={(e) => setMatBody(e.target.value)}
                  className="skeuo-input w-full p-3 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#73777C] mb-1">Duration (mins)</label>
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={matDuration}
                      onChange={(e) => setMatDuration(Number(e.target.value))}
                      className="skeuo-input w-full px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#73777C] mb-1">Resource File</label>
                    <input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setMatFileName(file.name);
                          setMatFile(file);
                        } else {
                          setMatFileName(null);
                          setMatFile(null);
                        }
                      }}
                      className="text-[11px] text-[#73777C] w-full"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button type="submit" className="skeuo-btn-primary px-3.5 py-1.5 text-xs">
                    Publish Lesson
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddMaterial(false)}
                    className="skeuo-btn px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Module List */}
            <div className="space-y-4">
              {groupedModules.map(([modName, modLessons]) => (
                <div key={modName} className="space-y-2">
                  <div className="px-2 py-1 skeuo-tray flex items-center justify-between">
                    <span className="text-xs font-bold text-[#252B32] engraved-label">
                      {modName}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-[#315C83]">
                      {modLessons.filter((l) => l.completed).length}/{modLessons.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {modLessons.map((mat) => {
                      const isSelected = openedMaterial?.id === mat.id;
                      return (
                        <div
                          key={mat.id}
                          onClick={() => handleReadMaterial(mat.id)}
                          className={`p-3.5 transition-all ${
                            isSelected ? 'skeuo-nav-item-active' : 'skeuo-nav-item'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleComplete(mat.id);
                              }}
                              className="mt-0.5 shrink-0 cursor-pointer"
                              title={mat.completed ? 'Completed' : 'Mark lesson complete'}
                            >
                              {mat.completed ? (
                                <CheckCircle2 className="w-4 h-4 text-[#54866A]" />
                              ) : (
                                <Circle className="w-4 h-4 text-[#73777C]" />
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between text-[11px] text-[#73777C] font-mono">
                                <span className={isSelected ? 'text-[#315C83] font-bold' : ''}>
                                  Lesson {mat.lesson_number}
                                </span>
                                <span>{mat.duration_minutes} min</span>
                              </div>
                              <h3
                                className={`text-xs font-bold mt-0.5 leading-snug ${
                                  isSelected ? 'text-[#252B32]' : 'text-[#252B32]'
                                }`}
                              >
                                {mat.title}
                              </h3>
                              <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-[#73777C]">
                                {mat.completed ? (
                                  <span className="text-[#54866A] font-bold">● Completed</span>
                                ) : (
                                  <span>In progress</span>
                                )}
                                {mat.original_name && (
                                  <>
                                    <span>·</span>
                                    <span className="text-[#315C83] font-bold">Attachment</span>
                                  </>
                                )}
                                {mat.bookmarked && (
                                  <>
                                    <span>·</span>
                                    <span className="text-[#B58A54] font-bold">★ Bookmarked</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Skeuomorphic Video Deck, Lecture Notes, Resources & Controls (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {openedMaterial ? (
              <div className="skeuo-card p-6 sm:p-7 space-y-6">
                {/* Physical Recessed Instrument Screen Stage */}
                <div className="skeuo-instrument-screen p-6 sm:p-7 space-y-6 text-[#F4F0E8]">
                  {/* Top Bezel Readout */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#D8D1C5]/80 border-b border-white/10 pb-3">
                    <span className="font-mono font-semibold text-[#B58A54] flex items-center gap-2">
                      <span className="skeuo-led-green" />
                      {openedMaterial.course_code} · LESSON {openedMaterial.lesson_number} OF {materials.length}
                    </span>
                    <span className="font-mono text-[#D8D1C5]">
                      DURATION: {openedMaterial.duration_minutes || 20}:00
                    </span>
                  </div>

                  {/* Interactive Slide / Visual Concept Stage */}
                  <div className="p-5 rounded-[8px] bg-black/25 border border-white/10 space-y-3.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#B58A54]">
                      {openedMaterial.module_title}
                    </p>
                    <h2 className="text-xl sm:text-2xl font-bold text-[#F4F0E8]">
                      {openedMaterial.title}
                    </h2>
                    <p className="text-sm text-[#D8D1C5] leading-relaxed max-w-2xl">
                      {openedMaterial.video_summary ||
                        'Interactive video walkthrough and annotated lecture deck covering core concepts and worked examples.'}
                    </p>

                    {openedMaterial.key_takeaways && openedMaterial.key_takeaways.length > 0 && (
                      <div className="p-3.5 rounded-[7px] bg-[#315C83]/25 border border-[#315C83]/50 space-y-1">
                        <p className="text-xs font-bold text-[#B58A54] font-mono">
                          SLIDE DECK NOTE ({activeSlideIndex + 1}/{openedMaterial.key_takeaways.length}):
                        </p>
                        <p className="text-xs sm:text-sm text-[#F4F0E8] font-medium">
                          &ldquo;{openedMaterial.key_takeaways[activeSlideIndex % openedMaterial.key_takeaways.length]}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Physical Transport Controls */}
                  <div className="space-y-4">
                    {/* Scrubber Bar */}
                    <div
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                        setVideoProgress(Math.max(0, Math.min(100, pct)));
                      }}
                      className="skeuo-progress-track h-3 w-full cursor-pointer"
                    >
                      <div
                        className="skeuo-progress-fill-brass h-full"
                        style={{ width: `${videoProgress}%` }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setIsPlaying(!isPlaying)}
                          className="skeuo-btn-brass px-4 py-2 inline-flex items-center gap-1.5 text-xs"
                        >
                          {isPlaying ? (
                            <>
                              <Pause className="w-3.5 h-3.5" /> Pause Deck
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5" /> Play Lecture
                            </>
                          )}
                        </button>

                        {openedMaterial.key_takeaways && openedMaterial.key_takeaways.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setActiveSlideIndex(
                                (activeSlideIndex + 1) % (openedMaterial.key_takeaways?.length || 1)
                              )
                            }
                            className="skeuo-btn px-3.5 py-2 text-xs"
                          >
                            Next Slide &rarr;
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-3 font-mono text-[#D8D1C5] tabular-nums">
                        <Volume2 className="w-4 h-4 text-[#B58A54]" />
                        <span>
                          {Math.floor(((openedMaterial.duration_minutes || 20) * videoProgress) / 100)}:00 /{' '}
                          {openedMaterial.duration_minutes || 20}:00
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPlaybackSpeed(
                              playbackSpeed === '1.0x'
                                ? '1.25x'
                                : playbackSpeed === '1.25x'
                                ? '1.5x'
                                : '1.0x'
                            )
                          }
                          className="skeuo-btn px-2.5 py-1 text-xs font-bold"
                        >
                          {playbackSpeed}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lesson Action Bar: Complete, Bookmark, Resource Download */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#C6BEB0]">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleToggleComplete(openedMaterial.id)}
                      className={`px-4 py-2.5 text-xs inline-flex items-center gap-2 ${
                        openedMaterial.completed
                          ? 'skeuo-btn skeuo-btn-pressed text-[#54866A]'
                          : 'skeuo-btn-primary'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {openedMaterial.completed ? 'Lesson Completed' : 'Mark Lesson Complete'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleBookmark(openedMaterial.id)}
                      className={`skeuo-btn px-3.5 py-2.5 text-xs inline-flex items-center gap-1.5 ${
                        openedMaterial.bookmarked ? 'skeuo-btn-pressed text-[#B58A54]' : ''
                      }`}
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      {openedMaterial.bookmarked ? 'Bookmarked' : 'Bookmark'}
                    </button>
                  </div>

                  {openedMaterial.stored_name && (
                    <button
                      type="button"
                      onClick={() => {
                        downloadFileWithAuth(
                          `/api/materials/${openedMaterial.id}/download`,
                          openedMaterial.original_name || 'material.bin'
                        ).catch((err) =>
                          setStatusBanner(err instanceof Error ? err.message : 'Download failed')
                        );
                      }}
                      className="skeuo-btn-brass inline-flex items-center gap-2 px-4 py-2.5 text-xs cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download {openedMaterial.original_name} ({formatBytes(openedMaterial.file_size)})
                    </button>
                  )}
                </div>

                {/* Written Lecture Notebook Sheet */}
                <div className="space-y-2.5">
                  <h3 className="text-base font-bold text-[#252B32] engraved-label">
                    Lecture Manuscript &amp; Reference Notes
                  </h3>
                  <div className="text-sm text-[#252B32] leading-relaxed whitespace-pre-line skeuo-tray p-5">
                    {openedMaterial.body}
                  </div>
                </div>

                {/* Quick Note Adder inside Lesson Viewer */}
                <form onSubmit={handleSaveNote} className="skeuo-tray p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#252B32] flex items-center gap-1.5 engraved-label">
                      <MessageSquare className="w-3.5 h-3.5 text-[#315C83]" />
                      Record Personal Study Note for This Lesson
                    </label>
                    <span className="text-[11px] font-mono text-[#73777C]">
                      Filed under Notes &amp; Bookmarks
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="text"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Enter a formula, definition, or observation..."
                      className="skeuo-input flex-1 px-3.5 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      className="skeuo-btn-primary px-5 py-2 text-xs whitespace-nowrap shrink-0"
                    >
                      Record Note
                    </button>
                  </div>
                </form>

                {/* Previous Lesson / Next Lesson Navigation Controls */}
                <div className="flex items-center justify-between gap-4 pt-3 border-t border-[#C6BEB0]">
                  {prevLesson ? (
                    <button
                      type="button"
                      onClick={() => handleReadMaterial(prevLesson.id)}
                      className="skeuo-btn px-4 py-2.5 text-xs inline-flex items-center gap-2"
                    >
                      <ChevronLeft className="w-4 h-4 text-[#315C83]" />
                      Previous: {prevLesson.title.slice(0, 28)}
                    </button>
                  ) : (
                    <div />
                  )}

                  {nextLesson ? (
                    <button
                      type="button"
                      onClick={() => handleReadMaterial(nextLesson.id)}
                      className="skeuo-btn-primary px-4 py-2.5 text-xs inline-flex items-center gap-2"
                    >
                      Next: {nextLesson.title.slice(0, 28)}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveSubTab('quizzes_assignments')}
                      className="skeuo-btn-primary px-4 py-2.5 text-xs inline-flex items-center gap-2"
                    >
                      Proceed to Course Quiz &amp; Assignments
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="skeuo-card p-12 text-center space-y-3">
                <BookOpen className="w-8 h-8 text-[#73777C] mx-auto" />
                <h3 className="text-base font-bold text-[#252B32]">Select a Lesson to Begin</h3>
                <p className="text-xs text-[#73777C] max-w-md mx-auto">
                  Choose any lesson from the curriculum panel on the left to load the lecture deck.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PERSONAL NOTES & BOOKMARKS */}
      {activeSubTab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 skeuo-card p-6 space-y-4">
            <h2 className="text-base font-bold text-[#252B32] engraved-label">
              Saved Lesson Notes ({notes.length})
            </h2>
            {notes.length === 0 ? (
              <div className="skeuo-tray p-8 text-center">
                <p className="text-xs text-[#73777C]">
                  No study notes recorded for {course.code} yet. Use the note recorder below any lesson player to save timestamped annotations.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {notes.map((n) => (
                  <div
                    key={n.id}
                    className="p-4 skeuo-tray flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-[#73777C] font-mono">
                        <span className="font-bold text-[#315C83]">@{n.timestamp_label}</span>
                        <span>·</span>
                        <button
                          onClick={() => {
                            setActiveSubTab('lessons');
                            handleReadMaterial(n.material_id);
                          }}
                          className="font-sans font-bold text-[#252B32] hover:text-[#315C83] hover:underline cursor-pointer"
                        >
                          {n.material_title}
                        </button>
                      </div>
                      <p className="text-sm text-[#252B32]">{n.content}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteNote(n.id)}
                      className="skeuo-btn p-1.5 text-[#73777C] hover:text-[#B85C55] shrink-0"
                      title="Delete note"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 skeuo-card p-6 space-y-4">
            <h2 className="text-base font-bold text-[#252B32] engraved-label">
              Bookmarked Lessons ({materials.filter((m) => m.bookmarked).length})
            </h2>
            {materials.filter((m) => m.bookmarked).length === 0 ? (
              <div className="skeuo-tray p-8 text-center">
                <p className="text-xs text-[#73777C]">
                  Press the Bookmark switch inside any lesson to pin it here for exam review.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {materials
                  .filter((m) => m.bookmarked)
                  .map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        setActiveSubTab('lessons');
                        handleReadMaterial(m.id);
                      }}
                      className="p-3.5 skeuo-nav-item flex items-center justify-between"
                    >
                      <div>
                        <p className="text-[11px] font-mono text-[#B58A54] font-bold">
                          ★ Lesson {m.lesson_number} · {m.duration_minutes} min
                        </p>
                        <p className="text-xs font-bold text-[#252B32] mt-0.5">{m.title}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#315C83]" />
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: QUIZZES & ASSIGNMENTS */}
      {activeSubTab === 'quizzes_assignments' && (
        <div className="space-y-6">
          {/* Interactive Course Knowledge Check Quiz */}
          {quizQuestions.length > 0 && (
            <div className="skeuo-card p-6 sm:p-7 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#C6BEB0] pb-3">
                <div>
                  <p className="text-xs font-bold text-[#315C83] uppercase tracking-wider">
                    Interactive Self-Check Assessment
                  </p>
                  <h2 className="text-lg font-bold text-[#252B32] mt-0.5 engraved-label">
                    {course.code} Concept Mastery Check
                  </h2>
                </div>
                {course.quiz_score !== null && course.quiz_score !== undefined && (
                  <span className="text-xs font-mono font-bold text-[#54866A] skeuo-display-panel px-3.5 py-2">
                    Best Recorded Score: {course.quiz_score}%
                  </span>
                )}
              </div>

              <div className="space-y-4">
                {quizQuestions.map((q, qIdx) => (
                  <div key={q.id} className="p-5 skeuo-tray space-y-3.5">
                    <p className="text-sm font-bold text-[#252B32]">
                      {qIdx + 1}. {q.question}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {q.options.map((opt, oIdx) => {
                        const chosen = selectedAnswers[q.id] === oIdx;
                        const isCorrect = q.correct_index === oIdx;
                        return (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() => {
                              setQuizSubmitted(false);
                              setSelectedAnswers({ ...selectedAnswers, [q.id]: oIdx });
                            }}
                            className={`p-3 text-left text-xs font-medium transition-all ${
                              quizSubmitted
                                ? isCorrect
                                  ? 'skeuo-nav-item-active text-[#54866A] border-[#54866A]'
                                  : chosen
                                  ? 'skeuo-nav-item-active text-[#B85C55] border-[#B85C55]'
                                  : 'skeuo-nav-item text-[#73777C]'
                                : chosen
                                ? 'skeuo-btn-primary'
                                : 'skeuo-btn text-[#252B32]'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                    {quizSubmitted && (
                      <p className="text-xs text-[#315C83] pt-1 font-medium">
                        <strong>Explanation:</strong> {q.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSubmitQuiz}
                  className="skeuo-btn-primary px-5 py-2.5 text-xs"
                >
                  Check Quiz Answers &amp; Record Score
                </button>
                {quizSubmitted && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuizSubmitted(false);
                      setSelectedAnswers({});
                    }}
                    className="skeuo-btn px-4 py-2.5 text-xs"
                  >
                    Reset Quiz
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Course Assignments & Submissions Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 skeuo-card p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#C6BEB0] pb-3">
                <div>
                  <h2 className="text-base font-bold text-[#252B32] engraved-label">
                    Course Assignments
                  </h2>
                  <p className="text-xs text-[#73777C]">Select an assignment to submit or review</p>
                </div>
                {canManageCourse && (
                  <button
                    onClick={() => setShowAddAssignment(!showAddAssignment)}
                    className="skeuo-btn-brass px-3 py-1.5 text-xs inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </button>
                )}
              </div>

              {showAddAssignment && canManageCourse && (
                <form onSubmit={handleCreateAssignment} className="skeuo-tray p-4 space-y-3">
                  <input
                    type="text"
                    required
                    placeholder="Assignment title"
                    value={asgnTitle}
                    onChange={(e) => setAsgnTitle(e.target.value)}
                    className="skeuo-input w-full px-3 py-2 text-xs"
                  />
                  <textarea
                    rows={3}
                    required
                    placeholder="Assignment prompt..."
                    value={asgnDesc}
                    onChange={(e) => setAsgnDesc(e.target.value)}
                    className="skeuo-input w-full p-3 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="datetime-local"
                      required
                      value={asgnDue}
                      onChange={(e) => setAsgnDue(e.target.value)}
                      className="skeuo-input px-2.5 py-1.5 text-xs font-mono"
                    />
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={asgnMax}
                      onChange={(e) => setAsgnMax(Number(e.target.value))}
                      className="skeuo-input px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <button type="submit" className="skeuo-btn-primary px-4 py-1.5 text-xs">
                    Publish Assignment
                  </button>
                </form>
              )}

              <div className="space-y-2.5">
                {assignments.map((asgn) => {
                  const isSelected = selectedAssignment?.id === asgn.id;
                  return (
                    <div
                      key={asgn.id}
                      onClick={() => handleOpenAssignment(asgn.id)}
                      className={`p-4 transition-all ${
                        isSelected ? 'skeuo-nav-item-active' : 'skeuo-nav-item'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono text-[#73777C]">
                        <span>Due {asgn.due_at.replace('T', ' ')}</span>
                        <span>{asgn.max_score} pts</span>
                      </div>
                      <h3 className="text-sm font-bold text-[#252B32] mt-1">{asgn.title}</h3>
                      <div className="mt-2 flex items-center gap-2 text-xs font-mono">
                        {asgn.my_submission ? (
                          asgn.my_submission.grade !== null ? (
                            <span className="text-[#54866A] font-bold">
                              ● Graded: {asgn.my_submission.grade}/{asgn.max_score}
                            </span>
                          ) : (
                            <span className="text-[#315C83] font-bold">◆ Submitted</span>
                          )
                        ) : (
                          <span className="text-[#D49A43] font-bold">▲ Pending submission</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-7 skeuo-card p-6 space-y-6">
              {selectedAssignment ? (
                <>
                  <div className="border-b border-[#C6BEB0] pb-4">
                    <p className="text-xs font-mono text-[#73777C]">
                      {selectedAssignment.course_code} · Due {selectedAssignment.due_at.replace('T', ' ')} · Max {selectedAssignment.max_score} pts
                    </p>
                    <h2 className="text-xl font-bold text-[#252B32] mt-1 engraved-label">
                      {selectedAssignment.title}
                    </h2>
                    <p className="text-sm text-[#73777C] mt-2 whitespace-pre-line">
                      {selectedAssignment.description}
                    </p>
                  </div>

                  {user.role === 'student' && (
                    <form onSubmit={handleSubmitAssignment} className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[#252B32]">
                          Your Submission ({user.full_name})
                        </h3>
                        {selectedAssignment.my_submission?.grade !== null &&
                          selectedAssignment.my_submission?.grade !== undefined && (
                            <span className="text-sm font-mono font-bold text-[#54866A]">
                              ● Score: {selectedAssignment.my_submission.grade}/{selectedAssignment.max_score}
                            </span>
                          )}
                      </div>

                      {selectedAssignment.my_submission?.feedback && (
                        <div className="p-4 skeuo-tray text-xs text-[#54866A]">
                          <p className="font-bold">Instructor Feedback:</p>
                          <p className="mt-1 text-[#252B32]">{selectedAssignment.my_submission.feedback}</p>
                        </div>
                      )}

                      <textarea
                        rows={5}
                        required={!subFileName}
                        placeholder="Write your assignment response or reflection..."
                        value={subBody}
                        onChange={(e) => setSubBody(e.target.value)}
                        className="skeuo-input w-full p-4 text-sm"
                      />

                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <label className="block text-xs text-[#73777C] mb-1">
                            Attach File (optional, &le; 5 MB)
                          </label>
                          <input
                            type="file"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setSubFileName(file.name);
                                setSubFile(file);
                              } else {
                                setSubFileName(null);
                                setSubFile(null);
                              }
                            }}
                            className="text-xs text-[#73777C]"
                          />
                        </div>

                        <button
                          type="submit"
                          className="skeuo-btn-primary px-5 py-2.5 text-xs inline-flex items-center gap-2"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {selectedAssignment.my_submission ? 'Update Submission' : 'Submit Assignment'}
                        </button>
                      </div>
                    </form>
                  )}

                  {canManageAssignment && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold text-[#252B32]">
                        Student Submissions ({selectedAssignment.submissions?.length || 0})
                      </h3>
                      {(!selectedAssignment.submissions ||
                        selectedAssignment.submissions.length === 0) ? (
                        <div className="skeuo-tray p-6 text-center text-xs text-[#73777C]">
                          No student submissions yet. Switch to <strong>Student (Hritwiz)</strong> to submit work, then switch back to <strong>Faculty (Ayushi)</strong> to grade it.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {selectedAssignment.submissions.map((sub) => {
                            const gState = gradeInputs[sub.id] || {
                              grade: sub.grade !== null ? String(sub.grade) : '95',
                              feedback: sub.feedback || '',
                            };
                            return (
                              <div
                                key={sub.id}
                                className="p-4 skeuo-tray space-y-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="font-bold text-[#252B32]">
                                    {sub.student_name} (@{sub.student_username})
                                  </span>
                                  {sub.stored_name && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        downloadFileWithAuth(
                                          `/api/submissions/${sub.id}/download`,
                                          sub.original_name || 'submission.bin'
                                        ).catch((err) =>
                                          setStatusBanner(err instanceof Error ? err.message : 'Download failed')
                                        );
                                      }}
                                      className="font-mono text-[#315C83] underline inline-flex items-center gap-1 cursor-pointer bg-transparent border-none p-0"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      {sub.original_name}
                                    </button>
                                  )}
                                </div>
                                <div className="p-3 skeuo-card text-xs text-[#252B32] whitespace-pre-line">
                                  {sub.body || '(File attachment submission)'}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                                  <div className="sm:col-span-3">
                                    <label className="block text-[11px] font-semibold text-[#73777C] mb-1">
                                      Score (/ {selectedAssignment.max_score})
                                    </label>
                                    <input
                                      type="number"
                                      min={0}
                                      max={selectedAssignment.max_score}
                                      step="0.5"
                                      value={gState.grade}
                                      onChange={(e) =>
                                        setGradeInputs({
                                          ...gradeInputs,
                                          [sub.id]: { ...gState, grade: e.target.value },
                                        })
                                      }
                                      className="skeuo-input w-full px-2.5 py-1.5 text-xs font-mono"
                                    />
                                  </div>
                                  <div className="sm:col-span-6">
                                    <label className="block text-[11px] font-semibold text-[#73777C] mb-1">
                                      Feedback
                                    </label>
                                    <input
                                      type="text"
                                      value={gState.feedback}
                                      onChange={(e) =>
                                        setGradeInputs({
                                          ...gradeInputs,
                                          [sub.id]: { ...gState, feedback: e.target.value },
                                        })
                                      }
                                      className="skeuo-input w-full px-3 py-1.5 text-xs"
                                    />
                                  </div>
                                  <div className="sm:col-span-3">
                                    <button
                                      type="button"
                                      onClick={() => handleGradeSubmission(sub.id)}
                                      className="skeuo-btn-primary w-full py-1.5 text-xs"
                                    >
                                      Record Grade
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center space-y-2">
                  <Award className="w-8 h-8 text-[#73777C] mx-auto" />
                  <h3 className="text-sm font-bold text-[#252B32]">
                    Select an Assignment on the Left
                  </h3>
                  <p className="text-xs text-[#73777C]">
                    Submit written work, upload files, or review instructor grades and feedback.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: COURSE ANNOUNCEMENTS */}
      {activeSubTab === 'announcements' && (
        <div className="skeuo-card p-6 sm:p-7 space-y-5">
          <div className="flex items-center justify-between border-b border-[#C6BEB0] pb-3">
            <div>
              <h2 className="text-base font-bold text-[#252B32] engraved-label">
                Course Bulletin &amp; Announcements
              </h2>
              <p className="text-xs text-[#73777C]">
                Official dispatches from {course.faculty_name} for {course.code}
              </p>
            </div>
            {canManageCourse && (
              <button
                onClick={() => setShowAddAnnouncement(!showAddAnnouncement)}
                className="skeuo-btn-brass px-4 py-2 text-xs inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Post Dispatch
              </button>
            )}
          </div>

          {showAddAnnouncement && canManageCourse && (
            <form onSubmit={handleCreateAnnouncement} className="skeuo-tray p-4 space-y-3">
              <input
                type="text"
                required
                placeholder="Announcement headline"
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                className="skeuo-input w-full px-3 py-2 text-xs"
              />
              <textarea
                rows={3}
                required
                placeholder="Announcement message..."
                value={annBody}
                onChange={(e) => setAnnBody(e.target.value)}
                className="skeuo-input w-full p-3 text-xs"
              />
              <button type="submit" className="skeuo-btn-primary px-4 py-2 text-xs">
                Publish Announcement
              </button>
            </form>
          )}

          <div className="space-y-3">
            {announcements.map((ann) => (
              <div key={ann.id} className="p-4 skeuo-tray space-y-1">
                <div className="flex items-center gap-2 text-xs text-[#73777C] font-mono">
                  <span className="text-[#315C83] font-bold">{ann.author_name}</span>
                  <span>·</span>
                  <span>{ann.created_at.replace('T', ' ').slice(0, 16)}</span>
                </div>
                <h3 className="text-sm font-bold text-[#252B32]">{ann.title}</h3>
                <p className="text-sm text-[#73777C] whitespace-pre-line">{ann.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

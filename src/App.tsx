import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  User,
  Course,
  Assignment,
  Announcement,
  NotificationItem,
  SearchResultItem,
  StudentNote,
  ScheduleEvent,
  WeeklyActivityDay,
} from './types/lms';
import { CourseWorkspaceView } from './components/CourseWorkspaceView';
import { AdminDashboardView, AdminSection } from './components/AdminDashboardView';
import { TeacherDashboardView, TeacherSection } from './components/TeacherDashboardView';
import { StudentDashboardView, StudentSection } from './components/StudentDashboardView';
import { UnifiedAuthView, AuthSessionResponse } from './components/UnifiedAuthView';
import { signOutFromFirebase } from './utils/firebase';
import {
  setSessionToken as syncSessionToken,
  getSessionToken,
  saveAuthSession,
  clearAuthSession,
  AUTH_STORAGE_KEY,
} from './utils/api';
import {
  LayoutDashboard,
  BookOpen,
  Compass,
  FileCheck2,
  Calendar,
  BarChart3,
  Award,
  User as UserIcon,
  Settings,
  Search,
  Bell,
  ChevronDown,
  Flame,
  Clock,
  CheckCircle2,
  ArrowRight,
  Plus,
  Download,
  Menu,
  X,
  Trash2,
  Printer,
  Code2,
  Palette,
  Gamepad2,
  Database,
  Users,
  GraduationCap,
  Megaphone,
  LogOut,
} from 'lucide-react';

type NavView =
  | 'dashboard'
  | 'my-courses'
  | 'explore'
  | 'course-detail'
  | 'assignments'
  | 'schedule'
  | 'progress'
  | 'certificates'
  | 'profile'
  | 'settings'
  | 'search'
  | AdminSection
  | TeacherSection
  | StudentSection;

/**
 * Physical Educational Media Cover Panel for Course Cards
 * Features a recessed dark slate plate with technical blueprint lines, brass/blue accents,
 * and an engraved specification badge.
 */
function CourseMediaCover({ course }: { course: Course }) {
  const isCS = course.category.toLowerCase().includes('computer') || course.code.startsWith('OS');
  const isArt = course.category.toLowerCase().includes('art') || course.code.startsWith('DRW');
  const isGame = course.category.toLowerCase().includes('game') || course.code.startsWith('GAM');

  return (
    <div className="skeuo-media-frame h-36 w-full p-3.5 flex flex-col justify-between relative overflow-hidden">
      {/* Subtle Blueprint Grid & Schematic SVG */}
      <svg
        viewBox="0 0 260 110"
        className="absolute inset-0 w-full h-full opacity-85 pointer-events-none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id={`grid-${course.id}`} width="18" height="18" patternUnits="userSpaceOnUse">
            <path
              d="M 18 0 L 0 0 0 18"
              fill="none"
              stroke="#B58A54"
              strokeWidth="0.4"
              strokeOpacity="0.22"
            />
          </pattern>
        </defs>
        <rect width="260" height="110" fill={`url(#grid-${course.id})`} />
        <circle cx="205" cy="55" r="36" stroke="#B58A54" strokeOpacity="0.35" strokeWidth="1.5" />
        <circle
          cx="205"
          cy="55"
          r="24"
          stroke="#4B7EAE"
          strokeOpacity="0.45"
          strokeWidth="1.2"
          strokeDasharray="3 3"
        />
        <path
          d="M18 82 L68 54 L112 68 L162 34"
          stroke="#B58A54"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="68" cy="54" r="3.5" fill="#B58A54" />
        <circle cx="112" cy="68" r="3.5" fill="#4B7EAE" />
        <circle cx="162" cy="34" r="4" fill="#54866A" />
      </svg>

      {/* Top Row: Course Code Plate + LED */}
      <div className="relative z-10 flex items-center justify-between">
        <span className="px-2.5 py-0.5 rounded-[5px] bg-[#181D23]/90 border border-[#B58A54]/50 text-[11px] font-mono font-bold text-[#F4F0E8] tracking-wide">
          {course.code}
        </span>
        <span className="px-2 py-0.5 rounded-[5px] bg-[#181D23]/80 border border-white/15 text-[10px] font-mono text-[#D8D1C5]">
          {course.level.toUpperCase()}
        </span>
      </div>

      {/* Bottom Row: Physical Emblem + Category */}
      <div className="relative z-10 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#B58A54]">
            {course.category}
          </p>
          <p className="text-xs font-mono text-[#F4F0E8]/90">
            {course.material_count} Modules · {course.estimated_hours}h
          </p>
        </div>

        <div className="w-10 h-10 rounded-[8px] bg-gradient-to-b from-[#3A434E] to-[#232931] border border-[#B58A54]/50 shadow-md flex items-center justify-center">
          {isCS ? (
            <Code2 className="w-5 h-5 text-[#B58A54]" />
          ) : isArt ? (
            <Palette className="w-5 h-5 text-[#54866A]" />
          ) : isGame ? (
            <Gamepad2 className="w-5 h-5 text-[#D49A43]" />
          ) : (
            <Database className="w-5 h-5 text-[#6CA6DA]" />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeUserId, setActiveUserId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.userId === 'number') return parsed.userId;
      }
    } catch {
      // Ignore storage parse error
    }
    return null;
  });
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.sessionToken === 'string') return parsed.sessionToken;
      }
    } catch {
      // Ignore storage parse error
    }
    return null;
  });

  const [user, setUser] = useState<User | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([]);
  const [weeklyActivity, setWeeklyActivity] = useState<WeeklyActivityDay[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [demoModeEnabled, setDemoModeEnabled] = useState<boolean>(true);

  const [view, setView] = useState<NavView>('dashboard');
  const [authViewOpen, setAuthViewOpen] = useState<boolean>(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('login');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [notifOpen, setNotifOpen] = useState<boolean>(false);
  const [profileOpen, setProfileOpen] = useState<boolean>(false);

  // Course Workspace Selection
  const [selectedCourseId, setSelectedCourseId] = useState<number>(1);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);

  // Search & Filter States
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [myCourseFilter, setMyCourseFilter] = useState<'all' | 'in-progress' | 'completed'>('all');
  const [catalogCategory, setCatalogCategory] = useState<string>('All');
  const [assignmentFilter, setAssignmentFilter] = useState<
    'all' | 'pending' | 'submitted' | 'graded'
  >('all');

  // New Course Modal
  const [showNewCourse, setShowNewCourse] = useState<boolean>(false);
  const [newCourseCode, setNewCourseCode] = useState<string>('');
  const [newCourseTitle, setNewCourseTitle] = useState<string>('');
  const [newCourseCategory, setNewCourseCategory] = useState<string>('Computer Science');
  const [newCourseDesc, setNewCourseDesc] = useState<string>('');

  // Schedule Event Form
  const [schedTitle, setSchedTitle] = useState<string>('');
  const [schedCourse, setSchedCourse] = useState<string>('OS101');
  const [schedDay, setSchedDay] = useState<string>('Wednesday');
  const [schedTime, setSchedTime] = useState<string>('04:00 PM');
  const [schedType, setSchedType] = useState<'study' | 'lecture' | 'workshop' | 'deadline'>('study');

  // Certificate Modal
  const [previewCertCourse, setPreviewCertCourse] = useState<Course | null>(null);

  // Profile Settings Form
  const [profName, setProfName] = useState<string>('');
  const [profEmail, setProfEmail] = useState<string>('');
  const [profBio, setProfBio] = useState<string>('');
  const [profGoal, setProfGoal] = useState<number>(16);
  const [profNotifs, setProfNotifs] = useState<boolean>(true);
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const notifyToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  useEffect(() => {
    syncSessionToken(sessionToken);
  }, [sessionToken]);

  useEffect(() => {
    const handleExpired = () => {
      if (activeUserId || sessionToken || getSessionToken()) {
        clearAuthSession();
        setActiveUserId(null);
        setSessionToken(null);
        setUser(null);
        notifyToast('Your session has expired. Please sign in again.');
      }
    };
    window.addEventListener('lms:session-expired', handleExpired);
    return () => window.removeEventListener('lms:session-expired', handleExpired);
  }, [activeUserId, sessionToken, notifyToast]);

  const buildAuthHeaders = useCallback(
    (_uid = activeUserId, token = sessionToken, extra: Record<string, string> = {}) => {
      const headers: Record<string, string> = { ...extra };
      const currentToken = token || getSessionToken();
      if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
        headers['x-lms-session-token'] = currentToken;
      }
      return headers;
    },
    [activeUserId, sessionToken]
  );

  const fetchBootstrap = useCallback(
    async (uid = activeUserId, token = sessionToken) => {
      if (!uid) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch('/api/bootstrap', {
          headers: buildAuthHeaders(uid, token),
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setCourses(data.courses || []);
          setAssignments(data.assignments || []);
          setAnnouncements(data.announcements || []);
          setNotifications(data.notifications || []);
          setNotes(data.notes || []);
          setSchedule(data.schedule || []);
          setWeeklyActivity(data.weekly_activity || []);

          setProfName(data.user.full_name || '');
          setProfEmail(data.user.email || '');
          setProfBio(data.user.bio || '');
          setProfGoal(data.user.weekly_goal_hours || 16);
          setProfNotifs(data.user.notifications_enabled ?? true);
        } else if (res.status === 401 || res.status === 403) {
          clearAuthSession();
          setUser(null);
          setActiveUserId(null);
          setSessionToken(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [activeUserId, sessionToken, buildAuthHeaders]
  );

  useEffect(() => {
    fetch('/api/auth/demo-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info && typeof info.demo_mode_enabled === 'boolean') {
          setDemoModeEnabled(info.demo_mode_enabled);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchBootstrap(activeUserId, sessionToken);
  }, [activeUserId, sessionToken, fetchBootstrap]);

  const executeSearch = useCallback(
    async (q: string) => {
      if (!activeUserId) return;
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        headers: buildAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    },
    [activeUserId, buildAuthHeaders]
  );

  const handleOpenCourse = (
    courseId: number,
    assignmentId: number | null = null,
    materialId: number | null = null
  ) => {
    setSelectedCourseId(courseId);
    setSelectedAssignmentId(assignmentId);
    setSelectedMaterialId(materialId);
    setView('course-detail');
    setMobileMenuOpen(false);
  };

  const handleEnroll = async (courseId: number) => {
    if (!activeUserId) return;
    const res = await fetch(`/api/courses/${courseId}/enroll`, {
      method: 'POST',
      headers: buildAuthHeaders(),
    });
    if (res.ok) {
      await fetchBootstrap(activeUserId, sessionToken);
      handleOpenCourse(courseId);
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUserId) return;
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: buildAuthHeaders(activeUserId, sessionToken, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        code: newCourseCode,
        title: newCourseTitle,
        category: newCourseCategory,
        description: newCourseDesc,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewCourseCode('');
      setNewCourseTitle('');
      setNewCourseDesc('');
      setShowNewCourse(false);
      await fetchBootstrap(activeUserId, sessionToken);
      handleOpenCourse(data.course.id);
    }
  };

  const handleAddScheduleEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedTitle.trim() || !activeUserId) return;
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: buildAuthHeaders(activeUserId, sessionToken, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        title: schedTitle,
        course_code: schedCourse,
        date: schedDay,
        time: schedTime,
        duration_label: '60 min',
        type: schedType,
        location: 'Personal Study Space',
      }),
    });
    if (res.ok) {
      setSchedTitle('');
      await fetchBootstrap(activeUserId, sessionToken);
    }
  };

  const handleDeleteScheduleEvent = async (eventId: number) => {
    if (!activeUserId) return;
    await fetch(`/api/schedule/${eventId}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(),
    });
    await fetchBootstrap(activeUserId, sessionToken);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUserId) return;
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: buildAuthHeaders(activeUserId, sessionToken, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        full_name: profName,
        email: profEmail,
        bio: profBio,
        weekly_goal_hours: profGoal,
        notifications_enabled: profNotifs,
      }),
    });
    if (res.ok) {
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      await fetchBootstrap(activeUserId, sessionToken);
    }
  };

  const handleMarkNotificationsRead = async () => {
    if (!activeUserId) return;
    await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: buildAuthHeaders(),
    });
    await fetchBootstrap(activeUserId, sessionToken);
  };

  const handleAuthenticated = useCallback(
    async (session: AuthSessionResponse) => {
      const nextUser = session.user;
      const nextToken = session.session_token;

      // 1. Immediately store token in module state and unified storage
      saveAuthSession(nextUser.id, nextToken);

      // 2. Update React state
      setActiveUserId(nextUser.id);
      setSessionToken(nextToken);
      setUser(nextUser);
      setAuthViewOpen(false);
      setProfileOpen(false);
      setMobileMenuOpen(false);
      setNotifOpen(false);

      const targetView: NavView =
        nextUser.role === 'admin'
          ? 'admin_dashboard'
          : nextUser.role === 'faculty'
          ? 'teacher_dashboard'
          : 'student_dashboard';
      setView(targetView);
      await fetchBootstrap(nextUser.id, nextToken);

      const roleLabel =
        nextUser.role === 'admin'
          ? 'Administrator'
          : nextUser.role === 'faculty'
          ? 'Teacher'
          : 'Student';
      notifyToast(`Signed in as ${nextUser.full_name} (${roleLabel})`);
    },
    [fetchBootstrap, notifyToast]
  );

  const handleQuickDemoRoleSwitch = async (role: 'admin' | 'faculty' | 'student') => {
    setProfileOpen(false);
    setMobileMenuOpen(false);
    const res = await fetch('/api/auth/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!res.ok) {
      notifyToast(data.error || 'Unable to switch demo role.');
      return;
    }
    await handleAuthenticated(data);
  };

  const enrolledCourses = useMemo(() => courses.filter((c) => c.enrolled), [courses]);
  const completedCoursesCount = useMemo(
    () => enrolledCourses.filter((c) => c.progress_percent >= 100).length,
    [enrolledCourses]
  );
  const recommendedCourses = useMemo(() => courses.filter((c) => !c.enrolled), [courses]);

  const totalWeeklyHours = useMemo(
    () => Number(weeklyActivity.reduce((s, d) => s + d.hours, 0).toFixed(1)),
    [weeklyActivity]
  );

  const overallProgressPercent = useMemo(() => {
    if (enrolledCourses.length === 0) return 0;
    const sum = enrolledCourses.reduce((acc, c) => acc + c.progress_percent, 0);
    return Math.round(sum / enrolledCourses.length);
  }, [enrolledCourses]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E5E0D8] flex items-center justify-center p-6">
        <div className="skeuo-card p-8 text-center space-y-3 max-w-md">
          <div className="skeuo-display-panel w-12 h-12 mx-auto flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-[#315C83]" />
          </div>
          <p className="text-base font-bold text-[#252B32] engraved-label">
            Initializing Learning Workstation...
          </p>
          <p className="text-xs text-[#73777C]">
            Loading curriculum modules, study instruments, and progress gauges
          </p>
        </div>
      </div>
    );
  }

  if (!user || authViewOpen) {
    return (
      <>
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg px-4 py-2.5 shadow-md text-xs font-medium text-[#252B32]">
            {toastMessage}
          </div>
        )}
        <UnifiedAuthView
          currentUser={user}
          initialMode={authInitialMode}
          onAuthenticated={handleAuthenticated}
          onCancelSwitch={user ? () => setAuthViewOpen(false) : undefined}
        />
      </>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const adminSidebarItems: Array<{
    id: NavView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'admin_dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'admin_users', label: 'Users', icon: Users },
    { id: 'admin_courses', label: 'Courses', icon: BookOpen },
    { id: 'admin_academic', label: 'Academics', icon: GraduationCap },
    { id: 'admin_reports', label: 'Reports', icon: BarChart3 },
    { id: 'admin_announcements', label: 'Announcements', icon: Megaphone },
    { id: 'admin_settings', label: 'Settings', icon: Settings },
  ];

  const teacherSidebarItems: Array<{
    id: NavView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'teacher_dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'teacher_courses', label: 'My Courses', icon: BookOpen },
    { id: 'teacher_students', label: 'My Students', icon: Users },
    { id: 'teacher_assignments', label: 'Assignments', icon: FileCheck2 },
    { id: 'teacher_assessments', label: 'Remarks', icon: GraduationCap },
    { id: 'teacher_schedule', label: 'Schedule', icon: Calendar },
    { id: 'teacher_settings', label: 'Profile', icon: Settings },
  ];

  const learnerSidebarItems: Array<{
    id: NavView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'student_dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'student_learning', label: 'My Learning', icon: BookOpen },
    { id: 'student_explore', label: 'Explore Courses', icon: Compass },
    { id: 'student_assignments', label: 'Assignments', icon: FileCheck2 },
    { id: 'student_assessments', label: 'Result', icon: GraduationCap },
    { id: 'student_progress', label: 'My Progress', icon: BarChart3 },
    { id: 'student_settings', label: 'Profile', icon: Settings },
  ];

  const sidebarItems =
    user.role === 'admin'
      ? adminSidebarItems
      : user.role === 'faculty'
      ? teacherSidebarItems
      : learnerSidebarItems;

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: buildAuthHeaders(),
      });
    } catch {
      // Ignore network error during sign out
    }
    clearAuthSession();
    signOutFromFirebase().catch(() => {});
    setMobileMenuOpen(false);
    setProfileOpen(false);
    setNotifOpen(false);
    setAuthViewOpen(false);
    setAuthInitialMode('login');
    setUser(null);
    setActiveUserId(null);
    setSessionToken(null);
  };

  const handleOpenSwitchAccount = (mode: 'login' | 'register' = 'login') => {
    setProfileOpen(false);
    setMobileMenuOpen(false);
    setNotifOpen(false);
    setAuthInitialMode(mode);
    setAuthViewOpen(true);
  };

  const getProgressBarClass = (percent: number) => {
    if (percent >= 100) return 'skeuo-progress-fill-green';
    if (percent < 35) return 'skeuo-progress-fill-brass';
    return 'skeuo-progress-fill-blue';
  };

  const activeAdminSection: AdminSection = view.startsWith('admin_')
    ? (view as AdminSection)
    : 'admin_dashboard';

  const activeTeacherSection: TeacherSection = view.startsWith('teacher_')
    ? (view as TeacherSection)
    : 'teacher_dashboard';

  const activeStudentSection: StudentSection = view.startsWith('student_')
    ? (view as StudentSection)
    : 'student_dashboard';

  const isMinimalRole = true;

  return (
    <div className="min-h-screen flex bg-[#E5E0D8] text-[#252B32]">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg px-4 py-2.5 shadow-md text-xs font-medium text-[#252B32]">
          {toastMessage}
        </div>
      )}

      {/* =====================================================================
          DESKTOP SIDEBAR
         ===================================================================== */}
      <aside className="hidden lg:flex flex-col w-[240px] shrink-0 p-4 sticky top-0 h-screen">
        <div
          className={
            isMinimalRole
              ? 'bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl h-full flex flex-col justify-between p-4'
              : 'skeuo-control-panel h-full flex flex-col justify-between p-4 relative'
          }
        >
          {!isMinimalRole && (
            <>
              <span className="skeuo-rivet absolute top-2.5 left-2.5" />
              <span className="skeuo-rivet absolute top-2.5 right-2.5" />
              <span className="skeuo-rivet absolute bottom-2.5 left-2.5" />
              <span className="skeuo-rivet absolute bottom-2.5 right-2.5" />
            </>
          )}

          <div className="space-y-5">
            {/* Brand Header */}
            <button
              onClick={() =>
                setView(
                  user.role === 'admin'
                    ? 'admin_dashboard'
                    : user.role === 'faculty'
                    ? 'teacher_dashboard'
                    : 'student_dashboard'
                )
              }
              className={
                isMinimalRole
                  ? 'w-full px-2 py-1.5 flex items-center gap-2.5 text-left cursor-pointer'
                  : 'w-full skeuo-card p-3 flex items-center gap-3 text-left cursor-pointer'
              }
            >
              <div className="w-8 h-8 rounded-lg bg-[#315C83] flex items-center justify-center text-white font-bold text-sm">
                S
              </div>
              <div className="min-w-0">
                <span className="text-sm font-bold text-[#252B32] block leading-none">
                  SmartLearn
                </span>
                <span className="text-[11px] text-[#73777C] block mt-0.5">
                  {user.role === 'admin'
                    ? 'Admin'
                    : user.role === 'faculty'
                    ? 'Teacher'
                    : 'Student'}
                </span>
              </div>
            </button>

            {/* Primary Navigation */}
            <nav className="space-y-1" aria-label="Main Navigation">
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  view === item.id ||
                  (user.role === 'admin' && item.id === 'admin_dashboard' && view === 'dashboard') ||
                  (user.role === 'faculty' &&
                    item.id === 'teacher_dashboard' &&
                    view === 'dashboard') ||
                  (user.role === 'student' &&
                    item.id === 'student_dashboard' &&
                    view === 'dashboard') ||
                  (user.role === 'faculty' &&
                    item.id === 'teacher_courses' &&
                    view === 'course-detail') ||
                  (user.role === 'student' &&
                    item.id === 'student_learning' &&
                    view === 'course-detail') ||
                  (item.id === 'my-courses' && view === 'course-detail');

                if (isMinimalRole) {
                  return (
                    <button
                      key={item.id}
                      onClick={() => setView(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#315C83] text-white'
                          : 'text-[#252B32] hover:bg-[#EAE4DA]'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-white' : 'text-[#73777C]'
                        }`}
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                }

                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition-all whitespace-nowrap ${
                      isActive ? 'skeuo-nav-item-active' : 'skeuo-nav-item'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-[#315C83]' : 'text-[#73777C]'
                        }`}
                      />
                      <span>{item.label}</span>
                    </span>
                    <span
                      className={
                        isActive
                          ? 'skeuo-led-blue'
                          : 'w-2 h-2 rounded-full bg-[#B8AFA0] border border-[#9E9586]'
                      }
                    />
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom Section */}
          {isMinimalRole ? (
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-[#73777C] hover:text-[#B85C55] rounded-lg hover:bg-[#EAE4DA] transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Sign Out</span>
            </button>
          ) : (
            <div className="skeuo-display-panel p-3.5 space-y-2 mb-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#252B32] flex items-center gap-1.5 engraved-label">
                  <Flame className="w-3.5 h-3.5 text-[#B58A54]" />
                  {user.study_streak_days || 12}-Day Streak
                </span>
                <span className="text-[11px] font-mono font-bold text-[#315C83] tabular-nums">
                  {totalWeeklyHours}h / {user.weekly_goal_hours || 16}h
                </span>
              </div>
              <div className="skeuo-progress-track h-2.5 w-full">
                <div
                  className="skeuo-progress-fill-brass h-full"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((totalWeeklyHours / (user.weekly_goal_hours || 16)) * 100)
                    )}%`,
                  }}
                />
              </div>
              <p className="text-[10px] font-mono text-[#73777C]">
                WEEKLY QUOTA:{' '}
                <strong className="text-[#252B32]">
                  {Math.min(
                    100,
                    Math.round((totalWeeklyHours / (user.weekly_goal_hours || 16)) * 100)
                  )}
                  %
                </strong>{' '}
                LOGGED
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* MOBILE DRAWER OVERLAY */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden bg-[#252B32]/45 backdrop-blur-xs flex">
          <div className="w-72 skeuo-control-panel h-full p-5 flex flex-col justify-between shadow-2xl rounded-none">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-lg font-extrabold text-[#252B32] engraved-label">
                  SmartLearn Console
                </span>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="skeuo-btn p-2 text-[#252B32]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="space-y-1.5">
                {sidebarItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = view === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setView(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs ${
                        isActive ? 'skeuo-nav-item-active' : 'skeuo-nav-item'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </span>
                      {isActive && <span className="skeuo-led-blue" />}
                    </button>
                  );
                })}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs skeuo-nav-item text-[#B85C55]"
                >
                  <span className="flex items-center gap-3">
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </span>
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* MAIN WORKSTATION COLUMN */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ===================================================================
            TOP BRUSHED TOOLBAR
           =================================================================== */}
        <header className="sticky top-0 z-30 skeuo-toolbar px-5 sm:px-8 py-3.5">
          <div className="max-w-[1240px] mx-auto flex items-center justify-between gap-4">
            {/* Left: Mobile Console Button + Welcome Message */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden skeuo-btn p-2.5"
                aria-label="Open Navigation"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="truncate">
                <p className="text-sm sm:text-base font-extrabold text-[#252B32] truncate engraved-label">
                  Welcome back, {user.full_name}
                </p>
                <p className="text-xs text-[#73777C] hidden sm:block">
                  {user.role === 'student'
                    ? `${enrolledCourses.length} active courses · ${overallProgressPercent}% overall mastery`
                    : `${user.role.toUpperCase()} Console · Managing ${courses.length} courses`}
                </p>
              </div>
            </div>

            {/* Center: Physical Recessed Search Slot */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (globalSearch.trim()) {
                  executeSearch(globalSearch);
                  setView('search');
                }
              }}
              className="hidden md:flex items-center flex-1 max-w-md mx-4"
            >
              <div className="relative w-full">
                <Search className="w-4 h-4 text-[#73777C] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={globalSearch}
                  onChange={(e) => {
                    setGlobalSearch(e.target.value);
                    if (view === 'search') executeSearch(e.target.value);
                  }}
                  placeholder="Search courses, lectures, or reference notes..."
                  className="skeuo-input w-full pl-10 pr-4 py-2 text-xs"
                />
              </div>
            </form>

            {/* Right: Tactile Notification Button & Framed Profile Badge */}
            <div className="flex items-center gap-3 shrink-0 relative">
              {/* Notification Switch */}
              <div className="relative">
                <button
                  onClick={() => {
                    setNotifOpen(!notifOpen);
                    setProfileOpen(false);
                  }}
                  className={`skeuo-btn p-2.5 relative ${notifOpen ? 'skeuo-btn-pressed' : ''}`}
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4 text-[#252B32]" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#B85C55] border border-white text-white text-[10px] font-bold flex items-center justify-center shadow-xs">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2.5 w-80 skeuo-card p-4 z-50 space-y-3 shadow-2xl">
                    <div className="flex items-center justify-between border-b border-[#C6BEB0] pb-2">
                      <span className="text-xs font-bold text-[#252B32] engraved-label">
                        Dispatches ({unreadCount} unread)
                      </span>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkNotificationsRead}
                          className="text-[11px] font-bold text-[#315C83] hover:underline cursor-pointer"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {notifications.length === 0 ? (
                        <p className="text-xs text-[#73777C] py-4 text-center">No notifications yet.</p>
                      ) : (
                        notifications.slice(0, 6).map((n) => (
                          <div
                            key={n.id}
                            className={`p-2.5 text-xs ${
                              !n.is_read ? 'skeuo-display-panel' : 'skeuo-tray'
                            }`}
                          >
                            <p className="font-bold text-[#252B32]">{n.title}</p>
                            <p className="text-[#73777C] mt-0.5 leading-snug">{n.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Framed User Profile Switcher */}
              <div className="relative">
                <button
                  onClick={() => {
                    setProfileOpen(!profileOpen);
                    setNotifOpen(false);
                  }}
                  className={`skeuo-btn px-3 py-1.5 flex items-center gap-2.5 ${
                    profileOpen ? 'skeuo-btn-pressed' : ''
                  }`}
                >
                  <div className="w-7 h-7 rounded-[6px] bg-gradient-to-b from-[#3D6E99] to-[#244666] border border-[#173047] text-[#F4F0E8] font-bold text-xs flex items-center justify-center shadow-inner">
                    {user.full_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="text-left hidden sm:block">
                    <p className="text-xs font-bold text-[#252B32] leading-none">{user.full_name}</p>
                    <p className="text-[10px] font-mono text-[#B58A54] uppercase font-bold mt-0.5">
                      {user.role === 'faculty' ? 'teacher' : user.role}
                    </p>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-[#73777C]" />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2.5 w-68 skeuo-card p-4 z-50 space-y-3 shadow-2xl">
                    {/* Current Authenticated User Identity */}
                    <div className="border-b border-[#C6BEB0] pb-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#252B32] truncate">{user.full_name}</p>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#EAE4DA] border border-[#DDD6CA] text-[#315C83] font-bold shrink-0">
                          {user.role === 'admin'
                            ? 'Administrator'
                            : user.role === 'faculty'
                            ? 'Teacher'
                            : 'Student'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#73777C] font-mono truncate mt-0.5">
                        {user.email}
                      </p>
                    </div>

                    {/* Unified Switch Account Section */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#73777C]">
                        Switch Account
                      </p>

                      {demoModeEnabled && (
                        <div className="grid grid-cols-3 gap-1.5">
                          {(
                            [
                              { role: 'admin', label: 'Admin' },
                              { role: 'faculty', label: 'Teacher' },
                              { role: 'student', label: 'Student' },
                            ] as const
                          ).map((item) => {
                            const isCurrent = user.role === item.role;
                            return (
                              <button
                                key={item.role}
                                type="button"
                                onClick={() => handleQuickDemoRoleSwitch(item.role)}
                                className={`py-1.5 px-2 text-[11px] font-medium rounded-md border text-center transition-colors cursor-pointer ${
                                  isCurrent
                                    ? 'bg-[#315C83] text-white border-[#315C83]'
                                    : 'bg-[#FAF8F5] text-[#252B32] border-[#DDD6CA] hover:bg-[#EAE4DA]'
                                }`}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenSwitchAccount('login')}
                        className="w-full skeuo-btn px-3 py-1.5 text-xs text-left flex items-center justify-between cursor-pointer"
                      >
                        <span>Sign In as Another User</span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#315C83]" />
                      </button>
                    </div>

                    {/* Profile, Settings & Sign Out */}
                    <div className="pt-2 border-t border-[#C6BEB0] space-y-1.5">
                      <button
                        onClick={() => {
                          setView(
                            user.role === 'admin'
                              ? 'admin_settings'
                              : user.role === 'faculty'
                              ? 'teacher_settings'
                              : 'student_settings'
                          );
                          setProfileOpen(false);
                        }}
                        className="w-full skeuo-btn px-3 py-1.5 text-xs text-left cursor-pointer"
                      >
                        {user.role === 'admin' ? 'Settings' : 'Profile'}
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full skeuo-btn px-3 py-1.5 text-xs text-left text-[#B85C55] font-bold flex items-center justify-between cursor-pointer"
                      >
                        <span>Sign Out</span>
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* MAIN VIEWPORT */}
        <main className="flex-1 max-w-[1240px] w-full mx-auto px-5 sm:px-8 py-6">
          {/* =================================================================
              ADMINISTRATOR GOVERNANCE DASHBOARD & ROLE MANAGEMENT SYSTEM
             ================================================================= */}
          {user.role === 'admin' && (view === 'dashboard' || view.startsWith('admin_')) && (
            <AdminDashboardView
              currentUser={user}
              activeSection={activeAdminSection}
              onNavigateSection={(sec) => setView(sec)}
              onInspectCourse={(courseId) => handleOpenCourse(courseId)}
              onRefreshBootstrap={() => fetchBootstrap(activeUserId)}
              notifyToast={notifyToast}
            />
          )}

          {/* =================================================================
              MINIMALISTIC TEACHER DASHBOARD & COURSE MANAGEMENT SYSTEM
             ================================================================= */}
          {user.role === 'faculty' && (view === 'dashboard' || view.startsWith('teacher_')) && (
            <TeacherDashboardView
              activeUserId={user.id}
              sessionToken={sessionToken || getSessionToken()}
              activeSection={activeTeacherSection}
              onNavigateSection={(sec) => setView(sec)}
              onOpenCourseWorkspace={(courseId) => handleOpenCourse(courseId)}
              onRefreshGlobalData={() => fetchBootstrap(activeUserId, sessionToken || getSessionToken())}
              onSignOut={handleLogout}
            />
          )}

          {/* =================================================================
              MINIMALISTIC STUDENT DASHBOARD & LEARNING SYSTEM
             ================================================================= */}
          {user.role === 'student' && (view === 'dashboard' || view.startsWith('student_')) && (
            <StudentDashboardView
              activeUserId={user.id}
              sessionToken={sessionToken || getSessionToken()}
              activeSection={activeStudentSection}
              onNavigateSection={(sec) => setView(sec)}
              onOpenCourseWorkspace={(courseId, assignmentId, materialId) =>
                handleOpenCourse(courseId, assignmentId ?? null, materialId ?? null)
              }
              onRefreshGlobalData={() => fetchBootstrap(activeUserId, sessionToken || getSessionToken())}
              onSignOut={handleLogout}
            />
          )}

          {/* =================================================================
              2. MY COURSES VIEW
             ================================================================= */}
          {view === 'my-courses' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                    Enrolled Curriculum
                  </p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                    My Courses
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 p-1.5 skeuo-tray">
                    {(['all', 'in-progress', 'completed'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setMyCourseFilter(f)}
                        className={`px-3.5 py-1.5 text-xs font-semibold rounded-[6px] capitalize cursor-pointer ${
                          myCourseFilter === f
                            ? 'skeuo-btn-primary'
                            : 'skeuo-btn text-[#252B32]'
                        }`}
                      >
                        {f.replace('-', ' ')}
                      </button>
                    ))}
                  </div>

                  {(user.role === 'faculty' || user.role === 'admin') && (
                    <button
                      onClick={() => setShowNewCourse(!showNewCourse)}
                      className="skeuo-btn-brass px-4 py-2 text-xs inline-flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Create Course
                    </button>
                  )}
                </div>
              </div>

              {showNewCourse && (
                <form onSubmit={handleCreateCourse} className="skeuo-card p-6 space-y-4 max-w-xl">
                  <h2 className="text-base font-extrabold text-[#252B32] engraved-label">
                    Create New Course Module
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      required
                      placeholder="Code (e.g. CS205)"
                      value={newCourseCode}
                      onChange={(e) => setNewCourseCode(e.target.value)}
                      className="skeuo-input px-3.5 py-2 text-xs font-mono"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Course Title"
                      value={newCourseTitle}
                      onChange={(e) => setNewCourseTitle(e.target.value)}
                      className="skeuo-input sm:col-span-2 px-3.5 py-2 text-xs"
                    />
                  </div>
                  <textarea
                    rows={3}
                    required
                    placeholder="Course description and learning outcomes..."
                    value={newCourseDesc}
                    onChange={(e) => setNewCourseDesc(e.target.value)}
                    className="skeuo-input w-full p-3.5 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <button type="submit" className="skeuo-btn-primary px-4 py-2 text-xs">
                      Publish Course
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewCourse(false)}
                      className="skeuo-btn px-3 py-2 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {enrolledCourses
                  .filter((c) => {
                    if (myCourseFilter === 'completed') return c.progress_percent >= 100;
                    if (myCourseFilter === 'in-progress') return c.progress_percent < 100;
                    return true;
                  })
                  .map((course) => (
                    <div
                      key={course.id}
                      onClick={() => handleOpenCourse(course.id)}
                      className="skeuo-card skeuo-card-interactive p-5 flex flex-col justify-between cursor-pointer space-y-4"
                    >
                      <div className="space-y-3">
                        <CourseMediaCover course={course} />
                        <div className="flex items-center justify-between text-xs text-[#73777C]">
                          <span className="font-semibold text-[#315C83]">{course.category}</span>
                          <span>Instructor: {course.faculty_name}</span>
                        </div>
                        <h3 className="text-lg font-extrabold text-[#252B32] engraved-label">
                          {course.title}
                        </h3>
                        <p className="text-xs text-[#73777C] leading-relaxed line-clamp-2">
                          {course.description}
                        </p>
                      </div>

                      <div className="space-y-3 pt-2 border-t border-[#C6BEB0]">
                        <div className="skeuo-display-panel p-3 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#73777C] font-mono">
                              {course.completed_material_count}/{course.material_count} LESSONS
                            </span>
                            <span className="font-mono font-bold text-[#315C83]">
                              {course.progress_percent}%
                            </span>
                          </div>
                          <div className="skeuo-progress-track h-2.5 w-full">
                            <div
                              className={`${getProgressBarClass(course.progress_percent)} h-full`}
                              style={{ width: `${Math.max(5, course.progress_percent)}%` }}
                            />
                          </div>
                        </div>
                        <button className="skeuo-btn-primary w-full py-2.5 text-xs">
                          {course.progress_percent >= 100
                            ? 'Review Completed Course'
                            : 'Continue Learning'}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* =================================================================
              3. EXPLORE COURSES CATALOG VIEW
             ================================================================= */}
          {view === 'explore' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                    Academic Archive
                  </p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                    Explore Courses
                  </h1>
                  <p className="text-xs text-[#73777C] mt-1">
                    Select any course panel to inspect modules or enroll
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 p-1.5 skeuo-tray">
                  {['All', 'Computer Science', 'Creative Arts', 'Game Design', 'Data & Systems'].map(
                    (cat) => (
                      <button
                        key={cat}
                        onClick={() => setCatalogCategory(cat)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] cursor-pointer ${
                          catalogCategory === cat
                            ? 'skeuo-btn-primary'
                            : 'skeuo-btn text-[#252B32]'
                        }`}
                      >
                        {cat}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {courses
                  .filter((c) => catalogCategory === 'All' || c.category === catalogCategory)
                  .map((course) => (
                    <div
                      key={course.id}
                      className="skeuo-card skeuo-card-interactive p-5 flex flex-col justify-between space-y-4"
                    >
                      <div className="space-y-3">
                        <CourseMediaCover course={course} />
                        <div className="flex items-center justify-between text-xs text-[#73777C]">
                          <span className="font-semibold text-[#315C83]">{course.category}</span>
                          <span className="font-mono">{course.estimated_hours} hrs</span>
                        </div>
                        <h3 className="text-lg font-extrabold text-[#252B32] engraved-label">
                          {course.title}
                        </h3>
                        <p className="text-xs text-[#73777C] leading-relaxed">{course.description}</p>
                      </div>

                      <div className="space-y-3 pt-3 border-t border-[#C6BEB0]">
                        <div className="flex items-center justify-between text-xs text-[#73777C]">
                          <span>Instructor: {course.faculty_name}</span>
                          <span className="font-mono">{course.material_count} lessons</span>
                        </div>
                        {course.enrolled ? (
                          <button
                            onClick={() => handleOpenCourse(course.id)}
                            className="skeuo-btn-primary w-full py-2.5 text-xs"
                          >
                            Continue Learning ({course.progress_percent}%)
                          </button>
                        ) : (
                          <button
                            onClick={() => handleEnroll(course.id)}
                            className="skeuo-btn-brass w-full py-2.5 text-xs"
                          >
                            Enroll in {course.code}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* =================================================================
              4. DEDICATED COURSE WORKSPACE & LESSON VIEWER
             ================================================================= */}
          {view === 'course-detail' && (
            <CourseWorkspaceView
              courseId={selectedCourseId}
              user={user}
              activeUserId={user.id}
              initialAssignmentId={selectedAssignmentId}
              initialMaterialId={selectedMaterialId}
              onBack={() =>
                setView(
                  user.role === 'admin'
                    ? 'admin_courses'
                    : user.role === 'faculty'
                    ? 'teacher_courses'
                    : 'student_learning'
                )
              }
              onRefreshBootstrap={() => fetchBootstrap(user.id, sessionToken)}
            />
          )}

          {/* =================================================================
              5. ASSIGNMENTS & SUBMISSIONS VIEW
             ================================================================= */}
          {view === 'assignments' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                    Coursework Ledger
                  </p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                    Assignments &amp; Submissions
                  </h1>
                </div>

                <div className="flex items-center gap-1.5 p-1.5 skeuo-tray">
                  {(['all', 'pending', 'submitted', 'graded'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setAssignmentFilter(st)}
                      className={`px-3.5 py-1.5 text-xs font-semibold rounded-[6px] capitalize cursor-pointer ${
                        assignmentFilter === st
                          ? 'skeuo-btn-primary'
                          : 'skeuo-btn text-[#252B32]'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {assignments
                  .filter((a) => {
                    if (assignmentFilter === 'pending') return !a.my_submission;
                    if (assignmentFilter === 'submitted')
                      return a.my_submission && a.my_submission.grade === null;
                    if (assignmentFilter === 'graded')
                      return a.my_submission && a.my_submission.grade !== null;
                    return true;
                  })
                  .map((asgn) => (
                    <div
                      key={asgn.id}
                      onClick={() => handleOpenCourse(asgn.course_id, asgn.id)}
                      className="skeuo-card skeuo-card-interactive p-6 flex flex-col justify-between cursor-pointer space-y-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-mono text-[#73777C]">
                          <span className="font-bold text-[#315C83]">
                            {asgn.course_code} · {asgn.course_title}
                          </span>
                          <span>Due {asgn.due_at.replace('T', ' ')}</span>
                        </div>
                        <h3 className="text-base font-extrabold text-[#252B32] engraved-label">
                          {asgn.title}
                        </h3>
                        <p className="text-xs text-[#73777C] leading-relaxed">{asgn.description}</p>
                      </div>

                      <div className="pt-4 border-t border-[#C6BEB0] flex items-center justify-between text-xs">
                        <div className="font-mono">
                          {asgn.my_submission ? (
                            asgn.my_submission.grade !== null ? (
                              <span className="text-[#54866A] font-bold flex items-center gap-1.5">
                                <span className="skeuo-led-green" />
                                Graded: {asgn.my_submission.grade}/{asgn.max_score} pts
                              </span>
                            ) : (
                              <span className="text-[#315C83] font-bold flex items-center gap-1.5">
                                <span className="skeuo-led-blue" />
                                Submitted (Awaiting Grade)
                              </span>
                            )
                          ) : (
                            <span className="text-[#D49A43] font-bold flex items-center gap-1.5">
                              <span className="skeuo-led-amber" />
                              Not Submitted ({asgn.max_score} pts)
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-[#315C83] inline-flex items-center gap-1">
                          {user.role === 'student' ? 'Submit / View' : 'Grade Submissions'}{' '}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* =================================================================
              6. SCHEDULE & CALENDAR VIEW
             ================================================================= */}
          {view === 'schedule' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                  Academic Chronometer
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                  Weekly Schedule &amp; Study Sessions
                </h1>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-8 space-y-3.5">
                  {schedule.map((ev) => (
                    <div
                      key={ev.id}
                      className="skeuo-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-4">
                        <div
                          className={`px-3.5 py-2.5 skeuo-display-panel text-center font-mono text-xs font-bold shrink-0 ${
                            ev.type === 'deadline'
                              ? 'text-[#B85C55]'
                              : ev.type === 'workshop'
                              ? 'text-[#54866A]'
                              : 'text-[#315C83]'
                          }`}
                        >
                          <span className="block">{ev.date.slice(0, 3).toUpperCase()}</span>
                          <span className="text-[10px] text-[#73777C]">{ev.time}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 text-xs font-mono text-[#73777C]">
                            <span className="font-bold text-[#315C83]">{ev.course_code}</span>
                            <span>·</span>
                            <span className="capitalize">{ev.type}</span>
                            <span>·</span>
                            <span>{ev.duration_label}</span>
                          </div>
                          <h3 className="text-sm font-extrabold text-[#252B32] mt-0.5">
                            {ev.title}
                          </h3>
                          <p className="text-xs text-[#73777C] mt-0.5">{ev.location}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteScheduleEvent(ev.id)}
                        className="skeuo-btn p-2 text-[#73777C] hover:text-[#B85C55] self-end sm:self-center"
                        title="Remove session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Personal Study Block */}
                <form
                  onSubmit={handleAddScheduleEvent}
                  className="lg:col-span-4 skeuo-card p-6 space-y-4"
                >
                  <h2 className="text-base font-extrabold text-[#252B32] engraved-label">
                    Schedule Study Session
                  </h2>
                  <div>
                    <label className="block text-xs font-bold text-[#73777C] mb-1.5">
                      Session Title
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Exam Review Session"
                      value={schedTitle}
                      onChange={(e) => setSchedTitle(e.target.value)}
                      className="skeuo-input w-full px-3.5 py-2 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#73777C] mb-1.5">
                        Course Code
                      </label>
                      <input
                        type="text"
                        value={schedCourse}
                        onChange={(e) => setSchedCourse(e.target.value)}
                        className="skeuo-input w-full px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#73777C] mb-1.5">
                        Day of Week
                      </label>
                      <select
                        value={schedDay}
                        onChange={(e) => setSchedDay(e.target.value)}
                        className="skeuo-input w-full px-3 py-2 text-xs"
                      >
                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
                          (d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#73777C] mb-1.5">Time</label>
                      <input
                        type="text"
                        value={schedTime}
                        onChange={(e) => setSchedTime(e.target.value)}
                        className="skeuo-input w-full px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#73777C] mb-1.5">Type</label>
                      <select
                        value={schedType}
                        onChange={(e) =>
                          setSchedType(e.target.value as 'study' | 'lecture' | 'workshop' | 'deadline')
                        }
                        className="skeuo-input w-full px-3 py-2 text-xs"
                      >
                        <option value="study">Study Block</option>
                        <option value="lecture">Lecture</option>
                        <option value="workshop">Workshop</option>
                        <option value="deadline">Deadline</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="skeuo-btn-primary w-full py-2.5 text-xs">
                    Record in Schedule
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* =================================================================
              7. PROGRESS & GRADES ANALYTICS VIEW
             ================================================================= */}
          {view === 'progress' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                  Academic Telemetry
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                  Progress &amp; Grade Ledger
                </h1>
              </div>

              {/* 4 Physical Readout Panels */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="skeuo-card p-4 space-y-2">
                  <span className="text-xs font-bold text-[#73777C] engraved-label">
                    AVERAGE COMPLETION
                  </span>
                  <div className="skeuo-display-panel p-3">
                    <p className="text-2xl font-extrabold font-mono text-[#315C83] tabular-nums">
                      {overallProgressPercent}%
                    </p>
                  </div>
                  <p className="text-xs text-[#73777C]">
                    Across {enrolledCourses.length} enrolled courses
                  </p>
                </div>

                <div className="skeuo-card p-4 space-y-2">
                  <span className="text-xs font-bold text-[#73777C] engraved-label">
                    LESSONS COMPLETED
                  </span>
                  <div className="skeuo-display-panel p-3">
                    <p className="text-2xl font-extrabold font-mono text-[#54866A] tabular-nums">
                      {enrolledCourses.reduce((s, c) => s + c.completed_material_count, 0)} /{' '}
                      {enrolledCourses.reduce((s, c) => s + c.material_count, 0)}
                    </p>
                  </div>
                  <p className="text-xs text-[#73777C]">Interactive lectures &amp; notes</p>
                </div>

                <div className="skeuo-card p-4 space-y-2">
                  <span className="text-xs font-bold text-[#73777C] engraved-label">
                    ASSIGNMENTS SUBMITTED
                  </span>
                  <div className="skeuo-display-panel p-3">
                    <p className="text-2xl font-extrabold font-mono text-[#252B32] tabular-nums">
                      {assignments.filter((a) => a.my_submission !== null).length} /{' '}
                      {assignments.length}
                    </p>
                  </div>
                  <p className="text-xs text-[#73777C]">
                    {
                      assignments.filter(
                        (a) =>
                          a.my_submission?.grade !== null && a.my_submission?.grade !== undefined
                      ).length
                    }{' '}
                    graded
                  </p>
                </div>

                <div className="skeuo-card p-4 space-y-2">
                  <span className="text-xs font-bold text-[#73777C] engraved-label">
                    STUDY NOTES FILED
                  </span>
                  <div className="skeuo-display-panel p-3">
                    <p className="text-2xl font-extrabold font-mono text-[#B58A54] tabular-nums">
                      {notes.length}
                    </p>
                  </div>
                  <p className="text-xs text-[#73777C]">Timestamped lesson annotations</p>
                </div>
              </div>

              {/* Course Mastery Breakdown */}
              <div className="skeuo-card p-6 sm:p-7 space-y-5">
                <h2 className="text-base font-extrabold text-[#252B32] engraved-label">
                  Course-by-Course Mastery Gauges
                </h2>
                <div className="space-y-4">
                  {enrolledCourses.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => handleOpenCourse(c.id)}
                      className="p-4 skeuo-display-panel cursor-pointer space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-[#252B32]">
                          {c.code}: {c.title}
                        </span>
                        <div className="flex items-center gap-3 font-mono">
                          {c.quiz_score !== null && c.quiz_score !== undefined && (
                            <span className="text-[#54866A] font-bold">Quiz: {c.quiz_score}%</span>
                          )}
                          <span className="font-bold text-[#315C83]">
                            {c.completed_material_count}/{c.material_count} lessons ({c.progress_percent}%)
                          </span>
                        </div>
                      </div>
                      <div className="skeuo-progress-track h-2.5 w-full">
                        <div
                          className={`${getProgressBarClass(c.progress_percent)} h-full`}
                          style={{ width: `${Math.max(5, c.progress_percent)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              8. CERTIFICATES VIEW
             ================================================================= */}
          {view === 'certificates' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                  Official Credentials
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                  Course Certificates
                </h1>
                <p className="text-xs text-[#73777C] mt-1">
                  Complete all lessons in a course to unlock your official parchment certificate
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {enrolledCourses.map((course) => {
                  const isUnlocked = course.progress_percent >= 100;
                  return (
                    <div
                      key={course.id}
                      className="skeuo-card p-6 flex flex-col justify-between space-y-5"
                    >
                      <div className="space-y-3">
                        <div className="skeuo-display-panel w-12 h-12 flex items-center justify-center text-[#B58A54]">
                          <Award className="w-6 h-6" />
                        </div>
                        <span className="text-xs font-mono font-bold text-[#73777C] block">
                          {course.code} · {course.estimated_hours} HOURS
                        </span>
                        <h3 className="text-lg font-extrabold text-[#252B32] engraved-label">
                          {course.title}
                        </h3>
                        <p className="text-xs text-[#73777C]">
                          Certified by Instructor {course.faculty_name}
                        </p>
                      </div>

                      <div className="space-y-3.5 pt-2">
                        <div className="skeuo-display-panel p-3 space-y-1.5">
                          <div className="flex justify-between text-xs font-mono">
                            <span className="text-[#73777C]">COMPLETION</span>
                            <span className="font-bold text-[#315C83]">{course.progress_percent}%</span>
                          </div>
                          <div className="skeuo-progress-track h-2.5 w-full">
                            <div
                              className={`${getProgressBarClass(course.progress_percent)} h-full`}
                              style={{ width: `${Math.max(5, course.progress_percent)}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 pt-1">
                          <button
                            onClick={() => setPreviewCertCourse(course)}
                            className="skeuo-btn-brass w-full py-2.5 text-xs"
                          >
                            {isUnlocked ? 'Inspect Official Diploma' : 'Preview Certificate'}
                          </button>
                          {!isUnlocked && (
                            <button
                              onClick={() => handleOpenCourse(course.id)}
                              className="skeuo-btn w-full py-2 text-xs"
                            >
                              Continue Remaining Lessons
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* =================================================================
              9. LEARNER PROFILE VIEW
             ================================================================= */}
          {view === 'profile' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                  Academic Dossier
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                  Learner Profile
                </h1>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-5 skeuo-card p-6 sm:p-7 space-y-5 text-center">
                  <div className="w-20 h-20 rounded-[12px] bg-gradient-to-b from-[#3D6E99] to-[#244666] border-2 border-[#B58A54] shadow-md mx-auto flex items-center justify-center text-2xl font-extrabold text-[#F4F0E8]">
                    {user.full_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-[#252B32] engraved-label">
                      {user.full_name}
                    </h2>
                    <p className="text-xs text-[#73777C] mt-0.5 font-mono">
                      @{user.username} · <span className="uppercase text-[#B58A54] font-bold">{user.role}</span>
                    </p>
                    <p className="text-xs text-[#315C83] font-mono mt-1">{user.email}</p>
                  </div>
                  <p className="text-xs text-[#252B32] leading-relaxed skeuo-tray p-4 text-left">
                    {user.bio ||
                      'Passionate learner exploring computer systems, design, and interactive engineering.'}
                  </p>
                  <button
                    onClick={() => setView('settings')}
                    className="skeuo-btn-primary w-full py-2.5 text-xs"
                  >
                    Configure Profile &amp; Workstation
                  </button>
                </div>

                <div className="lg:col-span-7 space-y-6">
                  <div className="skeuo-card p-6 space-y-4">
                    <h3 className="text-base font-extrabold text-[#252B32] engraved-label">
                      Recorded Academic Metrics
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div className="skeuo-display-panel p-4 text-center">
                        <p className="text-xl font-extrabold font-mono text-[#B58A54]">
                          {user.study_streak_days || 12}d
                        </p>
                        <p className="text-[11px] font-mono text-[#73777C] mt-1">ACTIVE STREAK</p>
                      </div>
                      <div className="skeuo-display-panel p-4 text-center">
                        <p className="text-xl font-extrabold font-mono text-[#54866A]">
                          {enrolledCourses.reduce((s, c) => s + c.completed_material_count, 0)}
                        </p>
                        <p className="text-[11px] font-mono text-[#73777C] mt-1">LESSONS DONE</p>
                      </div>
                      <div className="skeuo-display-panel p-4 text-center">
                        <p className="text-xl font-extrabold font-mono text-[#315C83]">
                          {notes.length}
                        </p>
                        <p className="text-[11px] font-mono text-[#73777C] mt-1">STUDY NOTES</p>
                      </div>
                    </div>
                  </div>

                  <div className="skeuo-card p-6 space-y-4">
                    <h3 className="text-base font-extrabold text-[#252B32] engraved-label">
                      Recent Study Notes
                    </h3>
                    {notes.length === 0 ? (
                      <p className="text-xs text-[#73777C]">No study notes filed yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {notes.slice(0, 4).map((n) => (
                          <div key={n.id} className="skeuo-tray p-3.5 space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-mono text-[#315C83] font-bold">
                              <span>{n.material_title}</span>
                              <span>@{n.timestamp_label}</span>
                            </div>
                            <p className="text-xs text-[#252B32]">{n.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              10. SETTINGS VIEW (WITH PHYSICAL TOGGLE SWITCH)
             ================================================================= */}
          {view === 'settings' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                  Control Calibration
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] mt-1 engraved-label">
                  Workstation Settings &amp; Preferences
                </h1>
              </div>

              <form onSubmit={handleSaveProfile} className="skeuo-card p-6 sm:p-8 space-y-5">
                {settingsSaved && (
                  <div className="p-3.5 skeuo-display-panel text-[#54866A] text-xs font-bold flex items-center gap-2">
                    <span className="skeuo-led-green" />
                    Your profile and workstation preferences have been committed.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#252B32] mb-1.5 engraved-label">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={profName}
                      onChange={(e) => setProfName(e.target.value)}
                      className="skeuo-input w-full px-3.5 py-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#252B32] mb-1.5 engraved-label">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={profEmail}
                      onChange={(e) => setProfEmail(e.target.value)}
                      className="skeuo-input w-full px-3.5 py-2.5 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#252B32] mb-1.5 engraved-label">
                    Learner Bio &amp; Focus Areas
                  </label>
                  <textarea
                    rows={3}
                    value={profBio}
                    onChange={(e) => setProfBio(e.target.value)}
                    className="skeuo-input w-full p-3.5 text-xs"
                  />
                </div>

                {/* Physical Study Quota Slider */}
                <div className="skeuo-tray p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-[#252B32] engraved-label">
                      Weekly Study Time Target
                    </span>
                    <span className="font-mono font-bold text-[#315C83]">{profGoal} hours / week</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={40}
                    value={profGoal}
                    onChange={(e) => setProfGoal(Number(e.target.value))}
                    className="w-full accent-[#315C83]"
                  />
                </div>

                {/* Physical Skeuomorphic Toggle Switch */}
                <div className="skeuo-tray p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold text-[#252B32] engraved-label flex items-center gap-2">
                      <span className={profNotifs ? 'skeuo-led-green' : 'skeuo-led-amber'} />
                      Course &amp; Deadline Dispatch Alerts
                    </p>
                    <p className="text-[11px] text-[#73777C] mt-0.5">
                      Toggle physical alert dispatches when grades are posted or assignments are due
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={profNotifs}
                    onClick={() => setProfNotifs(!profNotifs)}
                    className={`skeuo-switch-track shrink-0 ${
                      profNotifs
                        ? 'bg-gradient-to-b from-[#3F6851] to-[#54866A]'
                        : 'bg-gradient-to-b from-[#BFB7A8] to-[#D4CEC2]'
                    }`}
                  >
                    <span
                      className="skeuo-switch-thumb"
                      style={{
                        transform: profNotifs ? 'translateX(26px)' : 'translateX(2px)',
                      }}
                    />
                  </button>
                </div>

                <div className="pt-4 border-t border-[#C6BEB0] flex items-center justify-end gap-3">
                  <button type="submit" className="skeuo-btn-primary px-5 py-2.5 text-xs">
                    Save Workstation Settings
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* =================================================================
              11. GLOBAL SEARCH RESULTS VIEW
             ================================================================= */}
          {view === 'search' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#B58A54]">
                    Index Lookup
                  </p>
                  <h1 className="text-2xl font-extrabold text-[#252B32] mt-1 engraved-label">
                    Search Results: &ldquo;{globalSearch}&rdquo;
                  </h1>
                </div>
              </div>

              <div className="space-y-3.5">
                {searchResults.length === 0 ? (
                  <div className="skeuo-card p-8 text-center text-xs text-[#73777C]">
                    No lessons matched &ldquo;{globalSearch}&rdquo;. Try searching for{' '}
                    <strong className="text-[#252B32]">design</strong>,{' '}
                    <strong className="text-[#252B32]">systems</strong>,{' '}
                    <strong className="text-[#252B32]">drawing</strong>, or{' '}
                    <strong className="text-[#252B32]">game</strong>.
                  </div>
                ) : (
                  searchResults.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleOpenCourse(item.course_id, null, item.id)}
                      className="skeuo-card skeuo-card-interactive p-5 cursor-pointer space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs font-mono text-[#73777C]">
                        <span className="font-bold text-[#315C83]">
                          {item.course_code} · {item.course_title}
                        </span>
                        <span>Relevance: {item.score}</span>
                      </div>
                      <h3 className="text-base font-extrabold text-[#252B32]">{item.title}</h3>
                      <p className="text-xs text-[#73777C]">{item.snippet}...</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* CERTIFICATE PREVIEW MODAL */}
      {previewCertCourse && (
        <div className="fixed inset-0 z-50 bg-[#252B32]/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="skeuo-card max-w-2xl w-full p-8 sm:p-10 space-y-6 relative border-2 border-[#B58A54]">
            <button
              onClick={() => setPreviewCertCourse(null)}
              className="absolute top-5 right-5 skeuo-btn p-2 text-[#252B32]"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="skeuo-tray p-8 text-center space-y-3 border-2 border-[#B58A54]/60">
              <div className="w-14 h-14 rounded-full bg-gradient-to-b from-[#C69B63] to-[#946D39] border-2 border-[#6A4C25] text-[#FFFDF9] flex items-center justify-center mx-auto shadow-md">
                <Award className="w-7 h-7" />
              </div>
              <p className="text-xs font-mono font-bold uppercase tracking-widest text-[#B58A54]">
                SmartLearn Academic Certificate
              </p>
              <p className="text-xs text-[#73777C]">This parchment certifies that</p>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#252B32] engraved-label">
                {user.full_name}
              </h2>
              <p className="text-xs text-[#73777C] max-w-md mx-auto">
                has demonstrated mastery and completed the prescribed curriculum for
              </p>
              <h3 className="text-xl font-extrabold text-[#315C83]">
                {previewCertCourse.code}: {previewCertCourse.title}
              </h3>
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-between gap-4 text-xs text-[#73777C]">
              <div>
                <p className="font-bold text-[#252B32]">{previewCertCourse.faculty_name}</p>
                <p>Lead Course Instructor</p>
              </div>
              <div className="text-right font-mono">
                <p className="font-bold text-[#252B32]">
                  Completion: {previewCertCourse.progress_percent}%
                </p>
                <p>Issued: {new Date().toISOString().slice(0, 10)}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => window.print()}
                className="skeuo-btn-primary px-5 py-2.5 text-xs inline-flex items-center gap-2"
              >
                <Printer className="w-3.5 h-3.5" />
                Print / Save PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

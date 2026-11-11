import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  BookOpen,
  GraduationCap,
  UserCheck,
  Plus,
  Search,
  Edit3,
  Trash2,
  Download,
  X,
  Eye,
} from 'lucide-react';
import {
  AdminOverviewPayload,
  Course,
  User,
  UserRole,
  Announcement,
} from '../types/lms';
import { apiFetch, downloadFileWithAuth } from '../utils/api';

export type AdminSection =
  | 'admin_dashboard'
  | 'admin_users'
  | 'admin_courses'
  | 'admin_academic'
  | 'admin_reports'
  | 'admin_announcements'
  | 'admin_settings';

interface AdminDashboardViewProps {
  currentUser: User;
  activeSection: AdminSection;
  onNavigateSection: (section: AdminSection) => void;
  onInspectCourse: (courseId: number) => void;
  onRefreshBootstrap: () => Promise<void>;
  notifyToast: (msg: string) => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  currentUser,
  activeSection,
  onInspectCourse,
  onRefreshBootstrap,
  notifyToast,
}) => {
  const [overview, setOverview] = useState<AdminOverviewPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  // Users page state
  const [userTab, setUserTab] = useState<'student' | 'faculty' | 'all'>('student');
  const [userSearch, setUserSearch] = useState('');
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<User | null>(null);

  const [newUserForm, setNewUserForm] = useState({
    username: '',
    full_name: '',
    email: '',
    password: '',
    role: 'student' as UserRole,
    department_id: '',
    batch_id: '',
  });

  const [editUserForm, setEditUserForm] = useState({
    full_name: '',
    email: '',
    role: 'student' as UserRole,
    status: 'active' as 'active' | 'deactivated',
    department_id: '',
    batch_id: '',
  });

  // Courses page state
  const [courseSubView, setCourseSubView] = useState<'catalog' | 'assignments'>('catalog');
  const [courseSearch, setCourseSearch] = useState('');
  const [courseStatusFilter, setCourseStatusFilter] = useState<'all' | 'approved' | 'pending' | 'archived'>('all');
  const [showCreateCourseModal, setShowCreateCourseModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [managingEnrollmentsCourse, setManagingEnrollmentsCourse] = useState<Course | null>(null);
  const [confirmDeleteCourse, setConfirmDeleteCourse] = useState<Course | null>(null);

  const [newCourseForm, setNewCourseForm] = useState({
    code: '',
    title: '',
    category: 'Computer Science',
    level: 'Intermediate',
    estimated_hours: 14,
    faculty_id: '',
    department_id: '',
    approval_status: 'approved' as 'approved' | 'pending' | 'archived',
    description: '',
  });

  const [editCourseForm, setEditCourseForm] = useState({
    code: '',
    title: '',
    category: '',
    level: '',
    estimated_hours: 14,
    faculty_id: '',
    department_id: '',
    approval_status: 'approved' as 'approved' | 'pending' | 'archived',
    description: '',
  });

  // Academics page state
  const [academicTab, setAcademicTab] = useState<'departments' | 'subjects' | 'classes' | 'semesters'>('departments');
  const [showAddAcademicModal, setShowAddAcademicModal] = useState(false);
  const [deptForm, setDeptForm] = useState({ code: '', name: '', head_faculty_id: '', description: '' });
  const [subjForm, setSubjForm] = useState({
    code: '',
    name: '',
    department_id: '',
    credits: 4,
    semester: 'Semester 1',
  });
  const [batchForm, setBatchForm] = useState({
    code: '',
    name: '',
    department_id: '',
    academic_year: '2025–2026',
    semester: 'Spring Semester',
    advisor_faculty_id: '',
    student_ids: [] as number[],
    course_ids: [] as number[],
  });

  // Reports page state
  const [reportType, setReportType] = useState<'performance' | 'courses' | 'teachers' | 'users'>('performance');
  const [reportSearch, setReportSearch] = useState('');

  // Announcements page state
  const [showCreateAnnouncementModal, setShowCreateAnnouncementModal] = useState(false);
  const [annForm, setAnnForm] = useState({
    title: '',
    body: '',
    target_audience: 'all' as 'all' | 'students' | 'teachers' | 'course',
    course_id: '',
  });
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [confirmDeleteAnnouncement, setConfirmDeleteAnnouncement] = useState<Announcement | null>(null);

  // Settings page state
  const [settingsTab, setSettingsTab] = useState<'general' | 'roles' | 'security'>('general');
  const [settingsForm, setSettingsForm] = useState({
    platform_name: '',
    institution_name: '',
    academic_session: '',
    current_semester: '',
    allow_self_registration: true,
    require_course_approval: false,
    maintenance_mode: false,
    default_weekly_goal_hours: 14,
  });

  const apiCall = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const res = await apiFetch(path, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data as T;
    },
    []
  );

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall<AdminOverviewPayload>('/api/admin/overview');
      setOverview(data);
      if (data.platform_settings) {
        setSettingsForm({
          platform_name: data.platform_settings.platform_name,
          institution_name: data.platform_settings.institution_name,
          academic_session: data.platform_settings.academic_session,
          current_semester: data.platform_settings.current_semester,
          allow_self_registration: data.platform_settings.allow_self_registration,
          require_course_approval: data.platform_settings.require_course_approval,
          maintenance_mode: data.platform_settings.maintenance_mode,
          default_weekly_goal_hours: data.platform_settings.default_weekly_goal_hours,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Administrator Dashboard');
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // --- Handlers: Users ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          ...newUserForm,
          department_id: newUserForm.department_id ? Number(newUserForm.department_id) : null,
          batch_id: newUserForm.batch_id ? Number(newUserForm.batch_id) : null,
        }),
      });
      setOverview(res.overview);
      setShowCreateUserModal(false);
      setNewUserForm({
        username: '',
        full_name: '',
        email: '',
        password: '',
        role: 'student',
        department_id: '',
        batch_id: '',
      });
      await onRefreshBootstrap();
      notifyToast('User added.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setBusy(false);
    }
  };

  const openEditUser = (u: User) => {
    setEditingUser(u);
    setNewPasswordInput('');
    setEditUserForm({
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      status: u.status || 'active',
      department_id: u.department_id ? String(u.department_id) : '',
      batch_id: u.batch_id ? String(u.batch_id) : '',
    });
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setBusy(true);
    try {
      let latestOverview: AdminOverviewPayload | null = null;
      const res = await apiCall<{ overview: AdminOverviewPayload }>(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          full_name: editUserForm.full_name,
          email: editUserForm.email,
          role: editUserForm.role,
          department_id: editUserForm.department_id ? Number(editUserForm.department_id) : null,
          batch_id: editUserForm.batch_id ? Number(editUserForm.batch_id) : null,
        }),
      });
      latestOverview = res.overview;

      if (editingUser.id !== currentUser.id && editUserForm.status !== (editingUser.status || 'active')) {
        const statusRes = await apiCall<{ overview: AdminOverviewPayload }>(
          `/api/admin/users/${editingUser.id}/status`,
          {
            method: 'POST',
            body: JSON.stringify({ status: editUserForm.status }),
          }
        );
        latestOverview = statusRes.overview;
      }

      if (newPasswordInput.trim().length > 0) {
        const pwRes = await apiCall<{ overview: AdminOverviewPayload }>(
          `/api/admin/users/${editingUser.id}/reset-password`,
          {
            method: 'POST',
            body: JSON.stringify({ new_password: newPasswordInput.trim() }),
          }
        );
        latestOverview = pwRes.overview;
      }

      if (latestOverview) setOverview(latestOverview);
      setEditingUser(null);
      setNewPasswordInput('');
      await onRefreshBootstrap();
      notifyToast('User updated.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!confirmDeleteUser) return;
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(
        `/api/admin/users/${confirmDeleteUser.id}`,
        { method: 'DELETE' }
      );
      setOverview(res.overview);
      setConfirmDeleteUser(null);
      await onRefreshBootstrap();
      notifyToast('User deleted.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusy(false);
    }
  };

  // --- Handlers: Courses ---
  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>('/api/admin/courses', {
        method: 'POST',
        body: JSON.stringify({
          ...newCourseForm,
          published: newCourseForm.approval_status === 'approved',
          faculty_id: newCourseForm.faculty_id ? Number(newCourseForm.faculty_id) : undefined,
          department_id: newCourseForm.department_id ? Number(newCourseForm.department_id) : null,
        }),
      });
      setOverview(res.overview);
      setShowCreateCourseModal(false);
      setNewCourseForm({
        code: '',
        title: '',
        category: 'Computer Science',
        level: 'Intermediate',
        estimated_hours: 14,
        faculty_id: '',
        department_id: '',
        approval_status: 'approved',
        description: '',
      });
      await onRefreshBootstrap();
      notifyToast('Course created.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to create course');
    } finally {
      setBusy(false);
    }
  };

  const openEditCourse = (c: Course) => {
    setEditingCourse(c);
    setEditCourseForm({
      code: c.code,
      title: c.title,
      category: c.category,
      level: c.level,
      estimated_hours: c.estimated_hours || 14,
      faculty_id: String(c.faculty_id),
      department_id: c.department_id ? String(c.department_id) : '',
      approval_status: c.approval_status || 'approved',
      description: c.description || '',
    });
  };

  const handleUpdateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourse) return;
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(`/api/admin/courses/${editingCourse.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...editCourseForm,
          published: editCourseForm.approval_status === 'approved',
          faculty_id: editCourseForm.faculty_id ? Number(editCourseForm.faculty_id) : undefined,
          department_id: editCourseForm.department_id ? Number(editCourseForm.department_id) : null,
        }),
      });
      setOverview(res.overview);
      setEditingCourse(null);
      await onRefreshBootstrap();
      notifyToast('Course updated.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to update course');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnrollment = async (courseId: number, studentId: number, enrolled: boolean) => {
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(
        `/api/admin/courses/${courseId}/enrollments`,
        {
          method: 'POST',
          body: JSON.stringify({
            student_id: studentId,
            action: enrolled ? 'unenroll' : 'enroll',
          }),
        }
      );
      setOverview(res.overview);
      await onRefreshBootstrap();
      notifyToast(enrolled ? 'Student unenrolled.' : 'Student enrolled.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to update enrollment');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!confirmDeleteCourse) return;
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(
        `/api/admin/courses/${confirmDeleteCourse.id}`,
        { method: 'DELETE' }
      );
      setOverview(res.overview);
      setConfirmDeleteCourse(null);
      await onRefreshBootstrap();
      notifyToast('Course deleted.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to delete course');
    } finally {
      setBusy(false);
    }
  };

  // --- Handlers: Academics ---
  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>('/api/admin/departments', {
        method: 'POST',
        body: JSON.stringify({
          ...deptForm,
          head_faculty_id: deptForm.head_faculty_id ? Number(deptForm.head_faculty_id) : null,
        }),
      });
      setOverview(res.overview);
      setDeptForm({ code: '', name: '', head_faculty_id: '', description: '' });
      setShowAddAcademicModal(false);
      notifyToast('Department added.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to add department');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDepartment = async (id: number) => {
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(`/api/admin/departments/${id}`, {
        method: 'DELETE',
      });
      setOverview(res.overview);
      notifyToast('Department deleted.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to delete department');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>('/api/admin/subjects', {
        method: 'POST',
        body: JSON.stringify({
          ...subjForm,
          department_id: subjForm.department_id ? Number(subjForm.department_id) : null,
        }),
      });
      setOverview(res.overview);
      setSubjForm({ code: '', name: '', department_id: '', credits: 4, semester: 'Semester 1' });
      setShowAddAcademicModal(false);
      notifyToast('Subject added.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to add subject');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSubject = async (id: number) => {
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(`/api/admin/subjects/${id}`, {
        method: 'DELETE',
      });
      setOverview(res.overview);
      notifyToast('Subject deleted.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to delete subject');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>('/api/admin/batches', {
        method: 'POST',
        body: JSON.stringify({
          ...batchForm,
          department_id: batchForm.department_id ? Number(batchForm.department_id) : null,
          advisor_faculty_id: batchForm.advisor_faculty_id ? Number(batchForm.advisor_faculty_id) : null,
        }),
      });
      setOverview(res.overview);
      setBatchForm({
        code: '',
        name: '',
        department_id: '',
        academic_year: '2025–2026',
        semester: 'Spring Semester',
        advisor_faculty_id: '',
        student_ids: [],
        course_ids: [],
      });
      setShowAddAcademicModal(false);
      await onRefreshBootstrap();
      notifyToast('Class created.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to create class');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBatch = async (id: number) => {
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(`/api/admin/batches/${id}`, {
        method: 'DELETE',
      });
      setOverview(res.overview);
      notifyToast('Class deleted.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to delete class');
    } finally {
      setBusy(false);
    }
  };

  // --- Handlers: Announcements ---
  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({
          ...annForm,
          course_id: annForm.target_audience === 'course' && annForm.course_id ? Number(annForm.course_id) : null,
        }),
      });
      setOverview(res.overview);
      setAnnForm({ title: '', body: '', target_audience: 'all', course_id: '' });
      setShowCreateAnnouncementModal(false);
      await onRefreshBootstrap();
      notifyToast('Announcement published.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to publish announcement');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAnnouncement) return;
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(
        `/api/admin/announcements/${editingAnnouncement.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            title: editingAnnouncement.title,
            body: editingAnnouncement.body,
            target_audience: editingAnnouncement.target_audience || 'all',
            course_id: editingAnnouncement.course_id,
          }),
        }
      );
      setOverview(res.overview);
      setEditingAnnouncement(null);
      await onRefreshBootstrap();
      notifyToast('Announcement updated.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to update announcement');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAnnouncement = async () => {
    if (!confirmDeleteAnnouncement) return;
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>(
        `/api/admin/announcements/${confirmDeleteAnnouncement.id}`,
        { method: 'DELETE' }
      );
      setOverview(res.overview);
      setConfirmDeleteAnnouncement(null);
      await onRefreshBootstrap();
      notifyToast('Announcement deleted.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to delete announcement');
    } finally {
      setBusy(false);
    }
  };

  // --- Handlers: Settings & Exports ---
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiCall<{ overview: AdminOverviewPayload }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settingsForm),
      });
      setOverview(res.overview);
      notifyToast('Settings saved.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBackup = async () => {
    setBusy(true);
    try {
      const res = await apiCall<{ filename: string; overview: AdminOverviewPayload }>('/api/admin/backup', {
        method: 'POST',
      });
      setOverview(res.overview);
      notifyToast(`Backup created: ${res.filename}`);
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadCsvReport = async (type: 'users' | 'courses' | 'performance') => {
    try {
      await downloadFileWithAuth(`/api/admin/export/${type}`, `smartlearn-${type}-report.csv`);
      notifyToast('CSV report exported.');
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Failed to export CSV');
    }
  };

  if (loading && !overview) {
    return (
      <div className="py-16 text-center text-sm text-[#73777C]">
        Loading dashboard data...
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="bg-[#FAF8F5] border border-[#D8D1C5] rounded-xl p-6 flex items-center justify-between">
        <p className="text-sm text-[#B85C55]">{error || 'Unable to load database records.'}</p>
        <button
          onClick={fetchOverview}
          className="px-3.5 py-2 text-xs font-medium bg-white border border-[#D8D1C5] rounded-lg text-[#252B32] hover:bg-[#F4F0E8]"
        >
          Retry
        </button>
      </div>
    );
  }

  const { stats, analytics, users, courses, enrollments, departments, subjects, batches } = overview;
  const teachersList = users.filter((u) => u.role === 'faculty');
  const studentsList = users.filter((u) => u.role === 'student');

  const filteredUsers = users.filter((u) => {
    if (userTab !== 'all' && u.role !== userTab) return false;
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  const filteredCourses = courses.filter((c) => {
    if (courseStatusFilter !== 'all' && (c.approval_status || 'approved') !== courseStatusFilter) {
      return false;
    }
    const q = courseSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.code.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.faculty_name.toLowerCase().includes(q)
    );
  });

  const maxCourseEnrollment = Math.max(
    1,
    ...courses.map((c) => c.student_count)
  );

  return (
    <div className="space-y-8 pb-10">
      {/* =====================================================================
          1. DASHBOARD OVERVIEW (4 Essential Stat Cards + Enrollment Chart + Recent Activity)
      ===================================================================== */}
      {activeSection === 'admin_dashboard' && (
        <div className="space-y-8">
          <div>
            <h1 className="text-xl font-semibold text-[#252B32]">Dashboard Overview</h1>
          </div>

          {/* Four Essential Statistic Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#73777C] font-medium">Total Students</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1 tabular-nums">
                  {stats.total_students}
                </p>
              </div>
              <GraduationCap className="w-4 h-4 text-[#73777C]" />
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#73777C] font-medium">Total Teachers</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1 tabular-nums">
                  {stats.total_teachers}
                </p>
              </div>
              <Users className="w-4 h-4 text-[#73777C]" />
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#73777C] font-medium">Total Courses</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1 tabular-nums">
                  {stats.total_courses}
                </p>
              </div>
              <BookOpen className="w-4 h-4 text-[#73777C]" />
            </div>

            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#73777C] font-medium">Total Enrollments</p>
                <p className="text-2xl font-semibold text-[#252B32] mt-1 tabular-nums">
                  {stats.total_enrollments}
                </p>
              </div>
              <UserCheck className="w-4 h-4 text-[#73777C]" />
            </div>
          </div>

          {/* Below Statistics: Enrollment Overview Chart & Compact Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Simple Enrollment Overview Chart */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-[#252B32] mb-4">Enrollment Overview</h2>
              {courses.length === 0 ? (
                <p className="text-xs text-[#73777C] py-6 text-center">
                  No courses or enrollments recorded yet.
                </p>
              ) : (
                <div className="space-y-3.5">
                  {courses.map((c) => {
                    const widthPct = Math.round((c.student_count / maxCourseEnrollment) * 100);
                    return (
                      <div key={c.id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-[#252B32] truncate pr-3">
                            {c.code} · {c.title}
                          </span>
                          <span className="text-[#73777C] font-mono tabular-nums shrink-0">
                            {c.student_count} {c.student_count === 1 ? 'student' : 'students'}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-[#EAE4DA] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#315C83] rounded-full transition-all"
                            style={{ width: `${Math.max(c.student_count > 0 ? 6 : 0, widthPct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Compact Recent Activity Section */}
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-[#252B32] mb-4">Recent Activity</h2>
              {overview.audit_logs.length === 0 && overview.login_activity.length === 0 ? (
                <p className="text-xs text-[#73777C] py-6 text-center">
                  No recent activity recorded yet.
                </p>
              ) : (
                <div className="divide-y divide-[#EAE4DA]">
                  {overview.audit_logs.slice(0, 6).map((log) => (
                    <div key={`audit-${log.id}`} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-[#252B32]">{log.action}</span>
                        <span className="text-[#73777C]"> · {log.target_label}</span>
                      </div>
                      <span className="text-[#73777C] font-mono tabular-nums shrink-0">
                        {new Date(log.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                  {overview.audit_logs.length === 0 &&
                    overview.login_activity.slice(0, 6).map((ev) => (
                      <div key={`login-${ev.id}`} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4 text-xs">
                        <div className="min-w-0">
                          <span className="font-medium text-[#252B32]">@{ev.username}</span>
                          <span className="text-[#73777C]"> · {ev.message}</span>
                        </div>
                        <span className="text-[#73777C] font-mono tabular-nums shrink-0">
                          {new Date(ev.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. USERS (Simple Student/Teacher Tabs, Search Bar, One Clean Table)
      ===================================================================== */}
      {activeSection === 'admin_users' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-xl font-semibold text-[#252B32]">Users</h1>
            <button
              onClick={() => setShowCreateUserModal(true)}
              className="px-4 py-2 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add User
            </button>
          </div>

          {/* Simple Tabs & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex p-1 bg-[#EAE4DA] rounded-lg">
              {(
                [
                  { id: 'student', label: `Students (${stats.total_students})` },
                  { id: 'faculty', label: `Teachers (${stats.total_teachers})` },
                  { id: 'all', label: `All (${users.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setUserTab(tab.id)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    userTab === tab.id
                      ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                      : 'text-[#73777C] hover:text-[#252B32]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#73777C] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
              />
            </div>
          </div>

          {/* One Clean User Table */}
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl overflow-hidden">
            {filteredUsers.length === 0 ? (
              <p className="p-8 text-center text-xs text-[#73777C]">
                {userTab === 'student'
                  ? 'No students registered yet.'
                  : userTab === 'faculty'
                    ? 'No teachers registered yet.'
                    : 'No users found.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                      <th className="py-3 px-4">Name</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Courses</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA]">
                    {filteredUsers.map((u) => {
                      const courseMetric =
                        u.role === 'student'
                          ? `${u.enrolled_course_count ?? 0} enrolled`
                          : u.role === 'faculty'
                            ? `${u.assigned_course_count ?? 0} assigned`
                            : 'All';
                      return (
                        <tr key={u.id} className="hover:bg-[#F3EFE6]/60">
                          <td className="py-3 px-4">
                            <div className="font-medium text-[#252B32]">{u.full_name}</div>
                            <div className="text-[#73777C]">@{u.username}</div>
                          </td>
                          <td className="py-3 px-4 text-[#73777C]">{u.email}</td>
                          <td className="py-3 px-4 capitalize text-[#252B32]">
                            {u.role === 'faculty' ? 'Teacher' : u.role}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={
                                u.status === 'deactivated'
                                  ? 'text-[#B85C55]'
                                  : 'text-[#54866A]'
                              }
                            >
                              {u.status === 'deactivated' ? 'Deactivated' : 'Active'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#73777C] tabular-nums">{courseMetric}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => openEditUser(u)}
                                className="p-1.5 text-[#73777C] hover:text-[#252B32] rounded hover:bg-[#EAE4DA] cursor-pointer"
                                title="Edit User"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {u.id !== currentUser.id && (
                                <button
                                  onClick={() => setConfirmDeleteUser(u)}
                                  className="p-1.5 text-[#73777C] hover:text-[#B85C55] rounded hover:bg-[#EAE4DA] cursor-pointer"
                                  title="Delete User"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          3. COURSES (Simple Course Listing, Search & Filter, Add Course, Assignments Monitor)
      ===================================================================== */}
      {activeSection === 'admin_courses' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-xl font-semibold text-[#252B32]">Courses</h1>
            <button
              onClick={() => setShowCreateCourseModal(true)}
              className="px-4 py-2 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Course
            </button>
          </div>

          {/* Sub-view selector (Courses vs Course Assignments) + Filters */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex p-1 bg-[#EAE4DA] rounded-lg">
                <button
                  onClick={() => setCourseSubView('catalog')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    courseSubView === 'catalog'
                      ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                      : 'text-[#73777C] hover:text-[#252B32]'
                  }`}
                >
                  Courses ({courses.length})
                </button>
                <button
                  onClick={() => setCourseSubView('assignments')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    courseSubView === 'assignments'
                      ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                      : 'text-[#73777C] hover:text-[#252B32]'
                  }`}
                >
                  Assignments ({overview.assignments_monitoring.length})
                </button>
              </div>

              {courseSubView === 'catalog' && (
                <select
                  value={courseStatusFilter}
                  onChange={(e) =>
                    setCourseStatusFilter(e.target.value as 'all' | 'approved' | 'pending' | 'archived')
                  }
                  className="px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg text-[#252B32]"
                >
                  <option value="all">All Statuses</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending Approval</option>
                  <option value="archived">Archived</option>
                </select>
              )}
            </div>

            {courseSubView === 'catalog' && (
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-[#73777C] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={courseSearch}
                  onChange={(e) => setCourseSearch(e.target.value)}
                  placeholder="Search courses..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
                />
              </div>
            )}
          </div>

          {courseSubView === 'catalog' ? (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl overflow-hidden">
              {filteredCourses.length === 0 ? (
                <p className="p-8 text-center text-xs text-[#73777C]">No courses found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                        <th className="py-3 px-4">Course</th>
                        <th className="py-3 px-4">Teacher</th>
                        <th className="py-3 px-4">Students</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4DA]">
                      {filteredCourses.map((c) => (
                        <tr key={c.id} className="hover:bg-[#F3EFE6]/60">
                          <td className="py-3 px-4">
                            <div className="font-medium text-[#252B32]">
                              <span className="font-mono text-[#315C83] mr-2">{c.code}</span>
                              {c.title}
                            </div>
                            <div className="text-[#73777C]">
                              {c.category} · {c.material_count} lessons
                            </div>
                          </td>
                          <td className="py-3 px-4 text-[#252B32]">{c.faculty_name}</td>
                          <td className="py-3 px-4 tabular-nums">
                            <button
                              onClick={() => setManagingEnrollmentsCourse(c)}
                              className="text-[#315C83] hover:underline cursor-pointer"
                            >
                              {c.student_count} enrolled
                            </button>
                          </td>
                          <td className="py-3 px-4 capitalize">
                            <span
                              className={
                                c.approval_status === 'pending'
                                  ? 'text-[#D49A43]'
                                  : c.approval_status === 'archived'
                                    ? 'text-[#73777C]'
                                    : 'text-[#54866A]'
                              }
                            >
                              {c.approval_status || 'approved'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => onInspectCourse(c.id)}
                                className="p-1.5 text-[#73777C] hover:text-[#252B32] rounded hover:bg-[#EAE4DA] cursor-pointer"
                                title="View Course Content"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => openEditCourse(c)}
                                className="p-1.5 text-[#73777C] hover:text-[#252B32] rounded hover:bg-[#EAE4DA] cursor-pointer"
                                title="Edit Course"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteCourse(c)}
                                className="p-1.5 text-[#73777C] hover:text-[#B85C55] rounded hover:bg-[#EAE4DA] cursor-pointer"
                                title="Delete Course"
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
          ) : (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl overflow-hidden">
              {overview.assignments_monitoring.length === 0 ? (
                <p className="p-8 text-center text-xs text-[#73777C]">No assignments created yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                        <th className="py-3 px-4">Assignment</th>
                        <th className="py-3 px-4">Course & Teacher</th>
                        <th className="py-3 px-4">Due Date</th>
                        <th className="py-3 px-4">Submissions</th>
                        <th className="py-3 px-4">Graded</th>
                        <th className="py-3 px-4">Average</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4DA]">
                      {overview.assignments_monitoring.map((a) => (
                        <tr key={a.id} className="hover:bg-[#F3EFE6]/60">
                          <td className="py-3 px-4 font-medium text-[#252B32]">{a.title}</td>
                          <td className="py-3 px-4 text-[#73777C]">
                            {a.course_code} · {a.faculty_name}
                          </td>
                          <td className="py-3 px-4 text-[#73777C] font-mono">
                            {new Date(a.due_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 tabular-nums">
                            {a.submission_count} / {a.enrolled_students}
                          </td>
                          <td className="py-3 px-4 tabular-nums">{a.graded_count}</td>
                          <td className="py-3 px-4 font-mono tabular-nums text-[#252B32]">
                            {a.average_score !== null ? `${a.average_score} / ${a.max_score}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          4. ACADEMICS (Simple Tabs for Departments, Subjects, Classes, Semesters)
      ===================================================================== */}
      {activeSection === 'admin_academic' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-xl font-semibold text-[#252B32]">Academics</h1>
            {academicTab !== 'semesters' && (
              <button
                onClick={() => setShowAddAcademicModal(true)}
                className="px-4 py-2 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {academicTab === 'departments' && 'Add Department'}
                {academicTab === 'subjects' && 'Add Subject'}
                {academicTab === 'classes' && 'Add Class'}
              </button>
            )}
          </div>

          <div className="inline-flex p-1 bg-[#EAE4DA] rounded-lg">
            {(
              [
                { id: 'departments', label: `Departments (${departments.length})` },
                { id: 'subjects', label: `Subjects (${subjects.length})` },
                { id: 'classes', label: `Classes (${batches.length})` },
                { id: 'semesters', label: 'Semesters' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAcademicTab(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  academicTab === tab.id
                    ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                    : 'text-[#73777C] hover:text-[#252B32]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Departments Table */}
          {academicTab === 'departments' && (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl overflow-hidden">
              {departments.length === 0 ? (
                <p className="p-8 text-center text-xs text-[#73777C]">No departments created yet.</p>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Department Name</th>
                      <th className="py-3 px-4">Head of Department</th>
                      <th className="py-3 px-4">Courses</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA]">
                    {departments.map((d) => (
                      <tr key={d.id} className="hover:bg-[#F3EFE6]/60">
                        <td className="py-3 px-4 font-mono text-[#315C83]">{d.code}</td>
                        <td className="py-3 px-4 font-medium text-[#252B32]">{d.name}</td>
                        <td className="py-3 px-4 text-[#73777C]">{d.head_faculty_name}</td>
                        <td className="py-3 px-4 text-[#73777C] tabular-nums">{d.course_count || 0}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteDepartment(d.id)}
                            className="p-1.5 text-[#73777C] hover:text-[#B85C55] rounded hover:bg-[#EAE4DA] cursor-pointer"
                            title="Delete Department"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Subjects Table */}
          {academicTab === 'subjects' && (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl overflow-hidden">
              {subjects.length === 0 ? (
                <p className="p-8 text-center text-xs text-[#73777C]">No subjects created yet.</p>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Subject Name</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Credits</th>
                      <th className="py-3 px-4">Semester</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA]">
                    {subjects.map((s) => (
                      <tr key={s.id} className="hover:bg-[#F3EFE6]/60">
                        <td className="py-3 px-4 font-mono text-[#315C83]">{s.code}</td>
                        <td className="py-3 px-4 font-medium text-[#252B32]">{s.name}</td>
                        <td className="py-3 px-4 text-[#73777C]">{s.department_name}</td>
                        <td className="py-3 px-4 tabular-nums">{s.credits}</td>
                        <td className="py-3 px-4 text-[#73777C]">{s.semester}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteSubject(s.id)}
                            className="p-1.5 text-[#73777C] hover:text-[#B85C55] rounded hover:bg-[#EAE4DA] cursor-pointer"
                            title="Delete Subject"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Classes / Batches Table */}
          {academicTab === 'classes' && (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl overflow-hidden">
              {batches.length === 0 ? (
                <p className="p-8 text-center text-xs text-[#73777C]">No classes created yet.</p>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Class Name</th>
                      <th className="py-3 px-4">Session & Semester</th>
                      <th className="py-3 px-4">Advisor</th>
                      <th className="py-3 px-4">Students</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA]">
                    {batches.map((b) => (
                      <tr key={b.id} className="hover:bg-[#F3EFE6]/60">
                        <td className="py-3 px-4 font-mono text-[#315C83]">{b.code}</td>
                        <td className="py-3 px-4 font-medium text-[#252B32]">{b.name}</td>
                        <td className="py-3 px-4 text-[#73777C]">
                          {b.academic_year} · {b.semester}
                        </td>
                        <td className="py-3 px-4 text-[#73777C]">{b.advisor_faculty_name}</td>
                        <td className="py-3 px-4 tabular-nums">{b.student_ids.length}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteBatch(b.id)}
                            className="p-1.5 text-[#73777C] hover:text-[#B85C55] rounded hover:bg-[#EAE4DA] cursor-pointer"
                            title="Delete Class"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Semesters Configuration */}
          {academicTab === 'semesters' && (
            <form
              onSubmit={handleSaveSettings}
              className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6 max-w-xl space-y-4"
            >
              <h2 className="text-sm font-semibold text-[#252B32]">Active Academic Session & Semester</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[#73777C] mb-1">Academic Session</label>
                  <input
                    type="text"
                    required
                    value={settingsForm.academic_session}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, academic_session: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#73777C] mb-1">Active Semester</label>
                  <input
                    type="text"
                    required
                    value={settingsForm.current_semester}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, current_semester: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32]"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] cursor-pointer"
              >
                Save Academic Session
              </button>
            </form>
          )}
        </div>
      )}

      {/* =====================================================================
          5. REPORTS (Clean List of Available Reports, Essential Filters, Export Button)
      ===================================================================== */}
      {activeSection === 'admin_reports' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-xl font-semibold text-[#252B32]">Reports</h1>
            <button
              onClick={() =>
                handleDownloadCsvReport(
                  reportType === 'teachers' ? 'users' : reportType === 'courses' ? 'courses' : reportType === 'users' ? 'users' : 'performance'
                )
              }
              className="px-4 py-2 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex p-1 bg-[#EAE4DA] rounded-lg">
              {(
                [
                  { id: 'performance', label: 'Student Performance' },
                  { id: 'courses', label: 'Course Engagement' },
                  { id: 'teachers', label: 'Teacher Activity' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setReportType(tab.id)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    reportType === tab.id
                      ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                      : 'text-[#73777C] hover:text-[#252B32]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#73777C] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={reportSearch}
                onChange={(e) => setReportSearch(e.target.value)}
                placeholder="Filter report rows..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DDD6CA] rounded-lg text-[#252B32] focus:outline-none focus:border-[#315C83]"
              />
            </div>
          </div>

          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl overflow-hidden">
            {reportType === 'performance' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                      <th className="py-3 px-4">Student</th>
                      <th className="py-3 px-4">Enrolled Courses</th>
                      <th className="py-3 px-4">Completed Lessons</th>
                      <th className="py-3 px-4">Submissions</th>
                      <th className="py-3 px-4">Completion Rate</th>
                      <th className="py-3 px-4">Average Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA]">
                    {analytics.student_performance
                      .filter(
                        (s) =>
                          !reportSearch.trim() ||
                          s.full_name.toLowerCase().includes(reportSearch.toLowerCase()) ||
                          s.username.toLowerCase().includes(reportSearch.toLowerCase())
                      )
                      .map((s) => (
                        <tr key={s.student_id} className="hover:bg-[#F3EFE6]/60">
                          <td className="py-3 px-4">
                            <span className="font-medium text-[#252B32]">{s.full_name}</span>
                            <span className="text-[#73777C] ml-1.5">@{s.username}</span>
                          </td>
                          <td className="py-3 px-4 tabular-nums">{s.enrolled_courses}</td>
                          <td className="py-3 px-4 tabular-nums">{s.completed_lessons}</td>
                          <td className="py-3 px-4 tabular-nums">{s.submissions_count}</td>
                          <td className="py-3 px-4 tabular-nums">{s.average_completion_percent}%</td>
                          <td className="py-3 px-4 font-mono tabular-nums">
                            {s.average_grade !== null ? `${s.average_grade}%` : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {reportType === 'courses' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                      <th className="py-3 px-4">Course</th>
                      <th className="py-3 px-4">Teacher</th>
                      <th className="py-3 px-4">Students</th>
                      <th className="py-3 px-4">Lessons</th>
                      <th className="py-3 px-4">Avg Completion</th>
                      <th className="py-3 px-4">Avg Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA]">
                    {analytics.course_engagement
                      .filter(
                        (c) =>
                          !reportSearch.trim() ||
                          c.course_title.toLowerCase().includes(reportSearch.toLowerCase()) ||
                          c.course_code.toLowerCase().includes(reportSearch.toLowerCase())
                      )
                      .map((c) => (
                        <tr key={c.course_id} className="hover:bg-[#F3EFE6]/60">
                          <td className="py-3 px-4 font-medium text-[#252B32]">
                            <span className="font-mono text-[#315C83] mr-2">{c.course_code}</span>
                            {c.course_title}
                          </td>
                          <td className="py-3 px-4 text-[#73777C]">{c.faculty_name}</td>
                          <td className="py-3 px-4 tabular-nums">{c.enrolled_students}</td>
                          <td className="py-3 px-4 tabular-nums">{c.material_count}</td>
                          <td className="py-3 px-4 tabular-nums">{c.average_completion_percent}%</td>
                          <td className="py-3 px-4 font-mono tabular-nums">
                            {c.average_grade !== null ? `${c.average_grade}%` : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {reportType === 'teachers' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAE4DA] text-[#73777C] font-medium">
                      <th className="py-3 px-4">Teacher</th>
                      <th className="py-3 px-4">Assigned Courses</th>
                      <th className="py-3 px-4">Materials Uploaded</th>
                      <th className="py-3 px-4">Assignments Created</th>
                      <th className="py-3 px-4">Evaluated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4DA]">
                    {analytics.teacher_activity
                      .filter(
                        (t) =>
                          !reportSearch.trim() ||
                          t.full_name.toLowerCase().includes(reportSearch.toLowerCase())
                      )
                      .map((t) => (
                        <tr key={t.faculty_id} className="hover:bg-[#F3EFE6]/60">
                          <td className="py-3 px-4">
                            <span className="font-medium text-[#252B32]">{t.full_name}</span>
                            <span className="text-[#73777C] ml-1.5">@{t.username}</span>
                          </td>
                          <td className="py-3 px-4 tabular-nums">{t.assigned_courses}</td>
                          <td className="py-3 px-4 tabular-nums">{t.materials_uploaded}</td>
                          <td className="py-3 px-4 tabular-nums">{t.assignments_created}</td>
                          <td className="py-3 px-4 tabular-nums">{t.submissions_evaluated}</td>
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
          6. ANNOUNCEMENTS (Simple Announcement List + Create Button + Edit/Delete)
      ===================================================================== */}
      {activeSection === 'admin_announcements' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-xl font-semibold text-[#252B32]">Announcements</h1>
            <button
              onClick={() => setShowCreateAnnouncementModal(true)}
              className="px-4 py-2 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Announcement
            </button>
          </div>

          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl divide-y divide-[#EAE4DA]">
            {overview.announcements.length === 0 ? (
              <p className="p-8 text-center text-xs text-[#73777C]">No announcements published yet.</p>
            ) : (
              overview.announcements.map((a) => (
                <div key={a.id} className="p-5 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-[#73777C]">
                      <span className="font-medium text-[#315C83]">
                        {a.course_code || 'Platform'}
                      </span>
                      <span>·</span>
                      <span className="capitalize">Audience: {a.target_audience || 'course'}</span>
                      <span>·</span>
                      <span>{new Date(a.created_at).toLocaleDateString()}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-[#252B32]">{a.title}</h3>
                    <p className="text-xs text-[#73777C] leading-relaxed whitespace-pre-line">{a.body}</p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setEditingAnnouncement(a)}
                      className="p-1.5 text-[#73777C] hover:text-[#252B32] rounded hover:bg-[#EAE4DA] cursor-pointer"
                      title="Edit Announcement"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteAnnouncement(a)}
                      className="p-1.5 text-[#73777C] hover:text-[#B85C55] rounded hover:bg-[#EAE4DA] cursor-pointer"
                      title="Delete Announcement"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          7. SETTINGS (Grouped Logically: General, Roles & Permissions, Security & Logs)
      ===================================================================== */}
      {activeSection === 'admin_settings' && (
        <div className="space-y-6">
          <h1 className="text-xl font-semibold text-[#252B32]">Settings</h1>

          <div className="inline-flex p-1 bg-[#EAE4DA] rounded-lg">
            {(
              [
                { id: 'general', label: 'General & Backups' },
                { id: 'roles', label: 'Roles & Permissions' },
                { id: 'security', label: 'Security Logs' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSettingsTab(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  settingsTab === tab.id
                    ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs'
                    : 'text-[#73777C] hover:text-[#252B32]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {settingsTab === 'general' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form
                onSubmit={handleSaveSettings}
                className="lg:col-span-2 bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6 space-y-5"
              >
                <h2 className="text-sm font-semibold text-[#252B32]">Platform Preferences</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#73777C] mb-1">Platform Name</label>
                    <input
                      type="text"
                      required
                      value={settingsForm.platform_name}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, platform_name: e.target.value })
                      }
                      className="w-full px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#73777C] mb-1">Institution Name</label>
                    <input
                      type="text"
                      required
                      value={settingsForm.institution_name}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, institution_name: e.target.value })
                      }
                      className="w-full px-3 py-2 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32]"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-[#EAE4DA]">
                  <label className="flex items-center justify-between py-1 cursor-pointer">
                    <div>
                      <div className="text-xs font-medium text-[#252B32]">Allow Self-Registration</div>
                      <div className="text-[11px] text-[#73777C]">
                        Allow new students and teachers to register accounts
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settingsForm.allow_self_registration}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          allow_self_registration: e.target.checked,
                        })
                      }
                      className=" accent-[#315C83] w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between py-1 cursor-pointer">
                    <div>
                      <div className="text-xs font-medium text-[#252B32]">
                        Require Approval for New Courses
                      </div>
                      <div className="text-[11px] text-[#73777C]">
                        Place teacher-created courses in pending state until approved
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settingsForm.require_course_approval}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          require_course_approval: e.target.checked,
                        })
                      }
                      className="accent-[#315C83] w-4 h-4"
                    />
                  </label>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] cursor-pointer"
                  >
                    Save Settings
                  </button>
                </div>
              </form>

              <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#252B32]">Database Backups</h2>
                  <button
                    onClick={handleCreateBackup}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-medium bg-[#315C83] text-white rounded-lg hover:bg-[#274B6B] cursor-pointer"
                  >
                    Create Backup
                  </button>
                </div>
                {overview.backups.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-4 text-center">No backups created yet.</p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA] text-xs">
                    {overview.backups.map((b) => (
                      <div key={b.filename} className="py-2.5 flex items-center justify-between gap-2">
                        <div className="truncate">
                          <div className="font-mono text-[#252B32] truncate">{b.filename}</div>
                          <div className="text-[11px] text-[#73777C]">
                            {(b.bytes / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            downloadFileWithAuth(
                              `/api/os/backups/${encodeURIComponent(b.filename)}`,
                              b.filename
                            ).catch((err) => notifyToast(err instanceof Error ? err.message : 'Download failed'));
                          }}
                          className="text-[#315C83] hover:underline shrink-0 text-left"
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {settingsTab === 'roles' && (
            <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-[#252B32]">Role Permissions</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-4 bg-white border border-[#EAE4DA] rounded-lg space-y-1.5">
                  <div className="font-semibold text-[#252B32]">Administrator</div>
                  <p className="text-[#73777C]">
                    Full access to user accounts, course governance, academic structures, reports, announcements, and platform settings.
                  </p>
                </div>
                <div className="p-4 bg-white border border-[#EAE4DA] rounded-lg space-y-1.5">
                  <div className="font-semibold text-[#252B32]">Teacher</div>
                  <p className="text-[#73777C]">
                    Manage assigned courses, publish lessons, create assignments, evaluate student submissions, and post course notices.
                  </p>
                </div>
                <div className="p-4 bg-white border border-[#EAE4DA] rounded-lg space-y-1.5">
                  <div className="font-semibold text-[#252B32]">Student</div>
                  <p className="text-[#73777C]">
                    Enroll in approved courses, study lessons, submit assignments, view grades and feedback, and track personal progress.
                  </p>
                </div>
              </div>
            </div>
          )}

          {settingsTab === 'security' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6">
                <h2 className="text-sm font-semibold text-[#252B32] mb-3">Login Activity</h2>
                {overview.login_activity.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-6 text-center">No login events recorded yet.</p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA] text-xs max-h-80 overflow-y-auto">
                    {overview.login_activity.map((ev) => (
                      <div key={ev.id} className="py-2.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="font-medium text-[#252B32]">@{ev.username}</span>
                          <span className="text-[#73777C]"> · {ev.message}</span>
                        </div>
                        <span
                          className={`capitalize ${
                            ev.status === 'success' ? 'text-[#54866A]' : 'text-[#B85C55]'
                          }`}
                        >
                          {ev.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6">
                <h2 className="text-sm font-semibold text-[#252B32] mb-3">Audit Logs</h2>
                {overview.audit_logs.length === 0 ? (
                  <p className="text-xs text-[#73777C] py-6 text-center">No audit events recorded yet.</p>
                ) : (
                  <div className="divide-y divide-[#EAE4DA] text-xs max-h-80 overflow-y-auto">
                    {overview.audit_logs.map((log) => (
                      <div key={log.id} className="py-2.5 flex items-center justify-between gap-2">
                        <div className="truncate">
                          <span className="font-medium text-[#252B32]">{log.action}</span>
                          <span className="text-[#73777C]"> · {log.target_label}</span>
                        </div>
                        <span className="text-[#73777C] font-mono shrink-0">
                          {new Date(log.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          CLEAN MINIMAL MODALS
      ===================================================================== */}

      {/* Add User Modal */}
      {showCreateUserModal && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">Add User</h3>
              <button onClick={() => setShowCreateUserModal(false)} className="text-[#73777C] hover:text-[#252B32]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#73777C] mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Role</label>
                  <select
                    value={newUserForm.role}
                    onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="student">Student</option>
                    <option value="faculty">Teacher</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newUserForm.full_name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, full_name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateUserModal(false)}
                  className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg text-[#252B32]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                >
                  Add User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal (Includes Role, Account Status, and Optional Password Reset) */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">Edit User (@{editingUser.username})</h3>
              <button onClick={() => setEditingUser(null)} className="text-[#73777C] hover:text-[#252B32]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#73777C] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editUserForm.full_name}
                  onChange={(e) => setEditUserForm({ ...editUserForm, full_name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={editUserForm.email}
                  onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#73777C] mb-1">Role</label>
                  <select
                    value={editUserForm.role}
                    disabled={editingUser.id === currentUser.id}
                    onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="student">Student</option>
                    <option value="faculty">Teacher</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Account Status</label>
                  <select
                    value={editUserForm.status}
                    disabled={editingUser.id === currentUser.id}
                    onChange={(e) =>
                      setEditUserForm({
                        ...editUserForm,
                        status: e.target.value as 'active' | 'deactivated',
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="active">Active</option>
                    <option value="deactivated">Deactivated</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Reset Password (optional)</label>
                <input
                  type="password"
                  placeholder="Leave blank to keep current password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg text-[#252B32]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation */}
      {confirmDeleteUser && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#252B32]">Delete User</h3>
            <p className="text-xs text-[#73777C]">
              Are you sure you want to delete <strong>{confirmDeleteUser.full_name}</strong> (@
              {confirmDeleteUser.username})?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteUser(null)}
                className="px-3.5 py-2 text-xs border border-[#DDD6CA] rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={busy}
                className="px-4 py-2 text-xs bg-[#B85C55] text-white rounded-lg font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Course Modal */}
      {showCreateCourseModal && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">Add Course</h3>
              <button onClick={() => setShowCreateCourseModal(false)} className="text-[#73777C] hover:text-[#252B32]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCourse} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#73777C] mb-1">Course Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS401"
                    value={newCourseForm.code}
                    onChange={(e) => setNewCourseForm({ ...newCourseForm, code: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Category</label>
                  <input
                    type="text"
                    required
                    value={newCourseForm.category}
                    onChange={(e) => setNewCourseForm({ ...newCourseForm, category: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={newCourseForm.title}
                  onChange={(e) => setNewCourseForm({ ...newCourseForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Teacher</label>
                <select
                  value={newCourseForm.faculty_id}
                  onChange={(e) => setNewCourseForm({ ...newCourseForm, faculty_id: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                >
                  <option value="">Default Instructor</option>
                  {teachersList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Description</label>
                <textarea
                  rows={3}
                  value={newCourseForm.description}
                  onChange={(e) => setNewCourseForm({ ...newCourseForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateCourseModal(false)}
                  className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                >
                  Add Course
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Course Modal */}
      {editingCourse && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">Edit Course ({editingCourse.code})</h3>
              <button onClick={() => setEditingCourse(null)} className="text-[#73777C] hover:text-[#252B32]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateCourse} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#73777C] mb-1">Code</label>
                  <input
                    type="text"
                    required
                    value={editCourseForm.code}
                    onChange={(e) => setEditCourseForm({ ...editCourseForm, code: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Status</label>
                  <select
                    value={editCourseForm.approval_status}
                    onChange={(e) =>
                      setEditCourseForm({
                        ...editCourseForm,
                        approval_status: e.target.value as 'approved' | 'pending' | 'archived',
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="approved">Approved</option>
                    <option value="pending">Pending Approval</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={editCourseForm.title}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Teacher</label>
                <select
                  value={editCourseForm.faculty_id}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, faculty_id: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                >
                  {users
                    .filter((u) => u.role === 'faculty' || u.role === 'admin')
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Description</label>
                <textarea
                  rows={3}
                  value={editCourseForm.description}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCourse(null)}
                  className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                >
                  Save Course
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Course Enrollments Modal */}
      {managingEnrollmentsCourse && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">
                Enrollments · {managingEnrollmentsCourse.code}
              </h3>
              <button
                onClick={() => setManagingEnrollmentsCourse(null)}
                className="text-[#73777C] hover:text-[#252B32]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {studentsList.length === 0 ? (
              <p className="text-xs text-[#73777C] py-4 text-center">No students registered yet.</p>
            ) : (
              <div className="divide-y divide-[#EAE4DA] text-xs">
                {studentsList.map((st) => {
                  const isEnrolled = enrollments.some(
                    (e) => e.course_id === managingEnrollmentsCourse.id && e.student_id === st.id
                  );
                  return (
                    <div key={st.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-[#252B32]">{st.full_name}</div>
                        <div className="text-[#73777C]">@{st.username}</div>
                      </div>
                      <button
                        onClick={() =>
                          handleToggleEnrollment(managingEnrollmentsCourse.id, st.id, isEnrolled)
                        }
                        disabled={busy}
                        className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                          isEnrolled
                            ? 'border border-[#DDD6CA] text-[#B85C55]'
                            : 'bg-[#315C83] text-white'
                        }`}
                      >
                        {isEnrolled ? 'Remove' : 'Enroll'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Course Confirmation */}
      {confirmDeleteCourse && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#252B32]">Delete Course</h3>
            <p className="text-xs text-[#73777C]">
              Are you sure you want to delete{' '}
              <strong>
                {confirmDeleteCourse.code} · {confirmDeleteCourse.title}
              </strong>
              ?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteCourse(null)}
                className="px-3.5 py-2 text-xs border border-[#DDD6CA] rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCourse}
                disabled={busy}
                className="px-4 py-2 text-xs bg-[#B85C55] text-white rounded-lg font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Academic Item Modal (Department / Subject / Class) */}
      {showAddAcademicModal && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">
                {academicTab === 'departments' && 'Add Department'}
                {academicTab === 'subjects' && 'Add Subject'}
                {academicTab === 'classes' && 'Add Class'}
              </h3>
              <button
                onClick={() => setShowAddAcademicModal(false)}
                className="text-[#73777C] hover:text-[#252B32]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {academicTab === 'departments' && (
              <form onSubmit={handleCreateDepartment} className="space-y-3 text-xs">
                <div>
                  <label className="block text-[#73777C] mb-1">Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS"
                    value={deptForm.code}
                    onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Computer Science"
                    value={deptForm.name}
                    onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Head of Department</label>
                  <select
                    value={deptForm.head_faculty_id}
                    onChange={(e) => setDeptForm({ ...deptForm, head_faculty_id: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="">Unassigned</option>
                    {teachersList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAcademicModal(false)}
                    className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            {academicTab === 'subjects' && (
              <form onSubmit={handleCreateSubject} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#73777C] mb-1">Code</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. CS301"
                      value={subjForm.code}
                      onChange={(e) => setSubjForm({ ...subjForm, code: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[#73777C] mb-1">Credits</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={subjForm.credits}
                      onChange={(e) => setSubjForm({ ...subjForm, credits: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Subject Name</label>
                  <input
                    type="text"
                    required
                    value={subjForm.name}
                    onChange={(e) => setSubjForm({ ...subjForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#73777C] mb-1">Department</label>
                    <select
                      value={subjForm.department_id}
                      onChange={(e) => setSubjForm({ ...subjForm, department_id: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                    >
                      <option value="">General</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#73777C] mb-1">Semester</label>
                    <input
                      type="text"
                      value={subjForm.semester}
                      onChange={(e) => setSubjForm({ ...subjForm, semester: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAcademicModal(false)}
                    className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            {academicTab === 'classes' && (
              <form onSubmit={handleCreateBatch} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#73777C] mb-1">Code</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. CS-2026"
                      value={batchForm.code}
                      onChange={(e) => setBatchForm({ ...batchForm, code: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[#73777C] mb-1">Semester</label>
                    <input
                      type="text"
                      value={batchForm.semester}
                      onChange={(e) => setBatchForm({ ...batchForm, semester: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Class Name</label>
                  <input
                    type="text"
                    required
                    value={batchForm.name}
                    onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[#73777C] mb-1">Advisor</label>
                  <select
                    value={batchForm.advisor_faculty_id}
                    onChange={(e) => setBatchForm({ ...batchForm, advisor_faculty_id: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="">Unassigned</option>
                    {teachersList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAcademicModal(false)}
                    className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Create Announcement Modal */}
      {showCreateAnnouncementModal && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">Create Announcement</h3>
              <button
                onClick={() => setShowCreateAnnouncementModal(false)}
                className="text-[#73777C] hover:text-[#252B32]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAnnouncement} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#73777C] mb-1">Audience</label>
                <select
                  value={annForm.target_audience}
                  onChange={(e) =>
                    setAnnForm({
                      ...annForm,
                      target_audience: e.target.value as 'all' | 'students' | 'teachers' | 'course',
                    })
                  }
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                >
                  <option value="all">All Users</option>
                  <option value="students">Students Only</option>
                  <option value="teachers">Teachers Only</option>
                  <option value="course">Specific Course</option>
                </select>
              </div>
              {annForm.target_audience === 'course' && (
                <div>
                  <label className="block text-[#73777C] mb-1">Course</label>
                  <select
                    required
                    value={annForm.course_id}
                    onChange={(e) => setAnnForm({ ...annForm, course_id: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                  >
                    <option value="">Select course...</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[#73777C] mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={annForm.title}
                  onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Message</label>
                <textarea
                  rows={4}
                  required
                  value={annForm.body}
                  onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateAnnouncementModal(false)}
                  className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                >
                  Publish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Announcement Modal */}
      {editingAnnouncement && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#252B32]">Edit Announcement</h3>
              <button
                onClick={() => setEditingAnnouncement(null)}
                className="text-[#73777C] hover:text-[#252B32]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateAnnouncement} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#73777C] mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={editingAnnouncement.title}
                  onChange={(e) =>
                    setEditingAnnouncement({ ...editingAnnouncement, title: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[#73777C] mb-1">Message</label>
                <textarea
                  rows={4}
                  required
                  value={editingAnnouncement.body}
                  onChange={(e) =>
                    setEditingAnnouncement({ ...editingAnnouncement, body: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-[#DDD6CA] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingAnnouncement(null)}
                  className="px-3.5 py-2 border border-[#DDD6CA] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#315C83] text-white rounded-lg font-medium"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Announcement Confirmation */}
      {confirmDeleteAnnouncement && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#252B32]">Delete Announcement</h3>
            <p className="text-xs text-[#73777C]">
              Are you sure you want to delete <strong>“{confirmDeleteAnnouncement.title}”</strong>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteAnnouncement(null)}
                className="px-3.5 py-2 text-xs border border-[#DDD6CA] rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAnnouncement}
                disabled={busy}
                className="px-4 py-2 text-xs bg-[#B85C55] text-white rounded-lg font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

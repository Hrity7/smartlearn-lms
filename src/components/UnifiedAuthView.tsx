import React, { useEffect, useState } from 'react';
import { Shield, GraduationCap, User as UserIcon, AlertCircle, ArrowLeft } from 'lucide-react';
import { User } from '../types/lms';
import { signInWithGoogle } from '../utils/firebase';

export interface DemoRoleStatus {
  available: boolean;
  account: User | null;
  setup_required: string | null;
}

export interface DemoInfoPayload {
  demo_mode_enabled: boolean;
  roles: {
    admin: DemoRoleStatus;
    faculty: DemoRoleStatus;
    student: DemoRoleStatus;
  };
}

export interface AuthSessionResponse {
  user: User;
  session_token: string;
  auth_method: 'credentials' | 'demo' | 'registration';
}

interface UnifiedAuthViewProps {
  currentUser: User | null;
  initialMode?: 'login' | 'register';
  onAuthenticated: (session: AuthSessionResponse) => Promise<void> | void;
  onCancelSwitch?: () => void;
}

export function UnifiedAuthView({
  currentUser,
  initialMode = 'login',
  onAuthenticated,
  onCancelSwitch,
}: UnifiedAuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [emailOrUsername, setEmailOrUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [registerEmail, setRegisterEmail] = useState<string>('');
  const [registerPassword, setRegisterPassword] = useState<string>('');

  const [demoInfo, setDemoInfo] = useState<DemoInfoPayload | null>(null);
  const [submittingForm, setSubmittingForm] = useState<boolean>(false);
  const [signingInWithGoogle, setSigningInWithGoogle] = useState<boolean>(false);
  const [loadingDemoRole, setLoadingDemoRole] = useState<'admin' | 'faculty' | 'student' | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/demo-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DemoInfoPayload | null) => {
        if (active && data) {
          setDemoInfo(data);
        }
      })
      .catch(() => {
        // Handled explicitly on action
      });
    return () => {
      active = false;
    };
  }, []);

  const clearError = () => {
    if (errorMessage) setErrorMessage(null);
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmittingForm(true);

    try {
      if (mode === 'login') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: emailOrUsername.trim(),
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMessage(data.error || 'Sign in failed. Please check your credentials.');
          return;
        }
        await onAuthenticated(data);
      } else {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: fullName.trim(),
            email: registerEmail.trim(),
            password: registerPassword,
            role: 'student',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMessage(data.error || 'Registration failed. Please verify your details.');
          return;
        }
        await onAuthenticated(data);
      }
    } catch {
      setErrorMessage('Unable to reach the authentication server. Please try again.');
    } finally {
      setSubmittingForm(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setSigningInWithGoogle(true);
    try {
      const fbUser = await signInWithGoogle();
      const idToken = await fbUser.getIdToken();
      if (!idToken) {
        throw new Error('Could not retrieve identity token from Google authentication.');
      }

      // Send ID token only. Identity, email, verified status, and roles are determined server-side
      const res = await fetch('/api/auth/firebase-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ id_token: idToken }),
      });

      const sessionData = await res.json();
      if (!res.ok) {
        setErrorMessage(sessionData.error || 'Google sign-in could not be completed on server.');
        return;
      }
      await onAuthenticated(sessionData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user') && !msg.includes('cancelled-popup-request')) {
        setErrorMessage(`Google sign-in error: ${msg}`);
      }
    } finally {
      setSigningInWithGoogle(false);
    }
  };

  const handleDemoRoleLogin = async (role: 'admin' | 'faculty' | 'student') => {
    setErrorMessage(null);
    setLoadingDemoRole(role);
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Unable to sign in with the selected demo role.');
        return;
      }
      await onAuthenticated(data);
    } catch {
      setErrorMessage('Network error while authenticating demo role.');
    } finally {
      setLoadingDemoRole(null);
    }
  };

  const demoRoles: Array<{
    key: 'admin' | 'faculty' | 'student';
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      key: 'admin',
      title: 'Administrator',
      description: 'Manage users, courses and the platform.',
      icon: Shield,
    },
    {
      key: 'faculty',
      title: 'Teacher',
      description: 'Manage courses, assignments and students.',
      icon: GraduationCap,
    },
    {
      key: 'student',
      title: 'Student',
      description: 'Access courses and track learning progress.',
      icon: UserIcon,
    },
  ];

  const isBusy = submittingForm || loadingDemoRole !== null;

  return (
    <div className="min-h-screen bg-[#E5E0D8] text-[#252B32] flex flex-col justify-center items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        {/* Brand & Title */}
        <div className="text-center space-y-1.5">
          <div className="w-10 h-10 rounded-xl bg-[#315C83] text-white font-bold text-base flex items-center justify-center mx-auto mb-3">
            S
          </div>
          <h1 className="text-2xl font-bold text-[#252B32] tracking-tight">
            {mode === 'login' ? 'Sign in to SmartLearn LMS' : 'Create Student Account'}
          </h1>
          <p className="text-xs text-[#73777C]">
            {mode === 'login'
              ? 'Enter your credentials or select a demo role below'
              : 'Register a new student account to enroll in courses'}
          </p>
        </div>

        {/* Main Unified Authentication Card */}
        <div className="bg-[#FAF8F5] border border-[#DDD6CA] rounded-xl p-6 sm:p-7 space-y-5">
          {/* Return to active session if switching accounts */}
          {currentUser && onCancelSwitch && (
            <div className="flex items-center justify-between bg-[#EAE4DA]/60 border border-[#DDD6CA] rounded-lg px-3 py-2 text-xs">
              <span className="text-[#73777C] truncate">
                Signed in as <strong className="text-[#252B32]">{currentUser.full_name}</strong>
              </span>
              <button
                type="button"
                onClick={onCancelSwitch}
                className="text-[#315C83] font-medium hover:underline inline-flex items-center gap-1 shrink-0 ml-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            </div>
          )}

          {/* Mode Switcher: Sign In vs Register */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#EAE4DA] rounded-lg border border-[#DDD6CA]">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
              }}
              className={`py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs border border-[#DDD6CA]'
                  : 'text-[#73777C] hover:text-[#252B32]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
              }}
              className={`py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'bg-[#FAF8F5] text-[#252B32] shadow-2xs border border-[#DDD6CA]'
                  : 'text-[#73777C] hover:text-[#252B32]'
              }`}
            >
              Register
            </button>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="bg-[#B85C55]/10 border border-[#B85C55]/30 rounded-lg p-3 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-[#B85C55] shrink-0 mt-0.5" />
              <p className="text-xs text-[#B85C55] leading-relaxed">{errorMessage}</p>
            </div>
          )}

          {/* Google Sign-in with Firebase Auth */}
          <button
            type="button"
            disabled={isBusy || signingInWithGoogle}
            onClick={handleGoogleSignIn}
            className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-[#F3EFEA] border border-[#DDD6CA] text-[#252B32] text-xs font-semibold flex items-center justify-center gap-2.5 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>
              {signingInWithGoogle
                ? 'Connecting to Google...'
                : mode === 'login'
                ? 'Continue with Google'
                : 'Sign up with Google'}
            </span>
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#DDD6CA]" />
            <span className="text-[11px] font-medium text-[#73777C] uppercase tracking-wider">
              or continue with email
            </span>
            <div className="flex-1 h-px bg-[#DDD6CA]" />
          </div>

          {/* Email & Password Form */}
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-[#252B32] mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    clearError();
                  }}
                  placeholder="Enter your full name"
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] placeholder-[#73777C]/60 focus:outline-none focus:border-[#315C83]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#252B32] mb-1.5">
                {mode === 'login' ? 'Email or Username' : 'Email Address'}
              </label>
              <input
                type={mode === 'login' ? 'text' : 'email'}
                required
                value={mode === 'login' ? emailOrUsername : registerEmail}
                onChange={(e) => {
                  if (mode === 'login') {
                    setEmailOrUsername(e.target.value);
                  } else {
                    setRegisterEmail(e.target.value);
                  }
                  clearError();
                }}
                placeholder={
                  mode === 'login' ? 'you@university.edu or username' : 'you@university.edu'
                }
                className="w-full px-3.5 py-2.5 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] placeholder-[#73777C]/60 focus:outline-none focus:border-[#315C83]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#252B32] mb-1.5">Password</label>
              <input
                type="password"
                required
                minLength={mode === 'register' ? 6 : 1}
                value={mode === 'login' ? password : registerPassword}
                onChange={(e) => {
                  if (mode === 'login') {
                    setPassword(e.target.value);
                  } else {
                    setRegisterPassword(e.target.value);
                  }
                  clearError();
                }}
                placeholder={mode === 'login' ? 'Enter your password' : 'At least 6 characters'}
                className="w-full px-3.5 py-2.5 text-xs bg-white border border-[#DDD6CA] rounded-lg text-[#252B32] placeholder-[#73777C]/60 focus:outline-none focus:border-[#315C83]"
              />
            </div>

            {mode === 'register' && (
              <p className="text-[11px] text-[#73777C] bg-[#EAE4DA]/50 border border-[#DDD6CA] rounded-lg px-3 py-2 leading-relaxed">
                Public registration creates a <strong className="text-[#252B32]">Student</strong>{' '}
                account. Teacher and Administrator accounts are provisioned by a platform
                Administrator.
              </p>
            )}

            <button
              type="submit"
              disabled={isBusy}
              className="w-full py-2.5 px-4 rounded-lg bg-[#315C83] hover:bg-[#264A6B] disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer"
            >
              {submittingForm
                ? mode === 'login'
                  ? 'Signing in...'
                  : 'Creating account...'
                : mode === 'login'
                ? 'Sign In'
                : 'Create Student Account'}
            </button>
          </form>

          {/* Toggle Link Between Sign In and Register */}
          <div className="text-center text-xs text-[#73777C]">
            {mode === 'login' ? (
              <>
                New to SmartLearn?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMessage(null);
                  }}
                  className="text-[#315C83] font-medium hover:underline cursor-pointer"
                >
                  Register a Student account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage(null);
                  }}
                  className="text-[#315C83] font-medium hover:underline cursor-pointer"
                >
                  Sign In
                </button>
              </>
            )}
          </div>

          {/* Integrated Demo Access Section */}
          {Boolean(demoInfo?.demo_mode_enabled) && (
            <div className="pt-4 border-t border-[#DDD6CA] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#252B32]">Demo Role Access</span>
                <span className="text-[11px] text-[#73777C]">Instant role selection</span>
              </div>

              <div className="space-y-2">
                {demoRoles.map((roleItem) => {
                  const Icon = roleItem.icon;
                  const roleStatus = demoInfo?.roles[roleItem.key];
                  const isRoleLoading = loadingDemoRole === roleItem.key;
                  const isUnavailable = roleStatus && !roleStatus.available;

                  return (
                    <div
                      key={roleItem.key}
                      className="bg-white border border-[#DDD6CA] hover:border-[#315C83]/50 rounded-lg p-3 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-[#EAE4DA] border border-[#DDD6CA] flex items-center justify-center text-[#315C83] shrink-0">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#252B32] leading-none">
                              {roleItem.title}
                            </p>
                            <p className="text-[11px] text-[#73777C] truncate mt-1">
                              {roleItem.description}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDemoRoleLogin(roleItem.key)}
                          className="px-3 py-1.5 rounded-md bg-[#EAE4DA] hover:bg-[#315C83] hover:text-white text-[#252B32] text-xs font-medium transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          {isRoleLoading ? 'Loading...' : `Continue as ${roleItem.title}`}
                        </button>
                      </div>

                      {isUnavailable && roleStatus?.setup_required && (
                        <p className="text-[11px] text-[#B85C55] mt-2 pt-2 border-t border-[#EAE4DA] leading-snug">
                          {roleStatus.setup_required}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

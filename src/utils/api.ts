/**
 * Shared API and Download Client Helper for SmartLearn LMS
 * Automatically attaches Authorization headers and handles session expiry & authorized file downloads.
 */

export const AUTH_STORAGE_KEY = 'smartlearn_unified_auth_v1';

export interface StoredAuthSession {
  userId: number;
  sessionToken: string;
  user_id?: number;
  session_token?: string;
}

let activeSessionToken: string | null = null;
let onUnauthorizedHandler: (() => void) | null = null;

export function setSessionToken(token: string | null) {
  activeSessionToken = token;
}

export function saveAuthSession(userId: number, token: string) {
  activeSessionToken = token;
  try {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        userId,
        sessionToken: token,
        user_id: userId,
        session_token: token,
      })
    );
  } catch {
    // Ignore localStorage write errors
  }
}

export function clearAuthSession() {
  activeSessionToken = null;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem('smartlearn_lms_auth_session');
  } catch {
    // Ignore storage removal errors
  }
}

export function getSessionToken(): string | null {
  if (activeSessionToken) return activeSessionToken;
  try {
    const raw =
      localStorage.getItem(AUTH_STORAGE_KEY) ||
      localStorage.getItem('smartlearn_lms_auth_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      const token = parsed?.sessionToken || parsed?.session_token;
      if (token && typeof token === 'string') {
        activeSessionToken = token;
        return activeSessionToken;
      }
    }
  } catch {
    // Ignore localStorage parse errors
  }
  return null;
}

export function registerUnauthorizedHandler(handler: () => void) {
  onUnauthorizedHandler = handler;
}

/**
 * Shared authenticated fetch wrapper
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getSessionToken();

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('x-lms-session-token', token);
  }

  // Set Content-Type only if not sending FormData
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    // Only dispatch session-expired if an active token was actually sent and rejected
    if (token) {
      if (onUnauthorizedHandler) {
        onUnauthorizedHandler();
      }
      window.dispatchEvent(new CustomEvent('lms:session-expired'));
    }
  }

  return response;
}

/**
 * Downloads a file requiring Bearer authentication via Blob URL
 */
export async function downloadFileWithAuth(url: string, fallbackFilename = 'download'): Promise<void> {
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) {
    let errorMsg = 'Failed to download file.';
    try {
      const json = await res.json();
      if (json && json.error) errorMsg = json.error;
    } catch {
      // response might be raw text or html error
    }
    throw new Error(errorMsg);
  }

  // Parse filename from Content-Disposition header if available
  let filename = fallbackFilename;
  const disposition = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
  if (disposition) {
    // Check RFC 5987 filename*=UTF-8''...
    const rfcMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (rfcMatch && rfcMatch[1]) {
      try {
        filename = decodeURIComponent(rfcMatch[1]);
      } catch {
        filename = rfcMatch[1];
      }
    } else {
      const standardMatch = disposition.match(/filename="?([^";]+)"?/i);
      if (standardMatch && standardMatch[1]) {
        filename = standardMatch[1];
      }
    }
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

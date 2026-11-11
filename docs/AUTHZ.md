# SmartLearn LMS & OS Kernel Studio — Authorization Architecture (AUTHZ)

This document details the authentication and authorization (RBAC) model implemented across the backend and frontend of SmartLearn LMS.

---

## 1. Authentication & Session Security

- **Session Tokens**: All authenticated operations require an HMAC-SHA256 signed session token sent via `Authorization: Bearer <token>` or `x-lms-session-token: <token>`.
- **Identity Fallback Deprecation**: The legacy unsigned `x-lms-user-id` header fallback has been eliminated. The backend strictly resolves user identity from cryptographically verified tokens.
- **Timing-Safe Validation**: Signatures are compared with `crypto.timingSafeEqual` to eliminate timing attack vulnerabilities.
- **Session Expiry**: Sessions are enforced with an 8-hour maximum lifetime from the issuance timestamp (`iat`). Expired tokens are rejected with `401 Unauthorized`.
- **Token Versioning & Persistent Invalidation**: Each user maintains a persistent `token_version` counter. When a user updates their password, changes their role, or is deactivated by an administrator, `token_version` is incremented. All sessions signed with prior token versions are immediately revoked.
- **Session Secret**: HMAC secret is read from `process.env.SESSION_SECRET`. In dev without an explicit secret, an ephemeral 256-bit cryptographic secret is generated on startup with a console security warning.

---

## 2. Password & Credential Hashing

- **Algorithm**: Passwords are hashed using `crypto.scrypt` with a 16-byte random salt and $N=16384, r=8, p=1$.
- **Hash Format**: `scrypt$16384$<salt_hex>$<hash_hex>`.
- **Legacy Migration**: Existing user accounts with legacy SHA-256 hashes are automatically and transparently migrated to `scrypt` upon successful sign-in.
- **Minimum Password Length**: Minimum 8 characters enforced across registration, password resets, and profile password changes.
- **Firebase Google Accounts**: Accounts provisioned via Google Firebase Auth receive cryptographically unusable password hashes (`unusable$<random_32_bytes>`), preventing password brute-force or credential stuffing.

---

## 3. Role-Based Access Control (RBAC)

### Role Hierarchy & Permissions

| Role | Public Registration | Course Access | Grade Submissions | Create Materials | Administrative Settings |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Student** | Yes (Self-Registration) | Enrolled courses only | No (submit only) | No | No |
| **Faculty / Teacher** | No (Admin provisioned) | Assigned courses only | Yes (assigned courses) | Yes (assigned courses) | No |
| **Administrator** | No (System / Env configured) | Full LMS platform | Full LMS platform | Full LMS platform | Yes (System, OS Kernel, Backups, Users) |

### Route & File Download Authorization Matrix

1. **Course Materials (`/api/materials/:id/download`)**:
   - `admin`: Authorized.
   - `faculty`: Authorized if assigned to the course.
   - `student`: Authorized if enrolled in the course.
   - Unauthenticated or unauthorized: `401 / 403 Forbidden`.
   - Headers: `X-Content-Type-Options: nosniff` and RFC 5987 encoded `Content-Disposition`.

2. **Assignment Submissions (`/api/submissions/:id/download`)**:
   - `admin`: Authorized.
   - `faculty`: Authorized if assigned to the parent course.
   - `student`: Authorized if the submission was authored by this student.
   - Headers: `X-Content-Type-Options: nosniff` and RFC 5987 encoded `Content-Disposition`.

3. **System Backups (`/api/os/backups/:filename`)**:
   - `admin`: Authorized only.
   - All other roles / guests: `403 Forbidden` / `401 Unauthorized`.

---

## 4. File Upload Hardening

- **Allowlist Extensions**: `.pdf`, `.txt`, `.md`, `.png`, `.jpg`, `.jpeg`, `.docx`, `.pptx`, `.xlsx`, `.zip`, `.csv`.
- **Magic Bytes Validation**: Binary headers verified against expected file type signatures (e.g. `%PDF`, `\x89PNG`, `\xFF\xD8\xFF`, `PK\x03\x04`).
- **Quota & Size Limits**:
  - Maximum upload size per file: 5 MB.
  - Pre-allocation base64 buffer length check prevents memory exhaustion.
  - Per-course storage limit: 50 MB.

---

## 5. Network & Request Hardening

- **HTTP Security Headers**: Configured via `helmet` with strict Content Security Policy (CSP) allowing Firebase, Google APIs, and self-origin assets.
- **Rate Limiting**:
  - Auth endpoints (`/api/auth/*`): 60 requests per 15-minute window (`express-rate-limit`).
  - General API endpoints (`/api/*`): 1000 requests per 15-minute window.
- **Request Body Limits**: Enforced `1mb` maximum JSON and URL-encoded payload limit.

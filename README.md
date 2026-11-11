# SmartLearn LMS & OS Kernel Studio

A learning management system with an **Operating Systems theme**. Alongside the usual LMS features (courses, lessons, assignments, quizzes, grading), it includes live, interactive simulators for classic OS algorithms, and Gemini-powered quiz generation for teachers.

Built with React, Express, TypeScript and Firebase. Created in Google AI Studio and hardened and extended afterwards.

## Live demo

Try [SmartLearn LMS on Render](https://smartlearn-lms-5kzp.onrender.com).

This free demo uses temporary local data and uploads, which may reset after a restart or idle spin-down.



## Features

**Learning platform**
- Three roles: **admin**, **faculty** (teacher) and **student**, each with its own dashboard
- Courses with modules and lessons, file attachments, assignments with submissions, quizzes with auto-graded multiple-choice and subjective questions, announcements and notifications
- Google sign-in (Firebase Authentication) plus email/password accounts

**OS Kernel Studio**
- CPU process scheduling
- Banker's algorithm (deadlock avoidance)
- LRU page cache
- SSTF / SCAN disk I/O scheduling
- Reader-writer lock synchronization
- Interactive simulators for these algorithms

**AI features (server-side Gemini)**
- Teachers can generate draft quiz questions from their published lessons, then review and edit them before saving
- The API key never reaches the browser, and every AI call is rate-limited per user with a daily cap

## Tech stack

| Area | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4 |
| Backend | Node.js, Express, TypeScript (run with `tsx`) |
| Auth | Firebase Authentication (Google), signed session tokens |
| Data | Firestore, with a local JSON-file fallback for development |
| Files | Firebase Storage, with a local-disk fallback for development |
| AI | Google Gemini via `@google/genai` |
| Validation | zod |
| Tests | Vitest and Supertest |

## Getting started

**Requirements:** Node.js 22 or newer.

```bash
git clone https://github.com/Hrity7/smartlearn-lms.git
cd smartlearn-lms
npm install
```

Create a `.env` file in the project root (copy `.env.example`) and set at least:

```env
SESSION_SECRET="a-random-string-of-at-least-32-characters"
ADMIN_EMAILS="your-google-email@example.com"
LMS_DEMO_MODE="true"
GEMINI_API_KEY="your-key-from-aistudio.google.com/apikey"
```

Then start the app:

```bash
npm run dev
```

Open **http://localhost:3000**.

> On your own machine there are no Google Cloud credentials, so the app will print `DATA IS NOT DURABLE` warnings and store data in a local `data/` folder. This is expected for development.

### Environment variables

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Signs session tokens. Use 32 or more random characters |
| `ADMIN_EMAILS` | Comma-separated emails that become administrators when they sign in with Google |
| `LMS_DEMO_MODE` | `true` enables one-click demo logins. **Always `false` in production** |
| `GEMINI_API_KEY` | Enables the AI quiz generator. Without it, AI buttons are disabled |
| `GEMINI_MODEL` | Gemini model name for AI features |
| `AI_ENABLED` | Master switch for AI features (`true` or `false`) |
| `AI_DAILY_LIMIT_PER_USER` | Maximum AI requests per user per day |
| `PERSISTENCE_BACKEND` | Optional override: `firestore`, `json` or `memory` |
| `STORAGE_BACKEND` | Optional override: `firebase`, `local` or `memory` |

Never commit your `.env` file. It is already listed in `.gitignore`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app (Express API and Vite frontend) on port 3000 |
| `npm run build` | Build the production frontend |
| `npm run lint` | Type-check with TypeScript |
| `npm test` | Run the test suite |

## Security

- Signed (HMAC-SHA256) session tokens with an 8-hour lifetime and per-user revocation
- Passwords hashed with scrypt; Google accounts have no usable password
- Firebase ID tokens verified server-side; new accounts are always created as students
- Role-based access control with ownership checks on every protected route (see [`docs/AUTHZ.md`](docs/AUTHZ.md))
- Authenticated, authorized file downloads; uploads validated by extension, size and file signature
- Rate limiting on login and registration, security headers, JSON-only error responses
- Firestore rules deny all direct browser access, because all data goes through the server

## Project structure

```
server.ts                 Express app, API routes, OS kernel engine
src/
  App.tsx                 App shell and routing
  components/             Admin, teacher, student, course and auth views
  server/ai/              Gemini service, quota and helpers
  server/persistence/     Firestore, JSON-file and in-memory stores
  server/storage/         Firebase Storage, local-disk and in-memory file stores
  tests/                  API, security, upload, persistence and AI tests
  utils/osAlgorithms.ts   OS algorithm simulators
docs/AUTHZ.md             Authentication and authorization design
```

## Known limitations

- Application state is held in memory and written to the database in the background, so run **one server instance** only
- The AI study tutor and AI feedback drafts are planned but not built yet
- `server.ts` and the dashboard components are large and would benefit from being split into smaller modules

## Team Members

This project was developed as a collaborative effort by our team.

- Hritwiz Verma – [@Hrity7](https://github.com/Hrity7)
- Faiz Hussain – [@FaizHussain78](https://github.com/FaizHussain78)
- Krish Dubey – [@krishxdubey](https://github.com/krishxdubey)
- Manish Chauhan – [@manishxchauhan](https://github.com/manishxchauhan)
- Ishaan Singh – [@singhishaan505-ui](https://github.com/singhishaan505-ui)

All team members contributed to the planning, development, and implementation of this project.

## License

Released under the [MIT License](LICENSE).

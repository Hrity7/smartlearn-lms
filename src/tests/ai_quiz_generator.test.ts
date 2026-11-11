import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp, kernel } from '../../server';
import type { Express } from 'express';
import { setGeminiClient, resetGeminiClient } from '../server/ai/gemini';
import { resetAiDailyQuota } from '../server/ai/quota';

describe('AI Quiz Generator Endpoint & Security Test Suite', () => {
  let app: Express;
  let teacherToken: string;
  let teacherId: number;
  let otherTeacherToken: string;
  let studentToken: string;
  let ownedCourseId: number;
  let unownedCourseId: number;

  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalAiEnabled = process.env.AI_ENABLED;
  const originalDailyLimit = process.env.AI_DAILY_LIMIT_PER_USER;

  beforeAll(async () => {
    process.env.LMS_DEMO_MODE = 'true';
    const serverInstance = await createApp();
    app = serverInstance.app;

    // Faculty login
    const teacherRes = await request(app)
      .post('/api/auth/demo-login')
      .send({ role: 'faculty' });
    expect(teacherRes.status).toBe(200);
    teacherToken = teacherRes.body.session_token;
    teacherId = teacherRes.body.user.id;

    // Student login
    const studentRes = await request(app)
      .post('/api/auth/demo-login')
      .send({ role: 'student' });
    expect(studentRes.status).toBe(200);
    studentToken = studentRes.body.session_token;

    // Find course owned by this teacher
    const teacherCourse = kernel.state.courses.find((c) => c.faculty_id === teacherId);
    if (teacherCourse) {
      ownedCourseId = teacherCourse.id;
    } else {
      ownedCourseId = 1;
      const c = kernel.state.courses.find((c) => c.id === 1);
      if (c) c.faculty_id = teacherId;
    }

    // Create a second teacher user and get a token
    const otherFacultyId = 987654;
    const existingOther = kernel.state.users.find((u) => u.id === otherFacultyId);
    if (!existingOther) {
      kernel.state.users.push({
        id: otherFacultyId,
        username: 'other_faculty_ai_test',
        email: 'other_faculty@smartlearn.edu',
        password_hash: 'scrypt$16384$mock$mock',
        full_name: 'Other Faculty Prof',
        role: 'faculty',
        department_id: 1,
        status: 'active',
        created_at: new Date().toISOString(),
        token_version: 1,
      });
    }

    // Create course owned by other faculty
    unownedCourseId = 888888;
    const existingUnowned = kernel.state.courses.find((c) => c.id === unownedCourseId);
    if (!existingUnowned) {
      kernel.state.courses.push({
        id: unownedCourseId,
        code: 'CS-OTHER',
        title: 'Other Course by Different Faculty',
        category: 'Operating Systems',
        level: 'Intermediate',
        estimated_hours: 30,
        accent_theme: 'lavender',
        department_id: 1,
        faculty_id: otherFacultyId,
        description: 'Course managed by different instructor',
        published: true,
        created_at: new Date().toISOString(),
        quiz_questions: [],
      });
    }

    // Create other teacher account via admin
    const adminRes = await request(app)
      .post('/api/auth/demo-login')
      .send({ role: 'admin' });
    expect(adminRes.status).toBe(200);
    const adminToken = adminRes.body.session_token;

    await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Other Faculty Prof',
        email: 'other_faculty_ai@smartlearn.edu',
        username: 'other_faculty_ai',
        role: 'faculty',
        department_id: 1,
        password: 'Password123!',
      });

    const otherLogRes = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'other_faculty_ai@smartlearn.edu',
        password: 'Password123!',
      });
    expect(otherLogRes.status).toBe(200);
    otherTeacherToken = otherLogRes.body.session_token;
    expect(otherTeacherToken).toBeDefined();


    // Ensure owned course has sufficient published lesson materials (>200 chars)
    const existingMat = kernel.state.materials.find(
      (m) => m.course_id === ownedCourseId && m.published !== false
    );
    if (!existingMat) {
      kernel.state.materials.push({
        id: 99991,
        course_id: ownedCourseId,
        module_title: 'Module 1 · Core Concurrency',
        lesson_number: 1,
        duration_minutes: 30,
        video_summary:
          'This in-depth lesson examines Dijkstra semaphore primitives, mutex locks, and condition variables in operating systems. Processes synchronize shared memory access to prevent race conditions and maintain critical section mutual exclusion.',
        published: true,
        key_takeaways: [
          'Mutual exclusion prevents simultaneous access to critical regions.',
          'Semaphores support wait() and signal() atomic operations.',
          'Counting semaphores coordinate resource pools across threads.',
        ],
        title: 'Semaphore Synchronization & Critical Sections',
        body: 'Operating systems implement synchronization primitives to coordinate execution between concurrent threads. When multiple threads access shared resources without proper locking, data races occur leading to undefined memory states.',
        original_name: null,
        stored_name: null,
        file_size: 0,
        content_type: null,
        created_by: teacherId,
        created_at: new Date().toISOString(),
      });
    } else {
      // Ensure it has > 200 chars
      existingMat.body = (existingMat.body || '') + ' ' + 'Detailed lesson material covering operating system scheduling, memory management, and deadlock prevention algorithms in substantive detail.';
      existingMat.published = true;
    }
  });

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini-key-12345';
    process.env.AI_ENABLED = 'true';
    delete process.env.AI_DAILY_LIMIT_PER_USER;
    resetAiDailyQuota();
    resetGeminiClient();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
    process.env.AI_ENABLED = originalAiEnabled;
    if (originalDailyLimit) {
      process.env.AI_DAILY_LIMIT_PER_USER = originalDailyLimit;
    } else {
      delete process.env.AI_DAILY_LIMIT_PER_USER;
    }
    resetGeminiClient();
    resetAiDailyQuota();
  });

  it('1. GET /api/ai/status requires authentication and accurately reports enabled flag', async () => {
    // Unauthenticated
    const unauth = await request(app).get('/api/ai/status');
    expect(unauth.status).toBe(401);

    // Authenticated with key
    process.env.GEMINI_API_KEY = 'real-secret-key';
    process.env.AI_ENABLED = 'true';
    const auth1 = await request(app)
      .get('/api/ai/status')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(auth1.status).toBe(200);
    expect(auth1.body.enabled).toBe(true);

    // Authenticated with placeholder key
    process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';
    const auth2 = await request(app)
      .get('/api/ai/status')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(auth2.status).toBe(200);
    expect(auth2.body.enabled).toBe(false);

    // Authenticated with empty key
    process.env.GEMINI_API_KEY = '';
    const auth3 = await request(app)
      .get('/api/ai/status')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(auth3.status).toBe(200);
    expect(auth3.body.enabled).toBe(false);
  });

  it('2. POST /api/teacher/courses/:id/ai/generate-questions returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .send({
        count: 3,
        difficulty: 'medium',
        mcq_ratio: 0.8,
      });
    expect(res.status).toBe(401);
  });

  it('3. POST /api/teacher/courses/:id/ai/generate-questions returns 403 when called by student', async () => {
    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        count: 3,
        difficulty: 'medium',
        mcq_ratio: 0.8,
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Teacher privileges are required/i);
  });

  it('4. POST /api/teacher/courses/:id/ai/generate-questions returns 403 when called by teacher not owning the course', async () => {
    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${otherTeacherToken}`)
      .send({
        count: 3,
        difficulty: 'medium',
        mcq_ratio: 0.8,
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only authorized to manage courses assigned to you/i);
  });

  it('5. POST /api/teacher/courses/:id/ai/generate-questions returns 503 when GEMINI_API_KEY is missing or placeholder', async () => {
    process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';
    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 3,
        difficulty: 'medium',
        mcq_ratio: 0.8,
      });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('6. POST /api/teacher/courses/:id/ai/generate-questions returns 400 on invalid body parameters', async () => {
    // Count exceeds 10
    const res1 = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 15,
        difficulty: 'medium',
        mcq_ratio: 0.8,
      });
    expect(res1.status).toBe(400);

    // Invalid difficulty
    const res2 = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 3,
        difficulty: 'super_hard',
        mcq_ratio: 0.8,
      });
    expect(res2.status).toBe(400);

    // Negative mcq_ratio
    const res3 = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 3,
        difficulty: 'medium',
        mcq_ratio: -0.5,
      });
    expect(res3.status).toBe(400);
  });

  it('7. Excludes unpublished lessons from the AI prompt', async () => {
    let capturedPrompt = '';

    const mockAiClient = {
      models: {
        generateContent: vi.fn(async (opts: any) => {
          capturedPrompt = opts.contents;
          return {
            text: JSON.stringify({
              questions: [
                {
                  question: 'What is a binary semaphore?',
                  question_type: 'mcq',
                  marks: 10,
                  options: ['A lock with value 0 or 1', 'A CPU cache', 'A disk driver', 'A network socket'],
                  correct_index: 0,
                  explanation: 'Binary semaphores take integer values between 0 and 1.',
                },
              ],
            }),
          };
        }),
      },
    };
    setGeminiClient(mockAiClient);

    // Add an unpublished material with a secret canary phrase
    const unpublishedCanary = 'TOP_SECRET_UNPUBLISHED_CANARY_STRING_XYZ123';
    kernel.state.materials.push({
      id: 99992,
      course_id: ownedCourseId,
      module_title: 'Unpublished Draft Module',
      lesson_number: 99,
      duration_minutes: 15,
      video_summary: 'Draft summary',
      published: false,
      key_takeaways: [unpublishedCanary],
      title: 'Unpublished Draft Lesson',
      body: `This text should NEVER be included in the AI prompt: ${unpublishedCanary}`,
      original_name: null,
      stored_name: null,
      file_size: 0,
      content_type: null,
      created_by: teacherId,
      created_at: new Date().toISOString(),
    });

    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 1,
        difficulty: 'medium',
        mcq_ratio: 1.0,
      });

    expect(res.status).toBe(200);
    expect(capturedPrompt).not.toContain(unpublishedCanary);
    expect(capturedPrompt).toContain('Kernel Architecture');
  });

  it('8. Returns 502 when Gemini model response is malformed or invalid JSON', async () => {
    const mockAiClient = {
      models: {
        generateContent: vi.fn(async () => {
          return {
            text: 'I am not valid JSON at all! { broken',
          };
        }),
      },
    };
    setGeminiClient(mockAiClient);

    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 2,
        difficulty: 'medium',
        mcq_ratio: 1.0,
      });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/unusable answer/i);
  });

  it('9. Filters invalid drafts, deduplicates against existing questions and within batch', async () => {
    const course = kernel.state.courses.find((c) => c.id === ownedCourseId)!;
    if (!course.quiz_questions) course.quiz_questions = [];

    // Pre-populate an existing question in the course
    course.quiz_questions.push({
      id: 'pre-existing-q1',
      question: 'What is mutual exclusion in concurrency?',
      question_type: 'mcq',
      marks: 10,
      options: ['Only one process at a time', 'All processes together', 'Deadlock state', 'Starvation'],
      correct_index: 0,
      explanation: 'Only one process can enter critical section.',
    });

    const mockAiClient = {
      models: {
        generateContent: vi.fn(async () => {
          return {
            text: JSON.stringify({
              questions: [
                // 1. Duplicate of existing question -> MUST BE FILTERED
                {
                  question: '  What is mutual exclusion in concurrency?  ',
                  question_type: 'mcq',
                  marks: 10,
                  options: ['Only one process at a time', 'All processes together', 'Deadlock state', 'Starvation'],
                  correct_index: 0,
                  explanation: 'Duplicate test',
                },
                // 2. Valid MCQ -> MUST BE INCLUDED
                {
                  question: 'Which operation on a semaphore decrements its value?',
                  question_type: 'mcq',
                  marks: 10,
                  options: ['wait() or P()', 'signal() or V()', 'fork()', 'exec()'],
                  correct_index: 0,
                  explanation: 'wait() decrements the semaphore counter.',
                },
                // 3. Duplicate within same batch -> MUST BE FILTERED
                {
                  question: 'which operation on a semaphore decrements its value?',
                  question_type: 'mcq',
                  marks: 10,
                  options: ['wait() or P()', 'signal() or V()', 'fork()', 'exec()'],
                  correct_index: 0,
                  explanation: 'Duplicate within batch',
                },
                // 4. Invalid MCQ: only 2 options (requires 3-5) -> MUST BE FILTERED
                {
                  question: 'Is mutual exclusion necessary?',
                  question_type: 'mcq',
                  marks: 10,
                  options: ['Yes', 'No'],
                  correct_index: 0,
                  explanation: 'Too few options',
                },
                // 5. Valid Subjective question -> MUST BE INCLUDED with normalized options
                {
                  question: 'Describe how Peterson algorithm achieves mutual exclusion between two processes.',
                  question_type: 'subjective',
                  marks: 15,
                  options: ['Random garbage from model'],
                  correct_index: 99,
                  explanation: 'Requires flag array and turn variable.',
                },
              ],
            }),
          };
        }),
      },
    };
    setGeminiClient(mockAiClient);

    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 5,
        difficulty: 'hard',
        mcq_ratio: 0.5,
      });

    expect(res.status).toBe(200);
    expect(res.body.drafts).toBeDefined();
    expect(Array.isArray(res.body.drafts)).toBe(true);

    // Only questions 2 and 5 should survive
    expect(res.body.drafts.length).toBe(2);

    const mcqDraft = res.body.drafts.find((d: any) => d.question_type === 'mcq');
    expect(mcqDraft).toBeDefined();
    expect(mcqDraft.options.length).toBe(4);
    expect(mcqDraft.correct_index).toBe(0);

    const subjDraft = res.body.drafts.find((d: any) => d.question_type === 'subjective');
    expect(subjDraft).toBeDefined();
    expect(subjDraft.options).toEqual(['Subjective Response']);
    expect(subjDraft.correct_index).toBe(0);
  });

  it('10. Generation call does NOT persist anything to course quiz_questions or state', async () => {
    const course = kernel.state.courses.find((c) => c.id === ownedCourseId)!;
    const initialQuestionCount = course.quiz_questions ? course.quiz_questions.length : 0;

    const mockAiClient = {
      models: {
        generateContent: vi.fn(async () => {
          return {
            text: JSON.stringify({
              questions: [
                {
                  question: 'Test question that should only be a draft?',
                  question_type: 'mcq',
                  marks: 10,
                  options: ['A', 'B', 'C', 'D'],
                  correct_index: 1,
                  explanation: 'Test draft',
                },
              ],
            }),
          };
        }),
      },
    };
    setGeminiClient(mockAiClient);

    const res = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        count: 1,
        difficulty: 'easy',
        mcq_ratio: 1.0,
      });

    expect(res.status).toBe(200);
    expect(res.body.drafts.length).toBe(1);

    // Verify course.quiz_questions is completely unchanged
    const currentQuestionCount = course.quiz_questions ? course.quiz_questions.length : 0;
    expect(currentQuestionCount).toBe(initialQuestionCount);
  });

  it('11. Returns 429 when daily user quota is exceeded', async () => {
    // Set daily limit to 2 for testing
    process.env.AI_DAILY_LIMIT_PER_USER = '2';
    resetAiDailyQuota();

    const mockAiClient = {
      models: {
        generateContent: vi.fn(async () => ({
          text: JSON.stringify({
            questions: [
              {
                question: 'Quota check question?',
                question_type: 'subjective',
                marks: 10,
                options: ['Subjective Response'],
                correct_index: 0,
                explanation: 'Sample',
              },
            ],
          }),
        })),
      },
    };
    setGeminiClient(mockAiClient);

    // Request 1: OK
    const r1 = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ count: 1, difficulty: 'easy', mcq_ratio: 0 });
    expect(r1.status).toBe(200);

    // Request 2: OK
    const r2 = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ count: 1, difficulty: 'easy', mcq_ratio: 0 });
    expect(r2.status).toBe(200);

    // Request 3: Exceeded -> 429
    const r3 = await request(app)
      .post(`/api/teacher/courses/${ownedCourseId}/ai/generate-questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ count: 1, difficulty: 'easy', mcq_ratio: 0 });
    expect(r3.status).toBe(429);
    expect(r3.body.error).toMatch(/limit reached/i);
  });
});

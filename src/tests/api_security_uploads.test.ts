import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp, kernel } from '../../server';
import type { Express } from 'express';

describe('HTTP API Hardening, Security & Uploads Test Suite', () => {
  let app: Express;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let courseId: number;

  beforeAll(async () => {
    process.env.LMS_DEMO_MODE = 'true';
    const serverInstance = await createApp();
    app = serverInstance.app;

    // Retrieve tokens for admin, faculty, and student via demo-login
    const adminRes = await request(app)
      .post('/api/auth/demo-login')
      .send({ role: 'admin' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.session_token;

    const teacherRes = await request(app)
      .post('/api/auth/demo-login')
      .send({ role: 'faculty' });
    expect(teacherRes.status).toBe(200);
    teacherToken = teacherRes.body.session_token;

    const studentRes = await request(app)
      .post('/api/auth/demo-login')
      .send({ role: 'student' });
    expect(studentRes.status).toBe(200);
    studentToken = studentRes.body.session_token;

    const firstCourse = kernel.state.courses[0];
    courseId = firstCourse ? firstCourse.id : 1;
  });

  it('1. Rejects x-lms-user-id header alone without valid Bearer token with 401', async () => {
    const res = await request(app)
      .get('/api/bootstrap')
      .set('x-lms-user-id', '1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('2. Rejects file download without authentication token with 401', async () => {
    const res = await request(app).get('/api/materials/1/download');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('3. Rejects student attempting to access admin routes with 403', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  it('4. Allows legitimate login and bootstrap flow with Bearer session token', async () => {
    const bootstrapRes = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(bootstrapRes.status).toBe(200);
    expect(bootstrapRes.body.user).toBeDefined();
    expect(bootstrapRes.body.user.role).toBe('student');
  });

  it('5. Allows unauthenticated access to GET /api/auth/demo-info without consuming rate limit quota', async () => {
    const res = await request(app).get('/api/auth/demo-info');
    expect(res.status).toBe(200);
    expect(res.body.demo_mode_enabled).toBe(true);
  });

  it('6. Blocks 11th consecutive bad login attempt with HTTP 429', async () => {
    const uniqueEmail = `ratelimit_${Date.now()}@testdomain.com`;
    // Perform 10 failed login attempts with the same identifier
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: uniqueEmail, password: 'WrongPassword123!' });
      expect(res.status).toBe(401);
    }

    // 11th attempt must be rate-limited with HTTP 429
    const limitedRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: uniqueEmail, password: 'WrongPassword123!' });
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.body.error).toMatch(/too many authentication attempts/i);
  });

  it('7. Upload of 100KB file via multipart/form-data succeeds with 200', async () => {
    const buffer100kb = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(100 * 1024 - 9, 'A'),
    ]);

    const res = await request(app)
      .post(`/api/courses/${courseId}/materials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'Test 100KB Material')
      .field('module_title', 'Module 1 · Testing')
      .field('duration_minutes', 15)
      .attach('file', buffer100kb, 'lesson-100kb.pdf');

    expect(res.status).toBe(200);
    expect(res.body.material).toBeDefined();
    expect(res.body.material.file_size).toBe(buffer100kb.length);
  });

  it('8. Upload of 1.2MB file via multipart/form-data succeeds with 200 (fixes 413 upload regression)', async () => {
    const size1_2mb = Math.floor(1.2 * 1024 * 1024);
    const buffer1_2mb = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(size1_2mb - 9, 'B'),
    ]);

    const res = await request(app)
      .post(`/api/courses/${courseId}/materials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'Test 1.2MB Material')
      .field('module_title', 'Module 1 · Testing')
      .field('duration_minutes', 20)
      .attach('file', buffer1_2mb, 'lesson-1_2mb.pdf');

    expect(res.status).toBe(200);
    expect(res.body.material).toBeDefined();
    expect(res.body.material.file_size).toBe(buffer1_2mb.length);
  });

  it('9. Upload of 5MB file via multipart/form-data succeeds at the upper limit', async () => {
    const size5mb = 5 * 1024 * 1024;
    const buffer5mb = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(size5mb - 9, 'C'),
    ]);

    const res = await request(app)
      .post(`/api/courses/${courseId}/materials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'Test 5MB Material')
      .field('module_title', 'Module 1 · Testing')
      .field('duration_minutes', 25)
      .attach('file', buffer5mb, 'lesson-5mb.pdf');

    expect(res.status).toBe(200);
    expect(res.body.material).toBeDefined();
    expect(res.body.material.file_size).toBe(buffer5mb.length);
  });

  it('10. Upload of 6MB file returns clean HTTP 400 JSON error without crashing or returning HTML', async () => {
    const size6mb = 6 * 1024 * 1024;
    const buffer6mb = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(size6mb - 9, 'D'),
    ]);

    const res = await request(app)
      .post(`/api/courses/${courseId}/materials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'Test 6MB Material')
      .field('module_title', 'Module 1 · Testing')
      .field('duration_minutes', 30)
      .attach('file', buffer6mb, 'oversized-6mb.pdf');

    expect(res.status).toBe(400);
    expect(res.type).toMatch(/json/);
    expect(res.body.error).toMatch(/exceeds 5MB limit/i);
  });

  it('11. Simulates crash right after student registration and confirms user persistence', async () => {
    const uniqueNum = Date.now();
    const studentEmail = `durable_student_${uniqueNum}@example.com`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        username: `durable_${uniqueNum}`,
        full_name: 'Durable Crash Test Student',
        email: studentEmail,
        password: 'Password12345!',
        role: 'student',
      });

    expect(regRes.status).toBe(200);
    expect(regRes.body.user).toBeDefined();
    const createdUserId = regRes.body.user.id;

    // Simulate server crash and reboot by loading state from persistence store
    expect(kernel.store).toBeDefined();
    const persistedState = await kernel.store!.load();
    expect(persistedState).not.toBeNull();
    const persistedUser = persistedState!.users.find((u) => u.id === createdUserId);
    expect(persistedUser).toBeDefined();
    expect(persistedUser?.email).toBe(studentEmail);
  });

  it('12. Central error middleware catches body-too-large (JSON > 1MB) returning clean HTTP 413 JSON', async () => {
    const hugeBody = { big_string: 'x'.repeat(Math.floor(1.2 * 1024 * 1024)) };
    const res = await request(app)
      .post('/api/auth/login')
      .send(hugeBody);

    expect(res.status).toBe(413);
    expect(res.type).toMatch(/json/);
    expect(res.body.error).toMatch(/exceeds size limit/i);
  });
});

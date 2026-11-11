import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Ensure tests NEVER touch real backends or production data
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-test-data-'));
fs.mkdirSync(path.join(testDataDir, 'uploads'), { recursive: true });

process.env.PERSISTENCE_BACKEND = 'memory';
process.env.STORAGE_BACKEND = 'memory';
process.env.LMS_DEMO_MODE = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
process.env.LMS_DATA_DIR = testDataDir;
process.env.FIREBASE_PROJECT_ID = '';

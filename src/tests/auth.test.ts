import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Reusable unit test logic reflecting server hardening specifications
function hashPasswordScrypt(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$16384$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!storedHash) return resolve(false);

    if (!storedHash.startsWith('scrypt$')) {
      const legacyHash = crypto.createHash('sha256').update(`smartlms:${password}`).digest('hex');
      try {
        const isMatch =
          legacyHash.length === storedHash.length &&
          crypto.timingSafeEqual(Buffer.from(legacyHash, 'hex'), Buffer.from(storedHash, 'hex'));
        return resolve(isMatch);
      } catch {
        return resolve(false);
      }
    }

    const parts = storedHash.split('$');
    if (parts.length !== 4) return resolve(false);
    const [, nStr, salt, hashHex] = parts;
    const cost = parseInt(nStr, 10) || 16384;
    crypto.scrypt(password, salt, 64, { N: cost, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const expectedBuf = Buffer.from(hashHex, 'hex');
        const match =
          derivedKey.length === expectedBuf.length &&
          crypto.timingSafeEqual(derivedKey, expectedBuf);
        resolve(match);
      } catch {
        resolve(false);
      }
    });
  });
}

function createTestToken(payloadObj: Record<string, unknown>, secret: string): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyTestToken(
  token: string,
  secret: string,
  userTokenVersion = 1
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expectedSigBuf = Buffer.from(expectedSig, 'base64url');

  if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    // 8-hour expiry check
    if (Date.now() - parsed.iat > 8 * 60 * 60 * 1000) return null;
    if ((parsed.token_version ?? 1) !== userTokenVersion) return null;
    return parsed;
  } catch {
    return null;
  }
}

describe('LMS Security Hardening Pass', () => {
  const secretKey = 'super-secret-key-at-least-32-characters-long';

  it('correctly hashes and verifies passwords using crypto.scrypt', async () => {
    const raw = 'myStrongPassword123';
    const hash = await hashPasswordScrypt(raw);
    expect(hash.startsWith('scrypt$16384$')).toBe(true);

    const valid = await verifyPassword(raw, hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword('wrongPassword', hash);
    expect(invalid).toBe(false);
  });

  it('supports legacy sha256 verification and timingSafeEqual', async () => {
    const raw = 'legacyPassword456';
    const legacyHash = crypto.createHash('sha256').update(`smartlms:${raw}`).digest('hex');

    const valid = await verifyPassword(raw, legacyHash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword('bad', legacyHash);
    expect(invalid).toBe(false);
  });

  it('creates and verifies cryptographically signed session tokens', () => {
    const token = createTestToken(
      { uid: 42, role: 'student', iat: Date.now(), token_version: 1 },
      secretKey
    );
    const verified = verifyTestToken(token, secretKey, 1);
    expect(verified).not.toBeNull();
    expect(verified?.uid).toBe(42);
  });

  it('rejects tampered session tokens with timing-safe comparison', () => {
    const token = createTestToken(
      { uid: 42, role: 'student', iat: Date.now(), token_version: 1 },
      secretKey
    );
    const tampered = token.slice(0, -4) + 'abcd';
    expect(verifyTestToken(tampered, secretKey, 1)).toBeNull();
  });

  it('enforces 8-hour session expiration', () => {
    const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;
    const expiredToken = createTestToken(
      { uid: 42, role: 'student', iat: nineHoursAgo, token_version: 1 },
      secretKey
    );
    expect(verifyTestToken(expiredToken, secretKey, 1)).toBeNull();
  });

  it('revokes session tokens when user token_version is incremented', () => {
    const token = createTestToken(
      { uid: 42, role: 'student', iat: Date.now(), token_version: 1 },
      secretKey
    );
    // After password change, user version increments to 2
    expect(verifyTestToken(token, secretKey, 2)).toBeNull();
  });
});

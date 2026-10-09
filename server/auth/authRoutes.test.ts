import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';
import { createApp, login, resources } from './authRoutesTestSupport';
import { defaultRegistrationLimiter } from './registrationAntiAbuse';
import { defaultPasswordResetRequestRateLimiter } from './passwordResetRequestLimiter';

describe('cookie auth routes', () => {
  it('creates an account profile and exposes the current session without leaking its token', async () => {
    const app = await createApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'Owner@Example.com',
        displayName: 'Мария Иванова',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });

    expect(registered.statusCode).toBe(201);
    expect(registered.json().data).toMatchObject({
      username: 'owner',
      email: 'owner@example.com',
      displayName: 'Мария Иванова',
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie },
    });

    expect(account.statusCode).toBe(200);
    expect(account.json().data).toMatchObject({
      username: 'owner',
      email: 'owner@example.com',
      displayName: 'Мария Иванова',
      profile: {
        headline: null,
        location: null,
        workMode: null,
      },
      sessions: [
        {
          current: true,
        },
      ],
    });
    expect(JSON.stringify(account.json())).not.toContain('oqs_');
  });

  it('updates candidate-owned account fields through an origin-protected route', async () => {
    const app = await createApp();
    const candidate = await login(app, 'candidate.test', 'candidate-password-for-tests');

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/account/profile',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        email: 'Candidate@Example.com',
        displayName: 'Мария Волкова',
        headline: 'Product Operations Lead',
        location: 'Берлин, Германия',
        workMode: 'hybrid',
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      email: 'candidate@example.com',
      displayName: 'Мария Волкова',
      profile: {
        headline: 'Product Operations Lead',
        location: 'Берлин, Германия',
        workMode: 'hybrid',
      },
    });
  });

  it('updates candidate timezone and validates IANA format', async () => {
    const app = await createApp();
    const candidate = await login(app, 'candidate.test', 'candidate-password-for-tests');

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/v1/account/profile',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        timezone: 'Mars/Phobos',
      },
    });
    expect(invalid.statusCode).toBe(422);

    const valid = await app.inject({
      method: 'PATCH',
      url: '/api/v1/account/profile',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        timezone: 'Europe/Belgrade',
      },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().data.profile).toMatchObject({
      timezone: 'Europe/Belgrade',
    });

    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
    });
    expect(account.statusCode).toBe(200);
    expect(account.json().data.profile.timezone).toBe('Europe/Belgrade');
  });

  it('changes the password and rotates every existing session', async () => {
    const app = await createApp();
    const first = await login(app, 'candidate.test', 'candidate-password-for-tests');
    const second = await login(app, 'candidate.test', 'candidate-password-for-tests');

    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password',
      headers: {
        cookie: second.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        currentPassword: 'candidate-password-for-tests',
        newPassword: 'candidate-password-after-change',
      },
    });

    expect(changed.statusCode).toBe(200);
    const rotatedCookie = String(changed.headers['set-cookie']).split(';')[0];
    expect(rotatedCookie).not.toBe(second.cookie);
    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: first.cookie },
    });
    expect(oldSession.json().data).toBeNull();
    expect(
      (await login(app, 'candidate.test', 'candidate-password-for-tests')).response.statusCode,
    ).toBe(401);
    expect(
      (await login(app, 'candidate.test', 'candidate-password-after-change')).response.statusCode,
    ).toBe(200);
  });

  it('resets a forgotten password through a one-time emailed token', async () => {
    const deliveries: Array<{ email: string; token: string }> = [];
    const app = await createApp(async ({ email, token }) => {
      deliveries.push({ email, token });
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'recover@example.com',
        displayName: 'Анна Смирнова',
        password: 'candidate-password-before-reset',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    const firstSessionCookie = String(created.headers['set-cookie']).split(';')[0];
    const secondSession = await login(app, 'recover@example.com', 'candidate-password-before-reset');

    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset-requests',
      headers: { origin: 'http://localhost:3000' },
      payload: { identifier: 'RECOVER@EXAMPLE.COM' },
    });

    expect(requested.statusCode).toBe(202);
    expect(requested.json().data).toEqual({
      accepted: true,
      deliveryConfigured: true,
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.email).toBe('recover@example.com');
    expect(deliveries[0]?.token).toMatch(/^oqr_[A-Za-z0-9_-]{40,}$/);

    const unknownRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset-requests',
      headers: { origin: 'http://localhost:3000' },
      payload: { identifier: 'missing@example.com' },
    });
    expect(unknownRequest.statusCode).toBe(requested.statusCode);
    expect(unknownRequest.json().data).toEqual(requested.json().data);

    const weakPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-resets',
      headers: { origin: 'http://localhost:3000' },
      payload: { token: deliveries[0]?.token, newPassword: 'short' },
    });
    expect(weakPassword.statusCode).toBe(422);
    expect(weakPassword.json().error.fields.newPassword).toContain('8');

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-resets',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        token: deliveries[0]?.token,
        newPassword: 'candidate-password-after-reset',
      },
    });
    expect(reset.statusCode).toBe(200);
    for (const cookie of [firstSessionCookie, secondSession.cookie]) {
      const previousSession = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie },
      });
      expect(previousSession.json().data).toBeNull();
    }

    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-resets',
      headers: { origin: 'http://localhost:3000' },
      payload: { token: deliveries[0]?.token, newPassword: 'candidate-password-reused' },
    });
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-resets',
      headers: { origin: 'http://localhost:3000' },
      payload: { token: `oqr_${'z'.repeat(43)}`, newPassword: 'candidate-password-forged' },
    });
    expect(forged.statusCode).toBe(reused.statusCode);
    expect(forged.json().error).toMatchObject({
      code: reused.json().error.code,
      message: reused.json().error.message,
    });
    expect(reused.json().error.message).toBe('Ссылка недействительна. Запросите новую.');
    expect(
      (await login(app, 'recover@example.com', 'candidate-password-before-reset')).response
        .statusCode,
    ).toBe(401);
    expect(
      (await login(app, 'recover@example.com', 'candidate-password-after-reset')).response
        .statusCode,
    ).toBe(200);
  });

  it('returns the same actionable error for an expired reset token', async () => {
    defaultPasswordResetRequestRateLimiter.reset();
    const deliveries: Array<{ email: string; token: string }> = [];
    const app = await createApp(async ({ email, token }) => {
      deliveries.push({ email, token });
    });
    try {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: 'http://localhost:3000' },
        payload: {
          email: 'expired@example.com',
          displayName: 'Кандидат',
          password: 'candidate-password-for-expired-reset',
          legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
        },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset-requests',
        headers: { origin: 'http://localhost:3000' },
        payload: { identifier: 'expired@example.com' },
      });
      const database = new DatabaseSync(join(resources.at(-1)!.directory, 'app.db'));
      database
        .prepare('UPDATE password_reset_tokens SET expires_at = ?')
        .run('2000-01-01T00:00:00.000Z');
      database.close();

      const expired = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-resets',
        headers: { origin: 'http://localhost:3000' },
        payload: { token: deliveries[0]?.token, newPassword: 'candidate-password-expired' },
      });

      expect(expired.statusCode).toBe(400);
      expect(expired.json().error).toMatchObject({
        code: 'password_reset_invalid',
        message: 'Ссылка недействительна. Запросите новую.',
      });
    } finally {
      defaultPasswordResetRequestRateLimiter.reset();
    }
  });

  it('returns 429 with Retry-After after the password reset request limit', async () => {
    defaultPasswordResetRequestRateLimiter.reset();
    const app = await createApp();
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const accepted = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/password-reset-requests',
          headers: { origin: 'http://localhost:3000' },
          payload: { identifier: `reset-${attempt}@example.com` },
        });
        expect(accepted.statusCode).toBe(202);
      }
      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset-requests',
        headers: { origin: 'http://localhost:3000' },
        payload: { identifier: 'sixth@example.com' },
      });

      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.json().error).toMatchObject({ code: 'rate_limit_exceeded', retryable: true });
    } finally {
      defaultPasswordResetRequestRateLimiter.reset();
    }
  });

  it('revokes every session except the one making the request', async () => {
    const app = await createApp();
    const older = await login(app, 'candidate.test', 'candidate-password-for-tests');
    const current = await login(app, 'candidate.test', 'candidate-password-for-tests');

    const revoked = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account/sessions',
      headers: {
        cookie: current.cookie,
        origin: 'http://localhost:3000',
      },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().data).toEqual({ revoked: 1 });

    const oldMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: older.cookie },
    });
    const currentMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: current.cookie },
    });
    expect(oldMe.json().data).toBeNull();
    expect(currentMe.json().data).toMatchObject({ role: 'candidate' });
  });

  it('uploads, downloads and deletes a candidate-owned CV', async () => {
    const app = await createApp();
    const candidate = await login(app, 'candidate.test', 'candidate-password-for-tests');
    const contentBase64 = Buffer.from('%PDF candidate CV 881').toString('base64');

    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/documents',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        kind: 'resume',
        source: 'upload',
        fileName: 'candidate-cv.pdf',
        mimeType: 'application/pdf',
        contentBase64,
        extractedText: 'Руководил операциями и улучшал удержание на 18%.',
        parseStatus: 'ready',
      },
    });
    expect(uploaded.statusCode).toBe(201);
    const documentId = uploaded.json().data.document.id as string;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie: candidate.cookie },
    });
    expect(listed.json().data.documents).toMatchObject([
      { id: documentId, fileName: 'candidate-cv.pdf', kind: 'resume' },
    ]);

    const retentionUntil = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const retained = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/documents/${documentId}/retention`,
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: { retentionUntil },
    });
    expect(retained.statusCode).toBe(200);
    expect(retained.json().data).toMatchObject({
      id: documentId,
      retentionUntil,
    });

    const downloaded = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}`,
      headers: { cookie: candidate.cookie },
    });
    expect(downloaded.statusCode).toBe(200);
    // Карточка лёгкая: байты файла отдаёт `/download`, текст — своя страница
    // (INC-034). Целиком запись маршрут не доносил.
    expect(downloaded.json().data).toMatchObject({
      id: documentId,
      textLength: 'Руководил операциями и улучшал удержание на 18%.'.length,
    });
    expect(downloaded.json().data).not.toHaveProperty('contentBase64');

    const text = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}/text`,
      headers: { cookie: candidate.cookie },
    });
    expect(text.statusCode).toBe(200);
    expect(text.json().data.text).toBe('Руководил операциями и улучшал удержание на 18%.');
    expect(text.json().meta.nextOffset).toBeNull();

    const binaryDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}/download`,
      headers: { cookie: candidate.cookie },
    });
    expect(binaryDownload.statusCode).toBe(200);
    expect(binaryDownload.headers['content-type']).toBe('application/pdf');
    expect(binaryDownload.headers['content-disposition']).toContain(
      "filename*=UTF-8''candidate-cv.pdf",
    );
    expect(binaryDownload.rawPayload).toEqual(Buffer.from('%PDF candidate CV 881'));
    expect(binaryDownload.body).not.toContain('Руководил операциями');
    for (let requestNumber = 2; requestNumber <= 30; requestNumber += 1) {
      const repeated = await app.inject({
        method: 'GET',
        url: `/api/v1/candidate/documents/${documentId}/download`,
        headers: { cookie: candidate.cookie },
      });
      expect(repeated.statusCode).toBe(200);
    }
    const limitedDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}/download`,
      headers: { cookie: candidate.cookie },
    });
    expect(limitedDownload.statusCode).toBe(429);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/candidate/documents/${documentId}`,
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
    });
    expect(deleted.statusCode).toBe(204);
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}`,
      headers: { cookie: candidate.cookie },
    });
    expect(afterDelete.statusCode).toBe(404);
  });

  it('creates a personal candidate account and starts its own cookie session', async () => {
    const app = await createApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'new.candidate@example.com',
        displayName: 'Новый кандидат',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });

    expect(registered.statusCode).toBe(201);
    expect(registered.json().data).toMatchObject({
      username: 'new.candidate',
      role: 'candidate',
      isTest: false,
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const profile = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().data.candidate.dataClass).toBe('personal');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'NEW.CANDIDATE@example.com',
        displayName: 'Другой кандидат',
        password: 'another-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('email_taken');
    expect(duplicate.json().error.fields.email).toBeTruthy();
  });

  it('rejects registration with disposable email domain (B347 / US-11.5)', async () => {
    const app = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'burner@tempmail.com',
        displayName: 'Бот',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('disposable_email_rejected');
    expect(res.json().error.message).toContain('Временные и одноразовые');
  });

  it('enforces origin, role and candidate ownership boundaries', async () => {
    const app = await createApp();
    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'candidate.test',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    expect(noOrigin.statusCode).toBe(403);

    const candidate = await login(app, 'candidate.test', 'candidate-password-for-tests');
    expect(candidate.response.statusCode).toBe(200);
    expect(candidate.response.headers['set-cookie']).toContain('HttpOnly');
    expect(candidate.response.headers['set-cookie']).toContain('SameSite=Strict');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: candidate.cookie },
    });
    expect(me.json().data).toMatchObject({
      role: 'candidate',
      isTest: true,
    });

    const candidateProviderStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
      headers: { cookie: candidate.cookie },
    });
    expect(candidateProviderStatus.statusCode).toBe(401);

    const csrfBlocked = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        cookie: candidate.cookie,
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: 'Я запускал продукт.',
      },
    });
    expect(csrfBlocked.statusCode).toBe(403);

    const coach = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: 'Я запускал продукт.',
      },
    });
    expect(coach.statusCode).toBe(200);

    const admin = await login(app, 'admin.test', 'admin-password-for-tests');
    const adminProviderStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
      headers: { cookie: admin.cookie },
    });
    expect(adminProviderStatus.statusCode).toBe(200);
    const adminCandidateProfile = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie: admin.cookie },
    });
    expect(adminCandidateProfile.statusCode).toBe(401);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: candidate.cookie },
    });
    expect(afterLogout.statusCode).toBe(200);
    expect(afterLogout.json().data).toBeNull();
  });
});

describe('registration without a login field (B139)', () => {
  async function register(
    app: Awaited<ReturnType<typeof createApp>>,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      // Every registration now carries the accepted pack (B173); the cases
      // that test the acceptance itself live in legalConsentRoute.test.ts.
      payload: { legalConsent: { versionId: LEGAL_PACK_VERSION_ID }, ...payload },
    });
  }

  it('returns a retryable 429 with Retry-After when registration is limited with email verification off', async () => {
    defaultRegistrationLimiter.reset();
    const app = await createApp(undefined, undefined, undefined, {}, { release: 'staging' });
    try {
      for (let index = 0; index < 3; index += 1) {
        const response = await register(app, {
          displayName: 'Кандидат',
          email: `limited-${index}@example.com`,
          password: 'candidate-password-for-tests',
        });
        expect(response.statusCode).toBe(201);
      }

      const limited = await register(app, {
        displayName: 'Кандидат',
        email: 'limited-fourth@example.com',
        password: 'candidate-password-for-tests',
      });

      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.json().error).toMatchObject({ code: 'rate_limit_exceeded', retryable: true });
    } finally {
      defaultRegistrationLimiter.reset();
    }
  });

  it('creates the account the owner tried to create and could not', async () => {
    const app = await createApp();
    const response = await register(app, {
      displayName: 'Мария Иванова',
      email: 'alexey@example.com',
      password: 'parol123',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.username).toBe('alexey');
    expect(String(response.headers['set-cookie'])).toContain('oqs_');
  });

  it('accepts an eight-character password, which the old floor of twelve refused', async () => {
    const app = await createApp();
    expect(
      (
        await register(app, {
          displayName: 'Анна',
          email: 'anna@example.com',
          password: '12345678',
        })
      ).statusCode,
    ).toBe(201);
  });

  it('says which field is wrong instead of one anonymous line', async () => {
    const app = await createApp();
    const short = await register(app, {
      displayName: 'Анна',
      email: 'anna@example.com',
      password: 'parol12',
    });

    expect(short.statusCode).toBe(422);
    expect(short.json().error.fields.password).toContain('8');
    expect(short.json().error.message).not.toBe('Проверьте формат и длину переданных данных.');

    const badEmail = await register(app, {
      displayName: 'Анна',
      email: 'anna@example',
      password: 'parol123',
    });
    expect(badEmail.json().error.fields.email).toBe('Введите корректный email');

    const badName = await register(app, {
      displayName: 'A1',
      email: 'anna2@example.com',
      password: 'parol123',
    });
    expect(badName.json().error.fields.displayName).toContain('буквы');
  });

  it('reports the rule the value actually broke, not the first rule of the field', async () => {
    const app = await createApp();
    const tooLong = await register(app, {
      displayName: 'Анна',
      email: 'anna@example.com',
      password: 'x'.repeat(300),
    });

    expect(tooLong.statusCode).toBe(422);
    // A 300-character password is not "короче 8": telling the candidate to
    // lengthen it would send them the wrong way.
    expect(tooLong.json().error.fields.password).toBe('Пароль слишком длинный');

    const plusAlias = await register(app, {
      displayName: 'Анна',
      email: 'anna+job@example.com',
      password: 'parol123',
    });
    expect(plusAlias.json().error.fields.email).toBe('Email не должен содержать символ «+»');
  });

  it('resolves a derived-handle collision instead of failing the second candidate', async () => {
    const app = await createApp();
    const first = await register(app, {
      displayName: 'Анна',
      email: 'anna@example.com',
      password: 'parol123',
    });
    const second = await register(app, {
      displayName: 'Анна',
      email: 'anna@other.example.com',
      password: 'parol123',
    });

    expect(first.json().data.username).toBe('anna');
    expect(second.statusCode).toBe(201);
    expect(second.json().data.username).toBe('anna2');
  });

  it('lets the new candidate sign in with the address they registered with', async () => {
    const app = await createApp();
    await register(app, {
      displayName: 'Анна',
      email: 'anna@example.com',
      password: 'parol123',
    });

    const signedIn = await login(app, 'anna@example.com', 'parol123');
    expect(signedIn.response.statusCode).toBe(200);
  });

  it('names the real fifteen-minute wait when sign-in hits the limit (PRB-015)', async () => {
    const app = await createApp();
    let limited = await login(app, 'candidate.test', 'wrong-password-entirely');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      limited = await login(app, 'candidate.test', 'wrong-password-entirely');
      if (limited.response.statusCode === 429) break;
    }

    expect(limited.response.statusCode).toBe(429);
    expect(limited.response.json().error.message).toBe(
      'Слишком много запросов. Повторите действие через 15 минут.',
    );
  });

  it('keeps sign-in working for handles typed before the field was removed', async () => {
    const app = await createApp();
    const seeded = await login(app, 'candidate.test', 'candidate-password-for-tests');
    expect(seeded.response.statusCode).toBe(200);
  });

  it('refuses registration for reserved handles and creates no user or candidate rows (B162)', async () => {
    const app = await createApp();
    const resource = resources.find((r) => r.app === app)!;
    const db = new DatabaseSync(join(resource.directory, 'app.db'), { readOnly: true });

    const countUsers = () =>
      (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
    const countCandidates = () =>
      (db.prepare('SELECT COUNT(*) AS count FROM candidates').get() as { count: number }).count;

    const usersBefore = countUsers();
    const candidatesBefore = countCandidates();

    const response = await register(app, {
      displayName: 'Администратор',
      email: 'admin.test@example.com',
      password: 'candidate-password-for-tests',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('email_taken');
    expect(response.json().error.message).toBe('Этот email уже связан с другим аккаунтом.');

    expect(countUsers()).toBe(usersBefore);
    expect(countCandidates()).toBe(candidatesBefore);

    db.close();
  });
});

/**
 * PRB-038. Cookie жила 12 часов и не переиздавалась, так что браузерная сессия
 * умирала раньше серверной. Теперь она живёт столько же, сколько скользящая
 * сессия, и каждое открытие приложения (`/auth/me`) выдаёт её заново.
 */
describe('sliding session cookie (PRB-038)', () => {
  it('issues a thirty-day cookie and reissues it on /auth/me', async () => {
    const app = await createApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'sliding@example.com',
        displayName: 'Скользящая Сессия',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    const issued = String(registered.headers['set-cookie']);
    expect(issued).toContain('Max-Age=2592000');
    const cookie = issued.split(';')[0];

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.username).toBe('sliding');
    const reissued = String(me.headers['set-cookie']);
    expect(reissued.split(';')[0]).toBe(cookie);
    expect(reissued).toContain('Max-Age=2592000');
  });

  it('does not set a cookie on /auth/me for a bearer or anonymous caller', async () => {
    const app = await createApp();
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(anonymous.headers['set-cookie']).toBeUndefined();
  });
});

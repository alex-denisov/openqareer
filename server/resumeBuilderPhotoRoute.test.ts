import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import jpeg from 'jpeg-js';
import { afterEach, describe, expect, it } from 'vitest';
import { SAMPLE_BUILDER_RESUME } from '../shared/resumeBuilder/model';
import { buildApp } from './app';
import { config as baseConfig, noSessions } from './appTestHarness';
import { SqliteResumePhotoRepository } from './candidate/sqliteResumePhotoRepository';
import { SealedText } from './data/sealedText';
import { SqliteCandidateMediaRepository } from './data/sqliteCandidateMediaRepository';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { ResumeDraft } from './domain/resumeDraft';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const PHOTO_ID = 'b'.repeat(32);
const JPEG = Buffer.from(
  jpeg.encode({ data: Buffer.alloc(40 * 40 * 4, 150), width: 40, height: 40 }, 90).data,
);

async function setup(inResume: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-resume-photo-'));
  const config = { ...baseConfig, databasePath: join(directory, 'test.sqlite') };
  const store = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const database = new DatabaseSync(config.databasePath);
  new SqliteCandidateMediaRepository(database, new SealedText(config.dataEncryptionKey)).saveMany(
    candidate.id,
    [{ mediaId: PHOTO_ID, kind: 'photo', mime: 'image/jpeg', bytes: JPEG }],
  );
  const draft = {
    schemaVersion: 2,
    candidate: { fullName: 'Мария Соколова', photoMediaId: PHOTO_ID },
    experience: [],
    education: [],
    languages: [],
  } as unknown as ResumeDraft;
  store.saveResumeDraft(candidate.id, draft, []);
  new SqliteResumePhotoRepository(database).setInResume(
    candidate.id,
    inResume,
    '2026-11-23T10:00:00.000Z',
  );
  database.close();
  const app = await buildApp({
    config,
    candidateStore: store,
    authService: noSessions,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => store.close(),
    () => app.close(),
  );
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

async function exportPdf(inResume: boolean, profilePhoto?: boolean): Promise<string> {
  const { app, authorization } = await setup(inResume);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/candidate/resume-builder/export',
    headers: { authorization, origin: 'http://localhost:3000' },
    payload: {
      format: 'pdf',
      template: 'strict',
      resume: SAMPLE_BUILDER_RESUME,
      ...(profilePhoto === undefined ? {} : { profilePhoto }),
    },
  });
  expect(response.statusCode).toBe(200);
  return response.rawPayload.toString('latin1');
}

const hasImage = (pdf: string) => /\/Subtype \/Image/u.test(pdf);

describe('B666: «Фото в резюме» в файле резюме под роль', () => {
  it('включено — фото профиля в PDF', async () => {
    expect(hasImage(await exportPdf(true, true))).toBe(true);
  });
  it('выключено — фото нет', async () => {
    expect(hasImage(await exportPdf(false, true))).toBe(false);
  });
  it('конструктор без запроса фото — фото нет и при включённой настройке', async () => {
    expect(hasImage(await exportPdf(true))).toBe(false);
  });
});

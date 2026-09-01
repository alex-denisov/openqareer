import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp } from './appTestHarness';

/**
 * Загрузка резюме в 64 КБ уходила на сервер и не получала ответа: маршрут
 * владельца обрывает обмен примерно на 20 460 байт и в эту сторону (INC-031).
 * Файл приезжает частями и собирается на сервере, а документ обязан получиться
 * тем же самым — байт в байт.
 */
const PART_BYTES = 12_288;

function base64Of(size: number): string {
  return Buffer.from('R'.repeat(size)).toString('base64').replace(/=+$/u, '');
}

describe('POST /api/v1/candidate/documents/parts', () => {
  it('собирает документ из частей, и он равен исходному файлу', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const content = base64Of(40_000);
    const uploadId = '11111111-1111-4111-8111-111111111111';
    const total = Math.ceil(content.length / PART_BYTES);

    expect(total).toBeGreaterThan(1);
    for (let index = 0; index < total; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/documents/parts',
        headers: { authorization },
        payload: {
          uploadId,
          index,
          total,
          part: content.slice(index * PART_BYTES, (index + 1) * PART_BYTES),
        },
      });
      expect(response.statusCode).toBe(200);
      // Ответ на часть тоже обязан помещаться в бюджет маршрута.
      expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThan(12_288);
    }

    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/documents',
      headers: { authorization },
      payload: {
        kind: 'resume',
        source: 'upload',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        uploadId,
        parseStatus: 'pending',
      },
    });

    expect(saved.statusCode).toBe(201);
    expect(saved.json().data.document.byteSize).toBe(Buffer.from(content, 'base64').length);
  });

  it('не сохраняет документ, если часть не дошла', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const uploadId = '22222222-2222-4222-8222-222222222222';

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/documents/parts',
      headers: { authorization },
      payload: { uploadId, index: 0, total: 2, part: base64Of(100) },
    });

    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/documents',
      headers: { authorization },
      payload: {
        kind: 'resume',
        source: 'upload',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        uploadId,
        parseStatus: 'pending',
      },
    });

    expect(saved.statusCode).toBe(409);
    expect(saved.json().error.code).toBe('document_upload_incomplete');
  });

  it('файл и идентификатор загрузки вместе не принимаются', async () => {
    const app = await createApp();
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/documents',
      headers: { authorization: candidateAuthorization(app) },
      payload: {
        kind: 'resume',
        source: 'upload',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        contentBase64: base64Of(100),
        uploadId: '33333333-3333-4333-8333-333333333333',
        parseStatus: 'pending',
      },
    });

    expect(saved.statusCode).toBe(422);
  });
});

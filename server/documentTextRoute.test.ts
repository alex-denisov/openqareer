import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp } from './appTestHarness';
import { DOCUMENT_TEXT_PAGE_BYTE_BUDGET } from './data/documentTextPage';

/**
 * Карточка документа отдавала 20 469 байт и обрывалась на середине строки:
 * JSON невалиден, `extractedText` не доезжал (INC-034). Карточка обязана быть
 * лёгкой, а текст — читаться страницами и склеиваться в исходный.
 */
const EXTRACTED_TEXT = 'Разработчик интерфейсов. Опыт восемь лет. '.repeat(2_000);
/** Хранилище отдаёт текст без хвостовых пробелов — сравниваем с тем, что легло. */
const STORED_TEXT = EXTRACTED_TEXT.trim();

async function createDocument(app: Awaited<ReturnType<typeof createApp>>, authorization: string) {
  const saved = await app.inject({
    method: 'POST',
    url: '/api/v1/candidate/documents',
    headers: { authorization },
    payload: {
      kind: 'resume',
      source: 'upload',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('R'.repeat(40_000)).toString('base64'),
      extractedText: EXTRACTED_TEXT,
      parseStatus: 'ready',
    },
  });
  expect(saved.statusCode).toBe(201);
  return saved.json().data.document.id as string;
}

describe('GET /api/v1/candidate/documents/:documentId', () => {
  it('карточка помещается в бюджет и не везёт ни байты файла, ни текст', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const documentId = await createDocument(app, authorization);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(() => JSON.parse(response.body)).not.toThrow();
    expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThanOrEqual(
      DOCUMENT_TEXT_PAGE_BYTE_BUDGET,
    );
    const document = response.json().data;
    expect(document).toMatchObject({
      id: documentId,
      fileName: 'resume.pdf',
      parseStatus: 'ready',
      textLength: STORED_TEXT.length,
    });
    expect(document).not.toHaveProperty('contentBase64');
    expect(document).not.toHaveProperty('extractedText');
  });

  it('страницы текста склеиваются в разобранный текст', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const documentId = await createDocument(app, authorization);

    let offset: number | null = 0;
    let joined = '';
    let pages = 0;
    while (offset !== null) {
      const response: Awaited<ReturnType<typeof app.inject>> = await app.inject({
        method: 'GET',
        url: `/api/v1/candidate/documents/${documentId}/text?offset=${offset}`,
        headers: { authorization },
      });
      expect(response.statusCode).toBe(200);
      expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThanOrEqual(
        DOCUMENT_TEXT_PAGE_BYTE_BUDGET + 1_024,
      );
      joined += response.json().data.text;
      offset = response.json().meta.nextOffset;
      pages += 1;
      expect(pages).toBeLessThan(100);
    }

    expect(pages).toBeGreaterThan(1);
    expect(joined).toBe(STORED_TEXT);
  });

  it('без сессии кандидата ни карточка, ни текст не отдаются', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const documentId = await createDocument(app, authorization);

    const card = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}`,
    });
    expect(card.statusCode).toBe(401);

    const text = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}/text`,
    });
    expect(text.statusCode).toBe(401);
  });

  it('неизвестный документ отвечает 404, а не пустой страницей', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/documents/33333333-3333-4333-8333-333333333333/text',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(404);
  });
});

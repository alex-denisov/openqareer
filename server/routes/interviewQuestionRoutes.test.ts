import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTANT } from '../../shared/interviewQuestions/bank/accountant';
import { INTERVIEW_OPEN_QUESTIONS } from '../../shared/interviewQuestions';
import {
  professionStructuredData,
  registerInterviewQuestionRoutes,
} from './interviewQuestionRoutes';

const template =
  '<!doctype html><html lang="ru"><head><title>old</title><meta name="description" content="old"><link rel="canonical" href="old"></head><body><div class="ps">%%SALARY_CONTENT%%</div></body></html>';

function structured(html: string): { '@graph': { '@type': string; mainEntity?: unknown }[] } {
  const match = /<script type="application\/ld\+json">([^<]*)<\/script>/u.exec(html);
  return JSON.parse(match?.[1] ?? '{}');
}

describe('B568 interview question pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interview-ssr-'));
  const app = Fastify();
  beforeAll(async () => {
    writeFileSync(join(dir, 'salary-market.html'), template);
    registerInterviewQuestionRoutes(app, {
      staticRoot: dir,
      databasePath: join(dir, 'missing.sqlite'),
      readIndex: () => [
        {
          role: 'accountant',
          roleLabel: 'Бухгалтер',
          sampleSize: 4570,
          updatedAt: '2026-10-27T00:00:00Z',
          indexable: true,
        },
      ],
      signedIn: (request) => request.headers['x-test-session'] === '1',
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the hub with live catalog counts and an indexable collection', async () => {
    const response = await app.inject('/tools/interview-questions');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('index, follow');
    expect(response.body).toContain('4 570 вакансий');
    expect(response.body).toContain('/tools/interview-questions/accountant');
    expect(response.body).toContain('/assets/oq-interview-1.js');
    const types = structured(response.body)['@graph'].map((row) => row['@type']);
    expect(types).toEqual(['BreadcrumbList', 'CollectionPage', 'FAQPage']);
  });

  it('prints ten answers, locks the rest and keeps locked answers out of FAQPage', async () => {
    const response = await app.inject('/tools/interview-questions/accountant');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('index, follow');
    const locked = ACCOUNTANT.questions.slice(INTERVIEW_OPEN_QUESTIONS);
    for (const row of locked) {
      expect(response.body).toContain(row.question);
      expect(response.body).not.toContain(row.strong.slice(0, 40));
    }
    const faq = structured(response.body)['@graph'].find((row) => row['@type'] === 'FAQPage');
    const names = (faq?.mainEntity as { name: string }[]).map((row) => row.name);
    expect(names).toEqual(
      ACCOUNTANT.questions.slice(0, INTERVIEW_OPEN_QUESTIONS).map((row) => row.question),
    );
    expect(response.body).toContain('Открыть ещё 4 бесплатно');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('opens every answer to a signed-in reader without widening FAQPage', async () => {
    const response = await app.inject({
      url: '/tools/interview-questions/accountant',
      headers: { 'x-test-session': '1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-cache');
    const last = ACCOUNTANT.questions.at(-1)!;
    expect(response.body).toContain(last.strong.slice(0, 40));
    expect(response.body).not.toContain('после регистрации</span>');
    const faq = structured(response.body)['@graph'].find((row) => row['@type'] === 'FAQPage');
    expect((faq?.mainEntity as unknown[]).length).toBe(INTERVIEW_OPEN_QUESTIONS);
  });

  it('answers 404 for a profession without a published bank', async () => {
    const response = await app.inject('/tools/interview-questions/astronaut');
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-robots-tag']).toBe('noindex');
  });

  it('builds FAQPage only from the open questions', () => {
    const graph = professionStructuredData(ACCOUNTANT);
    const faq = graph.find((row) => row['@type'] === 'FAQPage') as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(INTERVIEW_OPEN_QUESTIONS);
  });
});

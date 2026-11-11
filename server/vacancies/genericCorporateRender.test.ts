import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import { fetchGenericCorporateVacancies } from './genericCorporateSiteAdapter';

const source = {
  id: 'career-acme',
  name: 'Acme',
  type: 'career_site',
  targetUrl: 'https://acme.test/careers',
} as VacancySourceConfig;

const SHELL = '<html><body><div id="root"></div><script src="/main.js"></script></body></html>';
const STATIC_EMPTY = `<html><body><h1>О компании</h1><p>${'Мы делаем логистику. '.repeat(80)}</p></body></html>`;
const RENDERED = `<html><body><div id="root"><ul>
  <li><a href="/jobs/101-backend-engineer">Backend Engineer</a></li>
  <li><a href="/jobs/102-product-designer">Product Designer</a></li>
</ul></div></body></html>`;

function serve(html: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('рендер страниц, нарисованных скриптом (B643)', () => {
  it('оболочка SPA: вакансии берутся из отрисованного HTML', async () => {
    serve(SHELL);
    const render = vi.fn(async () => RENDERED);
    const jobs = await fetchGenericCorporateVacancies(source, undefined, render);
    expect(render).toHaveBeenCalledWith('https://acme.test/careers');
    expect(jobs.map((job) => job.title)).toEqual(['Backend Engineer', 'Product Designer']);
    expect(jobs[0]?.url).toBe('https://acme.test/jobs/101-backend-engineer');
  });

  it('каскад нашёл вакансии — рендер не вызывается', async () => {
    serve(`<html><body><div id="root"></div>${RENDERED}</body></html>`);
    const render = vi.fn(async () => RENDERED);
    const jobs = await fetchGenericCorporateVacancies(source, undefined, render);
    expect(jobs).toHaveLength(2);
    expect(render).not.toHaveBeenCalled();
  });

  it('нет признаков скриптовой страницы — рендер не вызывается', async () => {
    serve(STATIC_EMPTY);
    const render = vi.fn(async () => RENDERED);
    await fetchGenericCorporateVacancies(source, undefined, render).catch(() => []);
    expect(render).not.toHaveBeenCalled();
  });

  it('рендер не дал HTML — честный ноль, без исключения от рендера', async () => {
    serve(SHELL);
    const render = vi.fn(async () => undefined);
    const outcome = await fetchGenericCorporateVacancies(source, undefined, render).then(
      (jobs) => jobs.length,
      () => 0,
    );
    expect(outcome).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

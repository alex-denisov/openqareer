import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { FitBlock } from './FitBlock';
import { ReqsBox } from './ReqsBox';
import { RequirementList } from './RequirementList';
import { fitRows } from './fitRows';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));

const requirement = (id: string, text: string) => ({
  id,
  text,
  sourceQuote: text,
  origin: 'explicit' as const,
  importance: 'high' as const,
  kind: 'experience' as const,
  hard: false,
  stopFactor: false,
  skill: true,
});

const view = {
  state: 'ready',
  requirements: [requirement('a', 'Kubernetes'), requirement('b', 'Найм руководителей'), requirement('c', 'English C1'), requirement('d', 'Go')],
  result: {
    status: 'assessed',
    dataState: 'confirmed',
    coveragePercent: 75,
    calculatedAt: '2026-11-11T09:00:00Z',
    coverage: { matched: 2, total: 4, unknown: 1, partial: 1 },
    reason: 'assessed',
    assessments: [
      { requirementId: 'a', status: 'matched', evidence: [{ factId: 'f', quote: 'Финтех Лаб · Kubernetes' }] },
      { requirementId: 'b', status: 'partial', evidence: [{ factId: 'f', quote: 'нанимали разработчиков' }] },
      { requirementId: 'c', status: 'unknown', evidence: [] },
      { requirementId: 'd', status: 'unmatched', evidence: [] },
    ],
  },
} as unknown as VacancyFitView;

const noop = () => undefined;
const render = (state: Parameters<typeof FitBlock>[0]['state'], fit?: VacancyFitView) =>
  renderToStaticMarkup(<FitBlock state={state} view={fit} sourceName="hh.ru" onRetry={noop} />);

describe('FitBlock', () => {
  it('считаем: v4-fit is-busy и «Считаем совпадение…»', () => {
    const html = render('busy');
    expect(html).toContain('class="v4-fit is-busy"');
    expect(html).toContain('Считаем совпадение…');
  });

  it('не посчитано: is-err, role=alert, «Повторить»', () => {
    const html = render('err');
    expect(html).toContain('v4-fit is-err');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Не удалось посчитать совпадение');
    expect(html).toContain('aria-label="Повторить"');
  });

  it('нет профиля: заголовок и единственная строка', () => {
    const html = render('none', view);
    expect(html).toContain('<p class="v4-none-t">Нет профиля</p>');
    expect(html).toContain('Загрузите резюме — посчитаем совпадение.');
  });

  it('есть процент: число, шкала с классом уровня, ⓘ «Почему 75 %»', () => {
    const html = render('ready', view);
    expect(html).toContain('Совпадение 75 %');
    expect(html).toContain('role="img" aria-label="Совпадение 75 %"');
    expect(html).toContain('class="is-good"');
    expect(html).toContain('aria-label="Почему 75 %"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Требования — из текста вакансии, hh.ru, 11.11 · 4 требования');
  });

  it('атрибута style в разметке нет', () => {
    expect(render('ready', view)).not.toContain('style=');
  });
});

describe('RequirementList', () => {
  const html = renderToStaticMarkup(<RequirementList rows={fitRows(view)} />);
  it('классы статусов макета', () => {
    expect(html).toContain('<li class="is-met">');
    expect(html).toContain('<li class="is-part">');
    expect(html).toContain('<li class="is-unk">');
    expect(html).toContain('<li class="is-no">');
  });
  it('цитата, «частично ·» и «неизвестно»', () => {
    expect(html).toContain('Финтех Лаб · Kubernetes');
    expect(html).toContain('частично · нанимали разработчиков');
    expect(html).toContain('неизвестно');
  });
  it('«Проверить» только у частичных и неизвестных', () => {
    expect(html).toContain('aria-label="Проверить: Найм руководителей"');
    expect(html).toContain('aria-label="Проверить: English C1"');
    expect(html).not.toContain('Проверить: Kubernetes');
    expect(html).not.toContain('Проверить: Go"');
    expect(html).toContain('href="/app/career/skills"');
  });
});

describe('ReqsBox', () => {
  it('строка «Требования: N из M есть в профиле», закрыта', () => {
    const html = renderToStaticMarkup(<ReqsBox view={view} />);
    expect(html).toContain('Требования: 2 из 4 есть в профиле');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('v4-fd-l');
  });
  it('нет требований — строки нет', () => {
    expect(renderToStaticMarkup(<ReqsBox view={undefined} />)).toBe('');
  });
});

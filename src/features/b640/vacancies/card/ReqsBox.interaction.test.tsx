// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { ReqsBox } from './ReqsBox';

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
  requirements: [
    requirement('a', 'Kubernetes'),
    requirement('b', 'Найм руководителей'),
    requirement('c', 'Go'),
  ],
  result: {
    status: 'assessed',
    dataState: 'confirmed',
    coveragePercent: 75,
    calculatedAt: '2026-11-11T09:00:00Z',
    coverage: { matched: 1, total: 3, unknown: 0, partial: 1 },
    reason: 'assessed',
    assessments: [
      {
        requirementId: 'a',
        status: 'matched',
        evidence: [{ factId: 'f', quote: 'Финтех Лаб · Kubernetes' }],
      },
      {
        requirementId: 'b',
        status: 'partial',
        evidence: [{ factId: 'f', quote: 'нанимали разработчиков' }],
      },
      { requirementId: 'c', status: 'unmatched', evidence: [] },
    ],
  },
} as unknown as VacancyFitView;

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

describe('ReqsBox раскрытие', () => {
  it('раскрывается списком с пометкой у каждого требования и строкой источника', () => {
    mounted = mount(<ReqsBox view={view} sourceName="hh.ru" />);
    const row = mounted.container.querySelector('button.v4-req-row')!;
    expect(row.textContent).toBe('Требования: 1 из 3 есть в профиле');
    click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const items = [...mounted.container.querySelectorAll('.v4-reqs-open .v4-fd-l li')];
    expect(items.map((li) => li.className)).toEqual(['is-met', 'is-part', 'is-no']);
    expect(items.every((li) => li.querySelector('svg'))).toBe(true);
    expect(mounted.container.querySelector('.v4-reqs-open .v4-fd-src')?.textContent).toBe(
      'Требования — из текста вакансии, hh.ru, 11.11 · 3 требования',
    );
  });
});

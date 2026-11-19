// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { CoachApiError } from '../../coach/apiClient';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { KpiReviewScreen } from './KpiReviewScreen';
import { KpiUploadScreen } from './KpiUploadScreen';

const api = vi.hoisted(() => ({
  createKpiImport: vi.fn(),
  getKpiImport: vi.fn(),
  acceptKpiImport: vi.fn(),
  deleteKpiSource: vi.fn(),
}));
vi.mock('./diaryApi', () => api);
const toast = vi.hoisted(() => ({ show: vi.fn(), hide: vi.fn() }));
vi.mock('../kit/Toast', () => ({ useToast: () => toast }));

const session = {
  username: 'flagged.test',
  email: 'm@mail.test',
  displayName: 'Марина',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
  features: { cabinetB640: true },
  emailVerified: true,
} as AuthUser;

const row = (id: string, title: string, target: string, weight: number | null) => ({
  id,
  title,
  target,
  targetValue: null,
  unit: '',
  dueDate: null,
  horizon: 'quarter',
  weight,
  setBy: 'manager',
  quote: '',
});
const DRAFT = {
  id: 'imp-1',
  sourceKind: 'text',
  sourceName: null,
  createdAt: '2027-01-03T10:00:00.000Z',
  rows: [row('r1', 'Срок релиза', '7 дней', 50), row('r2', 'Закрыто вакансий', '2 шт.', 50)],
  weightSum: 100,
  acceptedGoalIds: [],
  sourceStored: true,
};

let view: Mounted | null = null;
const navigate = vi.fn();

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(element: ReactElement, search = ''): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/diary/goals/import',
    search,
    match: null,
    consultantRoute: null,
    navigate,
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(<ShellProvider value={value}>{element}</ShellProvider>);
  await settle();
  return view.container;
}

function typeInto(field: Element | null, value: string): void {
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  api.getKpiImport.mockResolvedValue(DRAFT);
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('d02k «Загрузить KPI»', () => {
  it('пусто — ошибка на месте; текст уходит в разбор и открывает проверку', async () => {
    const page = await open(<KpiUploadScreen node={nodeByCode('d02k')!} />);
    click(button(page, 'Разобрать'));
    await settle();
    expect(page.querySelector('.va-err')?.textContent).toBe('Вставьте текст KPI или выберите файл');
    expect(api.createKpiImport).not.toHaveBeenCalled();

    api.createKpiImport.mockResolvedValue(DRAFT);
    typeInto(page.querySelector('#kd-text'), '2 вакансии закрыть до 28.02');
    click(button(page, 'Разобрать'));
    await settle();
    expect(api.createKpiImport).toHaveBeenCalledWith({
      kind: 'text',
      text: '2 вакансии закрыть до 28.02',
    });
    expect(navigate).toHaveBeenCalledWith('/app/diary/goals/import/review?import=imp-1');
  });

  it('ничего не нашли — строка «Не нашли показатели» и «Ввести вручную»', async () => {
    api.createKpiImport.mockRejectedValue(
      new CoachApiError('Не нашли показатели.', 'kpi_rows_not_found', false),
    );
    const page = await open(<KpiUploadScreen node={nodeByCode('d02k')!} />);
    typeInto(page.querySelector('#kd-text'), 'Без показателей');
    click(button(page, 'Разобрать'));
    await settle();
    expect(page.textContent).toContain('Не нашли показатели');
    expect(page.querySelector('a.row-act')?.getAttribute('href')).toBe('/app/diary/goals/new');
  });
});

describe('d02l «Проверьте, как мы поняли»', () => {
  it('строки на месте, «Принять 2» создаёт цели и возвращает к целям', async () => {
    api.acceptKpiImport.mockResolvedValue({ goalIds: ['g1', 'g2'] });
    const page = await open(<KpiReviewScreen node={nodeByCode('d02l')!} />, '?import=imp-1');
    expect(api.getKpiImport).toHaveBeenCalledWith('imp-1');
    expect(page.querySelectorAll('.kp-tbl tbody tr')).toHaveLength(2);
    click(button(page, 'Принять 2'));
    await settle();
    expect(api.acceptKpiImport).toHaveBeenCalledWith('imp-1', {
      rows: [
        expect.objectContaining({ title: 'Срок релиза', targetValue: 7, unit: 'дней', weight: 50 }),
        expect.objectContaining({ title: 'Закрыто вакансий', targetValue: 2, unit: 'шт.' }),
      ],
    });
    expect(navigate).toHaveBeenCalledWith('/app/diary/goals');
  });

  it('снятая отметка «Верно» меняет счёт; вес не на 100 % — строка ошибки', async () => {
    const page = await open(<KpiReviewScreen node={nodeByCode('d02l')!} />, '?import=imp-1');
    click(page.querySelectorAll<HTMLButtonElement>('[aria-pressed]')[1]!);
    expect(button(page, 'Принять 1')).not.toBeNull();
    click(button(page, 'Принять 1'));
    await settle();
    expect(page.querySelector('.va-err')?.textContent).toBe('Вес в сумме — 50 %, нужно 100 %');
    expect(api.acceptKpiImport).not.toHaveBeenCalled();
  });

  it('исходник удаляется после подтверждения', async () => {
    api.deleteKpiSource.mockResolvedValue({ ...DRAFT, sourceStored: false });
    const page = await open(<KpiReviewScreen node={nodeByCode('d02l')!} />, '?import=imp-1');
    click(button(page, 'Удалить загруженный текст'));
    const dialog = document.querySelector('[role="dialog"]')!;
    click([...dialog.querySelectorAll('button')].find((item) => item.textContent === 'Удалить')!);
    await settle();
    expect(api.deleteKpiSource).toHaveBeenCalledWith('imp-1');
    expect(page.textContent).toContain('Загруженный текст удалён');
  });
});

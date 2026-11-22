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

const mediaOf = (mobile: boolean) => (query: string) => ({
  matches: mobile && query.includes('max-width'),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', mediaOf(false));
  api.getKpiImport.mockResolvedValue(DRAFT);
});
afterEach(() => {
  vi.unstubAllGlobals();
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

describe('d02k: ⓘ «Источник» и «Загрузить другой файл»', () => {
  it('ⓘ называется «Источник»', async () => {
    const page = await open(<KpiUploadScreen node={nodeByCode('d02k')!} />);
    expect(page.querySelector('[aria-label="Источник"]')).not.toBeNull();
  });

  it('в файле нет показателей — «Загрузить другой файл» убирает файл и ошибку', async () => {
    api.createKpiImport.mockRejectedValue(
      new CoachApiError('Не нашли показатели.', 'kpi_rows_not_found', false),
    );
    const page = await open(<KpiUploadScreen node={nodeByCode('d02k')!} />);
    const input = page.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['a,b'], 'kpi.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(page.textContent).toContain('kpi.csv');
    click(button(page, 'Разобрать'));
    await settle();
    const other = page.querySelector<HTMLButtonElement>('[aria-label="Загрузить другой файл"]');
    expect(other).not.toBeNull();
    click(other);
    expect(page.textContent).not.toContain('kpi.csv');
    expect(page.textContent).not.toContain('Не нашли показатели');
    expect(button(page, 'Файл таблицы')).not.toBeNull();
  });
});

describe('d02l на 390: список, «Верно» и лист правки', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', mediaOf(true));
  });

  it('строки списком с подписью; ⓘ источника и веса; «Загрузить заново» в меню', async () => {
    const page = await open(<KpiReviewScreen node={nodeByCode('d02l')!} />, '?import=imp-1');
    expect(page.querySelector('.kp-tbl')).toBeNull();
    expect(page.querySelector('.kp-h')?.textContent).toBe('Проверьте 2 показателя');
    const rows = page.querySelectorAll('.kp-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.kp-v')?.textContent).toBe('7 дней');
    expect(rows[0]!.querySelector('.kp-s')?.textContent).toBe('квартал · вес 50 % · руководитель');
    expect(page.querySelector('[aria-label="Откуда показатели"]')).not.toBeNull();
    expect(page.querySelector('[aria-label="Как считается вес"]')).not.toBeNull();
    const menu = page.querySelector<HTMLButtonElement>('[aria-label="Ещё действия: показатели"]')!;
    click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    const again = page.querySelector('.kp-head [role="menuitem"]');
    expect(again?.textContent).toBe('Загрузить заново');
    expect(again?.getAttribute('href')).toBe('/app/diary/goals/import');
  });

  it('переключатель «Верно» меняет счёт; лист правит строку', async () => {
    const page = await open(<KpiReviewScreen node={nodeByCode('d02l')!} />, '?import=imp-1');
    const toggle = page.querySelector<HTMLInputElement>('[aria-label="Верно: Закрыто вакансий"]')!;
    expect(toggle.checked).toBe(true);
    click(toggle);
    expect(button(page, 'Принять 1')).not.toBeNull();

    click(page.querySelector('.kp-main'));
    const sheet = document.querySelector('[role="dialog"]')!;
    typeInto(sheet.querySelector('input'), 'Срок релиза, дней');
    click([...sheet.querySelectorAll('button')].find((item) => item.textContent === 'Готово')!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(page.querySelector('.kp-t')?.textContent).toBe('Срок релиза, дней');
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
    expect(navigate).not.toHaveBeenCalledWith('/app/diary/goals/import');
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

  it('без ?import — сразу на «Загрузить KPI», а не тупик «Повторить»', async () => {
    const page = await open(<KpiReviewScreen node={nodeByCode('d02l')!} />);
    expect(navigate).toHaveBeenCalledWith('/app/diary/goals/import');
    expect(api.getKpiImport).not.toHaveBeenCalled();
    expect(page.textContent).not.toContain('Показатели не загрузились');
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

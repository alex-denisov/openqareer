// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { ToastHost } from '../kit/Toast';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { AppScreen } from './AppScreen';
import { BillingScreen } from './BillingScreen';
import { DataScreen } from './DataScreen';
import { TariffsScreen } from './TariffsScreen';

const api = vi.hoisted(() => ({
  getAccount: vi.fn(),
  updateAccountProfile: vi.fn(),
  exportCandidateData: vi.fn(),
  deleteCandidateAccount: vi.fn(),
  getConsents: vi.fn(),
  grantConsent: vi.fn(),
  revokeConsent: vi.fn(),
  getAutomation: vi.fn(),
  pauseAutomation: vi.fn(),
  resumeAutomation: vi.fn(),
  download: vi.fn(),
  getSummary: vi.fn(),
  getReceipts: vi.fn(),
  cancelRenewal: vi.fn(),
  createCheckout: vi.fn(),
  getCheckout: vi.fn(),
  listPlanRequests: vi.fn(),
  createPlanRequest: vi.fn(),
  getDeletion: vi.fn(),
  requestDeletion: vi.fn(),
  restoreAccount: vi.fn(),
  getAppPreferences: vi.fn(),
  saveAppPreferences: vi.fn(),
}));

vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  getAccount: api.getAccount,
  updateAccountProfile: api.updateAccountProfile,
  exportCandidateData: api.exportCandidateData,
  deleteCandidateAccount: api.deleteCandidateAccount,
}));
vi.mock('../../account/accountCapabilityConsentApi', () => ({
  getAccountCapabilityConsents: api.getConsents,
  grantAccountCapabilityConsent: api.grantConsent,
  revokeAccountCapabilityConsent: api.revokeConsent,
}));
vi.mock('../../automation/automationApi', () => ({
  getCandidateAutomation: api.getAutomation,
  pauseCandidateAutomation: api.pauseAutomation,
  resumeCandidateAutomation: api.resumeAutomation,
}));
vi.mock('./appPreferencesApi', () => ({
  getAppPreferences: api.getAppPreferences,
  saveAppPreferences: api.saveAppPreferences,
}));
vi.mock('./accountDeletionApi', () => ({
  getAccountDeletion: api.getDeletion,
  requestAccountDeletion: api.requestDeletion,
  restoreAccount: api.restoreAccount,
}));
vi.mock('../../resume/resumeExport', () => ({ triggerFileDownload: api.download }));
vi.mock('../../shell/candidateBillingApi', () => ({
  getCandidateBillingSummary: api.getSummary,
  getCandidateBillingReceipts: api.getReceipts,
  cancelCandidateBillingRenewal: api.cancelRenewal,
}));
vi.mock('../../tariffs/tariffUpgradeApi', () => ({
  createCandidateCheckout: api.createCheckout,
  getCandidateCheckout: api.getCheckout,
}));
vi.mock('../../shell/planRequestApi', () => ({
  listPlanRequests: api.listPlanRequests,
  createPlanRequest: api.createPlanRequest,
}));

const session: AuthUser = {
  username: 'flagged.test',
  email: 'm.sokolova@mail.test',
  displayName: 'Марина Соколова',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
  features: { cabinetB640: true },
  emailVerified: true,
};

const plans = [
  { id: 'basic', name: 'Basic', amountKopecks: 399000, currency: 'RUB', interval: 'month' },
  { id: 'pro', name: 'Pro', amountKopecks: 990000, currency: 'RUB', interval: 'month' },
  { id: 'max', name: 'Max', amountKopecks: 3990000, currency: 'RUB', interval: 'month' },
];
const paid = {
  currentPlan: 'pro',
  subscription: {
    status: 'active',
    currentPeriodEndsAt: '2026-12-14T12:00:00.000Z',
    nextChargeAt: '2026-12-15T09:00:00.000Z',
    autoRenew: true,
  },
  plans,
};
const free = { currentPlan: 'free', subscription: null, plans };
const receipt = (invoiceId: number, receiptUrl: string | null) => ({
  invoiceId,
  planId: 'pro',
  amountKopecks: 990000,
  currency: 'RUB',
  paidAt: '2026-11-15T09:00:00.000Z',
  paymentMethod: null,
  receiptUrl,
  receiptStatus: null,
  fiscalDocumentNumber: null,
  fiscalDate: null,
});

let view: Mounted | null = null;
const navigate = vi.fn();
const setTheme = vi.fn();
const n = (value: string | null | undefined) => value?.replace(/\s/gu, ' ') ?? null;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(element: ReactElement, search = '', user: AuthUser = session): Promise<HTMLElement> {
  const value = {
    session: user,
    path: '/app/account',
    search,
    match: null,
    consultantRoute: null,
    navigate,
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme,
  };
  view = mount(
    <ShellProvider value={value}>
      {element}
      <ToastHost />
    </ShellProvider>,
  );
  await settle();
  return view.container;
}

const node = (code: string) => nodeByCode(code)!;
const button = (root: Element, text: string) =>
  [...root.querySelectorAll('button, a.btn')].find((item) => item.textContent?.trim() === text) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  api.getAppPreferences.mockResolvedValue({ theme: null, moneyCurrency: null });
  api.saveAppPreferences.mockResolvedValue({ theme: null, moneyCurrency: null });
  api.getAccount.mockResolvedValue({ profile: { timezone: 'Europe/Samara' }, sessions: [] });
  api.getConsents.mockResolvedValue([
    { id: 'c1', capability: 'digital_footprint', versionId: 'v', grantedAt: '2026-11-01', revokedAt: null },
  ]);
  api.getAutomation.mockResolvedValue({ settings: { enabled: true, pausedUntil: null } });
  api.getSummary.mockResolvedValue(paid);
  api.getReceipts.mockResolvedValue({ receipts: [receipt(1, 'https://receipts.example/1')], nextCursor: null });
  api.listPlanRequests.mockResolvedValue([]);
  api.getDeletion.mockResolvedValue(null);
});
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('n05 «Согласия и данные»', () => {
  it('три согласия сервера и удаление аккаунта, как в макете', async () => {
    const root = await open(<DataScreen node={node('n05')} />);
    expect([...root.querySelectorAll('.set-h')].map((item) => item.textContent)).toEqual([
      'На что вы дали согласие',
      'Действия от вашего имени',
      'Ваши данные',
      'Удаление аккаунта',
    ]);
    const switches = [...root.querySelectorAll('input.sw')] as HTMLInputElement[];
    expect(switches.map((item) => [item.getAttribute('aria-label'), item.checked])).toEqual([
      ['Подключённый профиль', false],
      ['Цифровой след', true],
      ['Действия от вашего имени', false],
    ]);
    const remove = root.querySelector('button[aria-label="Удалить аккаунт"]') as HTMLButtonElement;
    expect(remove.textContent).toBe('Удалить');
    expect(remove.className).toBe('btn is-sm is-danger');
    expect(remove.closest('.set-row')?.querySelector('.set-t')?.textContent).toBe('Удалить аккаунт');
    expect(api.deleteCandidateAccount).not.toHaveBeenCalled();
  });

  it('n05b: удаление только после окна, «Оставить» ничего не трогает', async () => {
    api.requestDeletion.mockResolvedValue({
      requestedAt: '2026-11-19T10:00:00.000Z',
      purgeAfter: '2026-12-19T10:00:00.000Z',
    });
    const root = await open(<DataScreen node={node('n05')} />);
    const dialog = () => document.querySelector('.pf-dialog[role=dialog]') as HTMLElement | null;
    click(root.querySelector('button[aria-label="Удалить аккаунт"]'));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Удалить аккаунт?');
    expect([...dialog()!.querySelectorAll('.c5-list li')].map((item) => item.textContent)).toEqual([
      'Профиль, отклики и дневник сотрутся через 30 дней.',
      'Автоотклики и публикации по расписанию остановятся сразу.',
      'До конца этого срока аккаунт можно вернуть.',
    ]);
    click(button(dialog()!, 'Оставить'));
    await settle();
    expect(dialog()).toBeNull();
    expect(api.requestDeletion).not.toHaveBeenCalled();

    click(root.querySelector('button[aria-label="Удалить аккаунт"]'));
    click(button(dialog()!, 'Удалить аккаунт'));
    await settle();
    expect(api.requestDeletion).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    const row = button(root, 'Вернуть аккаунт')!.closest('.set-row')!;
    expect(n(row.querySelector('.set-t')?.textContent)).toBe('Аккаунт удалится 19 декабря');
    expect(root.querySelector('button[aria-label="Удалить аккаунт"]')).toBeNull();
  });

  it('запрошенное удаление видно сразу, «Вернуть аккаунт» его снимает', async () => {
    api.getDeletion.mockResolvedValue({
      requestedAt: '2026-11-19T10:00:00.000Z',
      purgeAfter: '2026-12-19T10:00:00.000Z',
    });
    api.restoreAccount.mockResolvedValue(undefined);
    const root = await open(<DataScreen node={node('n05')} />);
    click(button(root, 'Вернуть аккаунт'));
    await settle();
    expect(api.restoreAccount).toHaveBeenCalledTimes(1);
    expect(button(root, 'Вернуть аккаунт')).toBeNull();
    expect(root.querySelector('button[aria-label="Удалить аккаунт"]')).not.toBeNull();
  });

  it('ошибка удаления остаётся в окне, аккаунт не помечен', async () => {
    api.requestDeletion.mockRejectedValue(new Error('500'));
    const root = await open(<DataScreen node={node('n05')} />);
    click(root.querySelector('button[aria-label="Удалить аккаунт"]'));
    const dialog = document.querySelector('.pf-dialog[role=dialog]') as HTMLElement;
    click(button(dialog, 'Удалить аккаунт'));
    await settle();
    expect(dialog.querySelector('[role=alert]')?.textContent).toBe('Аккаунт не удалён');
    expect(button(root, 'Вернуть аккаунт')).toBeNull();
  });

  it('без ответа об удалении группа не показывается', async () => {
    api.getDeletion.mockRejectedValue(new Error('404'));
    const root = await open(<DataScreen node={node('n05')} />);
    expect(root.textContent).not.toMatch(/Удаление аккаунта/u);
    expect(root.querySelector('.set-h')?.textContent).toBe('На что вы дали согласие');
  });

  it('согласие отзывается переключателем, а даётся только после текста согласия', async () => {
    api.revokeConsent.mockResolvedValue(null);
    api.grantConsent.mockResolvedValue({});
    const root = await open(<DataScreen node={node('n05')} />);
    click(root.querySelector('input[aria-label="Подключённый профиль"]'));
    expect(api.grantConsent).not.toHaveBeenCalled();
    const dialog = view!.container.ownerDocument.querySelector('.pf-dialog[role=dialog]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toBe('Фоновая активность в подключённом профиле');
    expect(dialog.querySelectorAll('.c5-list li').length).toBeGreaterThan(2);
    click(button(dialog, 'Дать согласие'));
    await settle();
    expect(api.grantConsent).toHaveBeenCalledWith('profile_activity', 'profile_activity-v1.0');
  });

  it('отзыв «Цифрового следа» стирает находки: без подтверждения запрос не уходит', async () => {
    api.revokeConsent.mockResolvedValue(null);
    const root = await open(<DataScreen node={node('n05')} />);
    const input = () => root.querySelector('input[aria-label="Цифровой след"]') as HTMLInputElement;
    click(input());
    await settle();
    expect(api.revokeConsent).not.toHaveBeenCalled();
    expect(input().checked).toBe(true);
    const dialog = () => document.querySelector('.pf-dialog[role=dialog]') as HTMLElement | null;
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Отозвать согласие на цифровой след?');
    expect(dialog()?.querySelector('.c5-lead')?.textContent).toBe('Сохранённые находки удалятся.');
    click(button(dialog()!, 'Отмена'));
    await settle();
    expect(dialog()).toBeNull();
    expect(api.revokeConsent).not.toHaveBeenCalled();
    click(input());
    api.getConsents.mockResolvedValue([]);
    click(button(dialog()!, 'Отозвать'));
    await settle();
    expect(api.revokeConsent).toHaveBeenCalledTimes(1);
    expect(api.revokeConsent).toHaveBeenCalledWith('digital_footprint');
    expect(dialog()).toBeNull();
    expect(input().checked).toBe(false);
  });

  it('согласие, отзыв которого ничего не стирает, отзывается переключателем сразу', async () => {
    api.getConsents.mockResolvedValue([
      { id: 'c2', capability: 'actions_on_behalf', versionId: 'v', grantedAt: '2026-11-01', revokedAt: null },
    ]);
    api.revokeConsent.mockResolvedValue(null);
    const root = await open(<DataScreen node={node('n05')} />);
    click(root.querySelector('input[aria-label="Действия от вашего имени"]'));
    await settle();
    expect(api.revokeConsent).toHaveBeenCalledWith('actions_on_behalf');
    expect(document.querySelector('.pf-dialog')).toBeNull();
  });

  it('«Остановить всё» спрашивает подтверждение; после — «Возобновить»', async () => {
    api.pauseAutomation.mockResolvedValue(undefined);
    const root = await open(<DataScreen node={node('n05')} />);
    expect(root.querySelectorAll('.set-group')[1].querySelector('.set-v')?.textContent).toBe('идут');
    click(button(root, 'Остановить всё'));
    expect(api.pauseAutomation).not.toHaveBeenCalled();
    const dialog = document.querySelector('.pf-dialog[role=dialog]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toBe('Остановить всё?');
    api.getAutomation.mockResolvedValue({
      settings: { enabled: true, pausedUntil: new Date(Date.now() + 86_400_000).toISOString() },
    });
    click(button(dialog, 'Остановить всё'));
    await settle();
    expect(api.pauseAutomation).toHaveBeenCalledWith(365);
    expect(root.querySelectorAll('.set-group')[1].querySelector('.set-v')?.textContent).toBe('остановлены');
    expect(button(root, 'Возобновить')).not.toBeNull();
  });

  it('аварийная остановка показана как остановка, снять её здесь нельзя', async () => {
    api.getAutomation.mockResolvedValue({
      settings: { enabled: true, pausedUntil: null },
      schedulerRuntime: { emergencyPaused: true },
    });
    const root = await open(<DataScreen node={node('n05')} />);
    expect(root.querySelectorAll('.set-group')[1].querySelector('.set-v')?.textContent).toBe('остановлены');
    expect(button(root, 'Возобновить')).toBeNull();
    expect(button(root, 'Остановить всё')).toBeNull();
  });

  it('автоотклики выключены — останавливать нечего', async () => {
    api.getAutomation.mockResolvedValue({ settings: { enabled: false, pausedUntil: null } });
    const root = await open(<DataScreen node={node('n05')} />);
    expect(root.querySelectorAll('.set-group')[1].querySelector('.set-v')?.textContent).toBe('выключены');
    expect(button(root, 'Остановить всё')).toBeNull();
  });

  it('выгрузка сохраняет файл; сбой показан на месте', async () => {
    api.exportCandidateData.mockRejectedValueOnce(new Error('сеть'));
    const root = await open(<DataScreen node={node('n05')} />);
    click(button(root, 'Скачать мои данные'));
    await settle();
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe('Выгрузка не получилась');
    api.exportCandidateData.mockResolvedValueOnce({ profile: {} });
    click(button(root, 'Скачать мои данные'));
    await settle();
    expect(api.download).toHaveBeenCalledWith(
      'openqareer-candidate-export.json',
      expect.stringContaining('"profile"'),
      'application/json;charset=utf-8',
    );
    expect(root.querySelector('.res-row')?.textContent).toBe('Файл сохранён');
  });
});

describe('n06 «Приложение»', () => {
  it('тема и часовой пояс; настроек без механики и обновлений в браузере нет', async () => {
    api.updateAccountProfile.mockResolvedValue({});
    const root = await open(<AppScreen node={node('n06')} />);
    const themes = [...root.querySelectorAll('.seg-ctl.sec-seg[aria-label="Тема"] label')];
    expect(themes.map((item) => item.textContent)).toEqual(['Как в системе', 'Светлая', 'Тёмная']);
    click(themes[2].querySelector('input'));
    expect(setTheme).toHaveBeenCalledWith('dark');
    const select = root.querySelector('select.sec-sel') as HTMLSelectElement;
    expect(select.value).toBe('Europe/Samara');
    act(() => {
      select.value = 'Europe/Moscow';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(api.updateAccountProfile).toHaveBeenCalledWith({ timezone: 'Europe/Moscow' });
    expect(api.saveAppPreferences).toHaveBeenCalledWith({ theme: 'dark' });
    expect(root.textContent).not.toMatch(/Язык|Обновлени|строке меню|Запуск при входе/u);
  });

  it('B593: валюта зарплат сохраняется; сбой возвращает прежнюю и показывает строку', async () => {
    api.getAppPreferences.mockResolvedValue({ theme: null, moneyCurrency: 'USD' });
    const root = await open(<AppScreen node={node('n06')} />);
    const group = root.querySelector('[role=radiogroup][aria-label="Валюта зарплат"]') as HTMLElement;
    const options = [...group.querySelectorAll('label')];
    expect(options.map((item) => item.textContent)).toEqual(['₽', '$', '€', 'AED']);
    expect((options[1].querySelector('input') as HTMLInputElement).checked).toBe(true);
    api.saveAppPreferences.mockResolvedValueOnce({ theme: null, moneyCurrency: 'EUR' });
    click(options[2].querySelector('input'));
    await settle();
    expect(api.saveAppPreferences).toHaveBeenLastCalledWith({ moneyCurrency: 'EUR' });
    expect((options[2].querySelector('input') as HTMLInputElement).checked).toBe(true);
    api.saveAppPreferences.mockRejectedValueOnce(new Error('сеть'));
    click(options[0].querySelector('input'));
    await settle();
    expect((options[2].querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(root.querySelector('.set-res.is-err')?.textContent).toContain('Не сохранилось');
  });
});

describe('t03 «Подписка и оплата»', () => {
  it('платный тариф: подписка, автопродление, платежи с чеком, заявка на консультанта', async () => {
    const root = await open(<BillingScreen node={node('t03')} />);
    const rows = [...root.querySelectorAll('.set-row')].map((row) => [
      row.querySelector('.set-t')?.textContent,
      n(row.querySelector('.set-v')?.textContent),
    ]);
    expect(rows).toEqual([
      ['Pro', '9 900 ₽ в месяц · до 14 декабря'],
      ['Автопродление', 'Следующее списание 15 декабря'],
      ['Pro', '15 ноября · 9 900 ₽'],
      ['Живой консультант', '5 000 ₽ в час'],
    ]);
    expect(button(root, 'Сменить тариф')?.getAttribute('href')).toBe('/app/tariffs');
    const check = button(root, 'Чек') as HTMLAnchorElement;
    expect(check.href).toBe('https://receipts.example/1');
    expect(check.rel).toContain('noopener');
    // Карты в данных нет — строки «Карта» нет; работа консультанта не описана.
    expect(root.textContent).not.toMatch(/Карта|Мир ··/u);
  });

  it('автопродление отключается только после подтверждения', async () => {
    api.cancelRenewal.mockResolvedValue({});
    const root = await open(<BillingScreen node={node('t03')} />);
    click(root.querySelector('input[aria-label="Автопродление"]'));
    expect(api.cancelRenewal).not.toHaveBeenCalled();
    const dialog = document.querySelector('.pf-dialog[role=dialog]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toBe('Отключить автопродление?');
    api.getSummary.mockResolvedValue({ ...paid, subscription: { ...paid.subscription, autoRenew: false, nextChargeAt: null } });
    click(button(dialog, 'Отключить'));
    await settle();
    expect(api.cancelRenewal).toHaveBeenCalledTimes(1);
    const input = root.querySelector('input[aria-label="Автопродление"]') as HTMLInputElement;
    expect([input.checked, input.disabled]).toEqual([false, true]);
    expect(root.querySelectorAll('.set-row .set-v')[1].textContent).toBe('Pro действует до 14 декабря');
  });

  it('Free: «Платежей нет» и путь к тарифам; автопродления нет', async () => {
    api.getSummary.mockResolvedValue(free);
    api.getReceipts.mockResolvedValue({ receipts: [], nextCursor: null });
    const root = await open(<BillingScreen node={node('t03')} />);
    expect(n(root.querySelector('.set-row .set-v')?.textContent)).toBe('20 откликов в месяц');
    expect(root.querySelector('input[aria-label="Автопродление"]')).toBeNull();
    expect(root.textContent).toContain('Платежей нет');
    expect(button(root, 'Выбрать тариф')?.getAttribute('href')).toBe('/app/tariffs');
  });

  it('платный тариф без оплаты: строка тарифа говорит об этом, «Выбрать тариф» под платежами нет', async () => {
    api.getSummary.mockResolvedValue({ ...free, currentPlan: 'max' });
    api.getReceipts.mockResolvedValue({ receipts: [], nextCursor: null });
    const root = await open(<BillingScreen node={node('t03')} />);
    expect(n(root.querySelector('.set-row .set-v')?.textContent)).toBe('2 000 откликов в месяц · подключён без оплаты');
    expect(root.textContent).toContain('Платежей нет');
    expect(button(root, 'Выбрать тариф')).toBeNull();
  });

  it('платежи по 20: «Показать ещё» дочитывает; небезопасная ссылка чека не показывается', async () => {
    api.getReceipts
      .mockResolvedValueOnce({ receipts: [receipt(1, 'javascript:alert(1)')], nextCursor: 'next' })
      .mockResolvedValueOnce({ receipts: [receipt(2, null)], nextCursor: null });
    const root = await open(<BillingScreen node={node('t03')} />);
    expect(button(root, 'Чек')).toBeNull();
    click(button(root, 'Показать ещё'));
    await settle();
    expect(api.getReceipts).toHaveBeenLastCalledWith({ cursor: 'next', limit: 20 });
    expect(root.querySelectorAll('.set-group')[1].querySelectorAll('.set-row')).toHaveLength(2);
    expect(button(root, 'Показать ещё')).toBeNull();
  });

  it('заявка на живого консультанта: кнопка сменяется на «Заявка отправлена»', async () => {
    api.createPlanRequest.mockResolvedValue({ planId: 'consultant', createdAt: '2026-11-17' });
    const root = await open(<BillingScreen node={node('t03')} />);
    click(button(root, 'Оставить заявку'));
    await settle();
    expect(api.createPlanRequest).toHaveBeenCalledWith('consultant');
    expect(root.querySelector('.req.is-sent .req-done')?.textContent).toBe('Заявка отправлена');
    expect(button(root, 'Оставить заявку')).toBeNull();
  });
});

describe('t03b «Перейти к оплате»', () => {
  const checkout = (status: string, paymentUrl: string | null) => ({
    invoiceId: 731,
    planId: 'basic',
    amountKopecks: 399000,
    currency: 'RUB',
    status,
    autoRenew: false,
    paymentUrl,
    createdAt: '2026-11-17T10:00:00.000Z',
  });

  it('счёт не создаётся, пока не нажато «Перейти к оплате»; автопродление не включается', async () => {
    api.getSummary.mockResolvedValue(free);
    api.createCheckout.mockResolvedValue(checkout('pending', 'https://auth.robokassa.ru/Merchant/Index?InvoiceID=731'));
    const root = await open(<BillingScreen node={node('t03')} />, '?pay=basic');
    expect(root.querySelector('.lead-title')?.textContent).toBe('Перейти к оплате Basic');
    const pairs = [...root.querySelectorAll('dl.kv > dt')].map((dt) => [dt.textContent, n(dt.nextElementSibling?.textContent)]);
    expect(pairs).toEqual([
      ['Тариф', 'Basic · 100 откликов в месяц'],
      ['Сумма', '3 990 ₽'],
      ['Период', '30 дней от даты оплаты'],
    ]);
    expect(button(root, 'Остаться на Free')?.getAttribute('href')).toBe('/app/tariffs');
    expect(api.createCheckout).not.toHaveBeenCalled();
    click(button(root, 'Перейти к оплате'));
    await settle();
    expect(api.createCheckout).toHaveBeenCalledTimes(1);
    expect(api.createCheckout.mock.calls[0][0]).toMatchObject({ planId: 'basic', autoRenew: false });
    const pay = button(root, 'Открыть страницу оплаты') as HTMLAnchorElement;
    expect(pay.href).toBe('https://auth.robokassa.ru/Merchant/Index?InvoiceID=731');
    expect(pay.target).toBe('_blank');
  });

  it('проверка оплаты: ещё не пришла, банк отклонил, оплачено', async () => {
    api.getSummary.mockResolvedValue(free);
    api.createCheckout.mockResolvedValue(checkout('pending', 'https://auth.robokassa.ru/pay'));
    const root = await open(<BillingScreen node={node('t03')} />, '?pay=basic');
    click(button(root, 'Перейти к оплате'));
    await settle();
    api.getCheckout.mockResolvedValueOnce(checkout('pending', 'https://auth.robokassa.ru/pay'));
    click(button(root, 'Проверить оплату'));
    await settle();
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe('Оплата ещё не пришла');
    api.getCheckout.mockResolvedValueOnce(checkout('paid', null));
    click(button(root, 'Проверить оплату'));
    await settle();
    expect(navigate).toHaveBeenCalledWith('/app/account/billing');
    expect(document.body.textContent).toContain('Basic подключён');
  });

  it('банк отклонил платёж: сообщение на месте, счёт можно создать заново', async () => {
    api.getSummary.mockResolvedValue(free);
    api.createCheckout.mockResolvedValue(checkout('failed', null));
    const root = await open(<BillingScreen node={node('t03')} />, '?pay=basic');
    click(button(root, 'Перейти к оплате'));
    await settle();
    expect(root.querySelector('.c12-alert-t')?.textContent).toBe('Банк отклонил платёж');
    expect(root.querySelector('.c12-alert-s')?.textContent).toBe('Деньги не списаны.');
    // Повтор идёт с новым ключом: на прежний сервер ответил бы отказом.
    click(button(root, 'Перейти к оплате'));
    await settle();
    const [first, second] = api.createCheckout.mock.calls.map((call) => call[0].idempotencyKey);
    expect(second).not.toBe(first);
  });

  it('чужая ссылка оплаты не открывается; без подтверждённой почты оплата закрыта', async () => {
    api.getSummary.mockResolvedValue(free);
    api.createCheckout.mockResolvedValue(checkout('pending', 'https://evil.example/pay'));
    const root = await open(<BillingScreen node={node('t03')} />, '?pay=basic');
    click(button(root, 'Перейти к оплате'));
    await settle();
    expect(root.querySelector('a[href*="evil.example"]')).toBeNull();
    view?.unmount();
    const unverified = await open(<BillingScreen node={node('t03')} />, '?pay=basic', { ...session, emailVerified: false });
    expect((button(unverified, 'Перейти к оплате') as HTMLButtonElement).disabled).toBe(true);
    expect(unverified.querySelector('.set-res.is-err span')?.textContent).toBe('Сначала подтвердите почту');
  });

  it('неизвестный тариф в адресе — обычный экран подписки', async () => {
    const root = await open(<BillingScreen node={node('t03')} />, '?pay=executive');
    expect(root.querySelector('.lead-title')).toBeNull();
    expect(root.querySelector('.set-h')?.textContent).toBe('Подписка');
  });
});

describe('t01 «Тарифы»', () => {
  it('четыре тарифа с квотами; текущий отмечен, главная кнопка — у следующего', async () => {
    api.getSummary.mockResolvedValue(free);
    const root = await open(<TariffsScreen node={node('t01')} />);
    const tiers = [...root.querySelectorAll('.tiers > article.tier')];
    expect(tiers.map((tier) => [tier.getAttribute('data-t'), n(tier.querySelector('.price')?.textContent)])).toEqual([
      ['Free', '0 ₽'],
      ['Basic', '3 990 ₽ в месяц'],
      ['Pro', '9 900 ₽ в месяц'],
      ['Max', '39 900 ₽ в месяц'],
    ]);
    expect(tiers[0].classList.contains('now')).toBe(true);
    expect(tiers[0].querySelector('.tag')?.textContent).toBe('Ваш тариф');
    expect(tiers[1].classList.contains('next')).toBe(true);
    expect(root.querySelectorAll('.btn.is-primary')).toHaveLength(1);
    expect(tiers[1].querySelector('a.btn.is-primary')?.getAttribute('href')).toBe('/app/account/billing?pay=basic');
    expect(tiers[3].querySelector('a.btn')?.getAttribute('href')).toBe('/app/account/billing?pay=max');
    expect(tiers[0].querySelector('a.btn')).toBeNull();
    expect(n(tiers[2].querySelector('li b')?.textContent)).toBe('500 · часть — автоотклики');
    expect((root.querySelector('#tr-Basic') as HTMLInputElement).checked).toBe(true);
    expect(root.textContent).not.toMatch(/Executive|на сутки|под ключ/iu);
  });

  it('у старшего тарифа кнопок покупки нет; заявка на консультанта — только кнопка и цена', async () => {
    api.getSummary.mockResolvedValue({ ...paid, currentPlan: 'max' });
    const root = await open(<TariffsScreen node={node('t01')} />);
    expect(root.querySelectorAll('.tiers a.btn')).toHaveLength(0);
    const card = root.querySelector('.cons-card.cons-slim') as HTMLElement;
    expect(n(card.textContent)).toBe('Живой консультант5 000 ₽ в часОставить заявку');
  });

  it('тарифы не загрузились: строка с «Повторить»', async () => {
    api.getSummary.mockRejectedValueOnce(new Error('сеть'));
    const root = await open(<TariffsScreen node={node('t01')} />);
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe('Тарифы не загрузились');
    api.getSummary.mockResolvedValue(free);
    click(root.querySelector('.set-res.is-err .btn'));
    await settle();
    expect(root.querySelectorAll('article.tier')).toHaveLength(4);
  });
});

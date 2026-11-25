// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';
import type { QuestionnaireState } from '../FormStep';
import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../../../legal/capabilityConsents';

const desktop = vi.hoisted(() => ({
  openAtsForm: vi.fn(),
  readAtsForm: vi.fn(),
  readAtsOptions: vi.fn(),
  nextAtsStep: vi.fn(),
  fillAtsForm: vi.fn(),
  submitAtsForm: vi.fn(),
  readAtsAttempt: vi.fn(),
  closeAtsForm: vi.fn(),
}));
const journal = vi.hoisted(() => ({ record: vi.fn(), result: vi.fn() }));
const consents = vi.hoisted(() => ({
  getAccountCapabilityConsents: vi.fn(),
  grantAccountCapabilityConsent: vi.fn(),
}));
const facts = vi.hoisted(() => ({ loadAtsFacts: vi.fn(), loadAtsResume: vi.fn() }));
vi.mock('./atsDesktop', () => desktop);
vi.mock('./atsConsentJournal', () => ({ serverConsentJournal: journal }));
vi.mock('./atsFacts', () => facts);
vi.mock('../../../account/accountCapabilityConsentApi', () => consents);
vi.mock('../../shell/Link', () => ({
  Link: ({ to, children }: { to: string; children: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}));

const { AtsSendStep } = await import('./AtsSendStep');
const { useAtsApply } = await import('./useAtsApply');
const { questionIdOf } = await import('./atsQuestions');

const HOST = 'jobs.lever.co';
const name = {
  key: 'id:name',
  label: 'Full name',
  kind: 'text',
  role: null,
  required: true,
  options: [],
  accept: null,
  link: null,
} as const;
const receipt = {
  outcome: 'confirmed',
  reason: null,
  host: HOST,
  path: '/thanks',
  pressedAtMs: new Date(2026, 10, 25, 14, 32).getTime(),
  fieldKeys: [],
  invalidKeys: [],
};
const granted = {
  versionId: CAPABILITY_CONSENT_CURRENT_VERSION.actions_on_behalf,
  revokedAt: null,
};
const address = { url: `https://${HOST}/acme/1/apply`, host: HOST };
const approved = {
  applicationId: 'a1',
  documentId: 'd1',
  approvedAt: '2026-11-20T10:00:00.000Z',
  status: 'approved',
  sent: false,
  resume: null,
} as const;
const onSent = vi.fn();
const onManual = vi.fn();
const onAsk = vi.fn();
let draft: Record<string, string> = {};

function Screen() {
  const apply = useAtsApply({
    vacancyId: 'v1',
    address,
    wanted: true,
    employer: 'Acme',
    approved,
    letterText: 'Здравствуйте!',
    questionnaire: { draft, takeAtsForm: async () => true } as unknown as QuestionnaireState,
    onSent,
    onAsk,
    onManual,
  });
  return (
    <AtsSendStep
      apply={apply}
      url={address.url}
      employer="Acme"
      applicationId="a1"
      approvedLabel="одобрено 20.11"
      letterText="Здравствуйте!"
      hasResume
      answered={1}
      onSent={onSent}
      onStep={() => undefined}
    />
  );
}

let view: Mounted | null = null;
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
async function open() {
  view = await mount(<Screen />);
  await settle();
  await settle();
}
async function send() {
  await click(button('Отправить отклик')!);
  await settle();
  await settle();
}

beforeEach(() => {
  vi.resetAllMocks();
  draft = { [questionIdOf(name)]: 'Марина' };
  desktop.readAtsAttempt.mockResolvedValue(null);
  desktop.closeAtsForm.mockResolvedValue(null);
  desktop.openAtsForm.mockResolvedValue({
    state: 'ready',
    adapter: 'lever',
    host: HOST,
    form: { fields: [name], step: 'submit' },
  });
  desktop.fillAtsForm.mockResolvedValue({
    results: { 'id:name': 'set' },
    values: { 'id:name': 'Марина' },
  });
  desktop.submitAtsForm.mockResolvedValue(receipt);
  facts.loadAtsFacts.mockResolvedValue({});
  consents.getAccountCapabilityConsents.mockResolvedValue([granted]);
  onSent.mockResolvedValue(undefined);
});
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('«Отправка» формы работодателя', () => {
  it('одно нажатие — одна отправка, квитанция с местом и временем', async () => {
    await open();
    expect(text()).toContain('Всё одобрено — можно отправлять');
    const press = button('Отправить отклик')!;
    await act(async () => {
      press.click();
      press.click();
    });
    await settle();
    await settle();
    expect(desktop.submitAtsForm).toHaveBeenCalledTimes(1);
    expect(text()).toContain(`Отправлено 25.11, 14:32 · ${HOST}`);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(button('Отправить отклик')).toBeUndefined();
  });

  it('без подтверждения — честный итог, второго нажатия нет', async () => {
    desktop.submitAtsForm.mockResolvedValue({ ...receipt, outcome: 'unconfirmed' });
    await open();
    await send();
    expect(text()).toContain(`${HOST} не подтвердил отклик. Проверьте его на ${HOST}.`);
    expect(button('Отправить отклик')).toBeUndefined();
    expect(onSent).not.toHaveBeenCalled();
    expect(onManual).not.toHaveBeenCalled();
  });

  it('кнопка не нажата: причина на «Отправке», повтор на месте, в очередь не уходит', async () => {
    desktop.submitAtsForm.mockResolvedValue({
      ...receipt,
      outcome: 'not_submitted',
      reason: 'submit_ambiguous',
      pressedAtMs: null,
    });
    await open();
    await send();
    expect(text()).toContain(`кнопка отправки на ${HOST} не сработала`);
    expect(button('Отправить отклик')).toBeDefined();
    expect(onManual).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it('прежнее нажатие без итога: форма не открывается заново', async () => {
    desktop.readAtsAttempt.mockResolvedValue({
      id: 'x',
      vacancyId: 'v1',
      entryUrl: address.url,
      startedAtMs: 1,
      consentIds: [],
      result: null,
    });
    await open();
    expect(text()).toContain('не подтвердил отклик');
    expect(desktop.openAtsForm).not.toHaveBeenCalled();
  });

  it('поручение спрашивают один раз, отклик уходит сразу после согласия', async () => {
    consents.getAccountCapabilityConsents.mockResolvedValueOnce([]);
    await open();
    await send();
    expect(desktop.submitAtsForm).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    const grant = [...dialog.querySelectorAll('button')].find((item) =>
      item.classList.contains('is-primary'),
    )!;
    await click(grant);
    await settle();
    await settle();
    await settle();
    expect(consents.grantAccountCapabilityConsent).toHaveBeenCalledTimes(1);
    expect(desktop.submitAtsForm).toHaveBeenCalledTimes(1);
  });

  it('пропущенный вопрос ведёт в «Анкету»', async () => {
    draft = {};
    await open();
    expect(button('Ответить · 1 вопрос')).toBeDefined();
    expect(button('Отправить отклик')).toBeUndefined();
  });

  it('капча при чтении и чужой адрес уводят в очередь', async () => {
    desktop.openAtsForm.mockRejectedValue('ats_unsupported');
    await open();
    expect(onManual).toHaveBeenCalledWith('other', HOST);
  });

  it('форма не прочитана — «Повторить» читает её снова', async () => {
    desktop.openAtsForm.mockRejectedValueOnce(new Error('offline'));
    await open();
    expect(text()).toContain('Анкета не загрузилась');
    await click(button('Повторить')!);
    await settle();
    await settle();
    expect(text()).not.toContain('Анкета не загрузилась');
    expect(desktop.openAtsForm).toHaveBeenCalledTimes(2);
  });

  it('до нажатия видны работодатель, площадка и каждый ответ', async () => {
    await open();
    expect(text()).toContain('Acme');
    expect(text()).toContain(HOST);
    const row = document.querySelector('details .cb-item')!;
    expect(row.textContent).toBe('Full nameМарина');
    expect(desktop.submitAtsForm).not.toHaveBeenCalled();
  });
});

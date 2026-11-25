import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtsEntry, AtsField, AtsFormReport, AtsReceipt } from './atsFormTypes';
import { questionIdOf } from './atsQuestions';
import { formOf, runAtsForm, type AtsDesktop, type AtsForm, type AtsRunInput } from './atsRun';

const HOST = 'jobs.lever.co';
const field = (key: string, label: string, more: Partial<AtsField> = {}): AtsField => ({
  key,
  label,
  kind: 'text',
  role: null,
  required: true,
  options: [],
  accept: null,
  link: null,
  ...more,
});
const name = field('id:name', 'Full name');
const resume = field('id:resume', 'Resume', { kind: 'file' });
const gdpr = field('id:gdpr', 'I agree to the privacy policy', { kind: 'checkbox' });
const why = field('id:why', 'Why us?');
const report = (
  fields: readonly AtsField[],
  step: 'next' | 'submit' = 'submit',
): AtsFormReport => ({
  state: 'ready',
  adapter: 'lever',
  host: HOST,
  form: { fields, step },
});
const receipt = (more: Partial<AtsReceipt> = {}): AtsReceipt => ({
  outcome: 'confirmed',
  reason: null,
  host: HOST,
  path: '/acme/1/thanks',
  pressedAtMs: 5,
  fieldKeys: [],
  invalidKeys: [],
  ...more,
});

const desktop = {
  fillAtsForm: vi.fn(),
  submitAtsForm: vi.fn(),
  readAtsForm: vi.fn(),
  readAtsOptions: vi.fn(),
  nextAtsStep: vi.fn(),
};
const journal = { record: vi.fn(), result: vi.fn() };
const run = (form: AtsForm, more: Partial<AtsRunInput> = {}) =>
  runAtsForm(
    form,
    {
      vacancyId: 'v1',
      applicationId: 'a1',
      employer: 'Acme',
      letter: 'Здравствуйте!',
      facts: {},
      resume: { name: 'cv.pdf', type: 'application/pdf', base64: 'AA==' },
      draft: { [questionIdOf(name)]: 'Марина', [questionIdOf(why)]: 'Продукт' },
      now: () => new Date(0),
      ...more,
    },
    { desktop: desktop as unknown as AtsDesktop, journal, newId: () => 'id' },
  );
const form = (...fields: AtsField[]) => formOf(report(fields), HOST) as AtsForm;

beforeEach(() => {
  vi.resetAllMocks();
  desktop.fillAtsForm.mockImplementation(async (_: string, entries: readonly AtsEntry[]) => ({
    results: Object.fromEntries(entries.map(({ key }) => [key, 'set'])),
    values: Object.fromEntries(entries.map(({ key, value, file }) => [key, file?.name ?? value])),
  }));
  desktop.submitAtsForm.mockResolvedValue(receipt());
});

describe('отклик формой работодателя', () => {
  it('заполняет поля, ведёт согласие до одного нажатия и отдаёт квитанцию', async () => {
    const order: string[] = [];
    journal.record.mockImplementation(async () => void order.push('consent'));
    desktop.submitAtsForm.mockImplementation(async () => {
      order.push('press');
      return receipt();
    });
    expect(await run(form(name, resume, gdpr))).toEqual({ kind: 'sent', receipt: receipt() });
    expect(order).toEqual(['consent', 'press']);
    expect(desktop.submitAtsForm).toHaveBeenCalledTimes(1);
    expect(desktop.submitAtsForm.mock.calls[0]![1]).toMatchObject({
      'id:name': 'Марина',
      'id:resume': 'cv.pdf',
    });
  });

  it('вопрос без ответа возвращается кандидату, кнопка не нажата', async () => {
    const result = await run(form(name, why), { draft: { [questionIdOf(name)]: 'Марина' } });
    expect(result.kind).toBe('ask');
    expect(desktop.fillAtsForm).not.toHaveBeenCalled();
    expect(desktop.submitAtsForm).not.toHaveBeenCalled();
  });

  it('ответ открыл новый вопрос: страница читается снова, он уходит кандидату', async () => {
    desktop.fillAtsForm.mockResolvedValue({
      results: { 'id:name': 'set' },
      values: { 'id:name': 'Марина', 'id:why': '' },
    });
    desktop.readAtsForm.mockResolvedValue(report([name, why]));
    const result = await run(form(name));
    expect(result).toMatchObject({ kind: 'ask', form: { page: [name, why] } });
    expect(desktop.submitAtsForm).not.toHaveBeenCalled();
  });

  it('список не взял текст: его варианты становятся вопросом', async () => {
    const city = field('id:city', 'City', { kind: 'combobox' });
    const options = [{ value: 'Berlin, Germany', label: 'Berlin, Germany' }];
    desktop.fillAtsForm.mockResolvedValue({ results: { 'id:city': 'no_option' }, values: {} });
    desktop.readAtsOptions.mockResolvedValue(options);
    const result = await run(form(city), { draft: { [questionIdOf(city)]: 'Berlin' } });
    expect(result).toMatchObject({ kind: 'ask', form: { page: [{ key: 'id:city', options }] } });
    expect(desktop.readAtsOptions).toHaveBeenCalledWith('v1', 'id:city', 'Berlin');
  });

  it('нет файла для обязательного резюме — отклик уходит в очередь', async () => {
    expect(await run(form(name, resume), { resume: null })).toEqual({
      kind: 'manual',
      reason: 'other',
      host: HOST,
    });
  });

  it('проходит страницы и отправляет последнюю', async () => {
    desktop.nextAtsStep.mockResolvedValue({
      state: 'moved',
      reason: null,
      invalidKeys: [],
      form: report([why]),
    });
    const first = formOf(report([name], 'next'), HOST) as AtsForm;
    expect((await run(first)).kind).toBe('sent');
    expect(desktop.nextAtsStep).toHaveBeenCalledTimes(1);
    expect(desktop.submitAtsForm).toHaveBeenCalledTimes(1);
  });

  it.each([
    [receipt({ outcome: 'unconfirmed' }), 'unconfirmed'],
    [receipt({ outcome: 'captcha' }), 'unconfirmed'],
    [receipt({ outcome: 'not_submitted', reason: 'already_submitted' }), 'unconfirmed'],
    [receipt({ outcome: 'rejected' }), 'refused'],
    [receipt({ outcome: 'captcha', pressedAtMs: null }), 'manual'],
    [receipt({ outcome: 'not_submitted', reason: 'off_target', pressedAtMs: null }), 'manual'],
    [
      receipt({ outcome: 'not_submitted', reason: 'attempt_unrecorded', pressedAtMs: null }),
      'failed',
    ],
  ])('итог %#: %s', async (answer, kind) => {
    desktop.submitAtsForm.mockResolvedValue(answer);
    expect((await run(form(name))).kind).toBe(kind);
  });

  it('ответ приложения потерян после нажатия — не подтверждено', async () => {
    desktop.submitAtsForm.mockRejectedValue(new Error('lost'));
    expect(await run(form(name))).toEqual({ kind: 'unconfirmed', host: HOST });
  });

  it.each([
    ['captcha', 'captcha'],
    ['account_required', 'account_required'],
    ['form_missing', 'other'],
    ['off_target', 'other'],
  ] as const)('страница %s: причина очереди %s', (state, reason) => {
    expect(formOf({ ...report([]), state }, HOST)).toEqual({ kind: 'manual', reason, host: HOST });
  });
});

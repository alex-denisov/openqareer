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

const LIMITS = { min: 0, max: 50_000, step: 500, unit: '$' };
const pay = field('id:pay', 'Salary, monthly', { kind: 'range', limits: LIMITS });

describe('числовое поле формы', () => {
  const answer = (text: string, more: Partial<AtsField> = {}) =>
    run(form({ ...pay, ...more }, resume), { draft: { [questionIdOf(pay)]: text } });

  it('число в границах уходит числом', async () => {
    expect((await answer('5 000')).kind).toBe('sent');
    expect(desktop.fillAtsForm.mock.calls[0]![1]).toContainEqual({ key: 'id:pay', value: '5000' });
  });

  it.each(['от 5 000 $', '7300', '60000'])('%s: форма не трогается, нажатия нет', async (text) => {
    expect((await answer(text, { required: false })).kind).toBe('ask');
    expect(desktop.fillAtsForm).not.toHaveBeenCalled();
    expect(desktop.submitAtsForm).not.toHaveBeenCalled();
  });

  it('без ответа кандидата ползунок остаётся вопросом, нажатия нет', async () => {
    expect((await answer('')).kind).toBe('ask');
    expect(desktop.fillAtsForm).not.toHaveBeenCalled();
    expect(desktop.submitAtsForm).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'форма держит другое число (required %s): нажатия нет',
    async (required) => {
      desktop.fillAtsForm.mockResolvedValue({
        results: { 'id:pay': 'set', 'id:resume': 'set' },
        values: { 'id:pay': '25000', 'id:resume': 'cv.pdf' },
      });
      expect(await answer('5000', { required })).toMatchObject({
        kind: 'ask',
        rejected: ['id:pay'],
      });
      expect(desktop.submitAtsForm).not.toHaveBeenCalled();
    },
  );
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

  it('страница дорисовала поле резюме: оно заполняется без возврата на «Анкету»', async () => {
    desktop.fillAtsForm.mockResolvedValueOnce({
      results: { 'id:name': 'set' },
      values: { 'id:name': 'Марина', 'id:resume': '' },
    });
    desktop.readAtsForm.mockResolvedValue(report([name, resume]));
    expect((await run(form(name))).kind).toBe('sent');
    expect(desktop.fillAtsForm).toHaveBeenCalledTimes(2);
  });

  it('форма не взяла ответ: возвращается вопрос с отметкой', async () => {
    desktop.fillAtsForm.mockResolvedValue({ results: { 'id:name': 'set' }, values: {} });
    expect(await run(form(name))).toMatchObject({ kind: 'ask', rejected: ['id:name'] });
  });

  it('форма не взяла резюме: причина названа, кнопка не нажата', async () => {
    desktop.fillAtsForm.mockResolvedValue({
      results: { 'id:name': 'set', 'id:resume': 'upload_failed' },
      values: { 'id:name': 'Марина' },
    });
    expect(await run(form(name, resume))).toEqual({ kind: 'failed', rejected: 'resume' });
    expect(desktop.submitAtsForm).not.toHaveBeenCalled();
  });

  it.each(['upload_failed', 'file_not_attached', 'fill_failed'])(
    'необязательное резюме, загрузка упала (%s): нажатия нет',
    async (code) => {
      desktop.fillAtsForm.mockResolvedValue({
        results: { 'id:name': 'set', 'id:resume': code },
        values: { 'id:name': 'Марина' },
      });
      const optional = { ...resume, required: false };
      expect(await run(form(name, optional))).toEqual({ kind: 'failed', rejected: 'resume' });
      expect(desktop.submitAtsForm).not.toHaveBeenCalled();
    },
  );

  it.each(['text', 'textarea'] as const)(
    'письмо не взято полем %s: нажатия нет, даже если оно необязательное',
    async (kind) => {
      const letter = field('id:letter', 'Cover letter', { kind, required: false });
      desktop.fillAtsForm.mockResolvedValue({
        results: { 'id:name': 'set', 'id:letter': 'fill_failed' },
        values: { 'id:name': 'Марина' },
      });
      expect(await run(form(name, letter))).toEqual({ kind: 'failed', rejected: 'letter' });
      expect(desktop.submitAtsForm).not.toHaveBeenCalled();
    },
  );

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
    [receipt({ outcome: 'captcha' }), 'captcha'],
    [receipt({ outcome: 'code' }), 'code'],
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

  it.each(['submit_ambiguous', 'submit_disabled'] as const)(
    'кнопка не нажата (%s): причина названа, отклик остаётся на «Отправке»',
    async (reason) => {
      desktop.submitAtsForm.mockResolvedValue(
        receipt({ outcome: 'not_submitted', reason, pressedAtMs: null }),
      );
      expect(await run(form(name))).toEqual({ kind: 'failed', rejected: 'button' });
    },
  );

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

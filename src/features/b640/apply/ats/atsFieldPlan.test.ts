import { describe, expect, it } from 'vitest';
import { planForm, type CandidateFacts, type PlanContext } from './atsFieldPlan';
import type { AtsField, AtsFormReport, AtsReceipt } from './atsFormTypes';
import { manualCaseAfterSubmit, manualCaseBeforeSubmit } from './atsManualReason';
import { ACTIONS_ON_BEHALF_VERSION, hasActionsMandate } from './atsMandate';

const field = (key: string, label: string, extra: Partial<AtsField> = {}): AtsField => ({
  key,
  label,
  kind: 'text',
  role: null,
  required: true,
  options: [],
  accept: null,
  link: null,
  ...extra,
});
const box = (key: string, label: string, required = true, link: string | null = null): AtsField =>
  field(key, label, { kind: 'checkbox', required, link });

const resume = { name: 'cv.pdf', type: 'application/pdf', base64: 'AAAA' };
const facts: CandidateFacts = {
  firstName: 'Тест',
  lastName: 'Кандидат',
  email: 'candidate@example.com',
  phone: '+10000000000',
  linkedin: 'https://www.linkedin.com/in/example',
  resume,
  answers: {},
};
const context = (mandateAccepted: boolean): PlanContext => ({
  host: 'job-boards.greenhouse.io',
  mandateAccepted,
  now: new Date('2026-11-25T10:00:00.000Z'),
});
const plan = (fields: readonly AtsField[], mandate = true, answers: Record<string, string> = {}) =>
  planForm(fields, { ...facts, answers }, context(mandate));

describe('план заполнения формы работодателя', () => {
  it('ставит известные данные кандидата и файл резюме, остальное обязательное спрашивает', () => {
    const result = plan([
      field('id:first_name', 'First Name'),
      field('id:last_name', 'Last Name'),
      field('id:email', 'Email'),
      field('id:phone', 'Phone', { kind: 'tel' }),
      field('id:resume', 'Resume/CV', { kind: 'file' }),
      field('id:cover_letter', 'Cover Letter', { kind: 'file', required: false }),
      field('id:question_1', 'LinkedIn Profile', { required: false }),
      field('id:question_2', 'What are your salary expectations?'),
      field('id:question_3', 'Anything else?', { required: false }),
    ]);
    expect(result.entries).toEqual([
      { key: 'id:first_name', value: 'Тест' },
      { key: 'id:last_name', value: 'Кандидат' },
      { key: 'id:email', value: 'candidate@example.com' },
      { key: 'id:phone', value: '+10000000000' },
      { key: 'id:resume', value: '', file: resume },
      { key: 'id:question_1', value: 'https://www.linkedin.com/in/example' },
    ]);
    expect(result.questions.map((item) => [item.key, item.reason])).toEqual([
      ['id:question_2', 'no_answer'],
    ]);
  });

  it('согласие на обработку ставит только при принятом поручении и пишет его в журнал', () => {
    const consent = box(
      'id:gdpr',
      'I agree to the Privacy Policy',
      true,
      'https://acme.example/privacy',
    );
    const accepted = plan([consent], true);
    expect(accepted.entries).toEqual([{ key: 'id:gdpr', value: 'true' }]);
    expect(accepted.consents).toEqual([
      {
        key: 'id:gdpr',
        text: 'I agree to the Privacy Policy',
        link: 'https://acme.example/privacy',
        host: 'job-boards.greenhouse.io',
        at: '2026-11-25T10:00:00.000Z',
      },
    ]);
    const without = plan([consent], false);
    expect(without.entries).toEqual([]);
    expect(without.consents).toEqual([]);
    expect(without.questions[0]?.reason).toBe('consent_needs_mandate');
  });

  it('рассылки и хранение на будущее не ставит никогда, даже по ответу; обязательные — вопрос', () => {
    const fields = [
      box('id:news', 'Send me job alerts and marketing emails', false),
      box('id:keep', 'Retain my personal data for future opportunities', false),
      box('id:keep2', 'Keep my application on file for future openings'),
      box('id:ru', 'Согласен на хранение данных для будущих вакансий', false),
    ];
    const result = plan(fields, true, { 'id:news': 'true', 'id:keep': 'true' });
    expect(result.entries).toEqual([]);
    expect(result.consents).toEqual([]);
    expect(result.questions.map((item) => [item.key, item.reason])).toEqual([
      ['id:keep2', 'optional_consent_required'],
    ]);
  });

  it('факты о кандидате берёт только из его ответа, иначе спрашивает', () => {
    const yesNo = [
      { value: '1', label: 'Yes' },
      { value: '0', label: 'No' },
    ];
    const fields = [
      field('id:q1', 'Are you legally authorized to work in the country?', {
        kind: 'combobox',
        options: yesNo,
      }),
      field('id:q2', 'Will you require visa sponsorship?', {
        kind: 'select',
        options: yesNo,
        required: false,
      }),
      box('id:q3', 'I certify that the information is true and accurate'),
      field('id:q4', 'Have you ever been convicted of a crime?', { kind: 'radio', options: yesNo }),
    ];
    expect(plan(fields).entries).toEqual([]);
    expect(plan(fields).questions.map((item) => item.reason)).toEqual(Array(4).fill('fact_needed'));
    const answered = plan(fields, true, { 'id:q1': 'Yes', 'id:q3': 'true' });
    expect(answered.entries).toEqual([
      { key: 'id:q1', value: 'Yes' },
      { key: 'id:q3', value: 'true' },
    ]);
    expect(answered.consents).toEqual([]);
    expect(answered.questions.map((item) => item.key)).toEqual(['id:q2', 'id:q4']);
  });

  it('в демографии выбирает отказ от ответа, а без такого варианта оставляет пустым или спрашивает', () => {
    const decline = [
      { value: '1', label: 'Female' },
      { value: '3', label: 'Prefer not to say' },
    ];
    const noDecline = [{ value: '1', label: 'Yes' }];
    const result = plan([
      field('id:g', 'What gender do you identify as?', {
        kind: 'combobox',
        options: decline,
        required: false,
      }),
      field('id:d', 'Do you identify as a person with a disability?', {
        kind: 'select',
        options: noDecline,
      }),
      field('id:v', 'Veteran status', { kind: 'select', options: noDecline, required: false }),
    ]);
    expect(result.entries).toEqual([{ key: 'id:g', value: 'Prefer not to say' }]);
    expect(result.questions.map((item) => [item.key, item.reason])).toEqual([
      ['id:d', 'demographic'],
    ]);
  });

  it('неузнанную обязательную галочку не ставит, а спрашивает; необязательную не трогает', () => {
    const result = plan([
      box('id:x', 'I accept the Candidate Code'),
      box('id:y', 'Tick if you like', false),
    ]);
    expect(result.entries).toEqual([]);
    expect(result.questions.map((item) => [item.key, item.reason])).toEqual([
      ['id:x', 'unknown_checkbox'],
    ]);
  });
});

describe('поручение и коды причин для очереди', () => {
  it('поручение принято только при действующей редакции', () => {
    expect(ACTIONS_ON_BEHALF_VERSION).toBe('actions_on_behalf-v1.1');
    expect(hasActionsMandate(['terms-v3', 'actions_on_behalf-v1.1'])).toBe(true);
    expect(hasActionsMandate(['actions_on_behalf-v1.0'])).toBe(false);
    expect(hasActionsMandate([])).toBe(false);
  });

  const report = (state: AtsFormReport['state']): AtsFormReport => ({
    state,
    adapter: 'greenhouse',
    host: 'job-boards.greenhouse.io',
    form: {},
  });
  const receipt = (outcome: AtsReceipt['outcome'], invalidKeys: string[] = []): AtsReceipt => ({
    outcome,
    reason: null,
    host: 'boards.greenhouse.io',
    path: '/acme/jobs/1',
    pressedAtMs: 1,
    fieldKeys: [],
    invalidKeys,
  });

  it('до отправки называет причину и отдаёт собранные ответы, файл — именем', () => {
    const ready = plan([
      field('id:first_name', 'First Name'),
      field('id:resume', 'Resume', { kind: 'file' }),
    ]);
    expect(manualCaseBeforeSubmit(report('ready'), ready)).toBeNull();
    expect(manualCaseBeforeSubmit(report('account_required'), null)?.code).toBe('account');
    expect(manualCaseBeforeSubmit(report('captcha'), ready)).toEqual({
      code: 'captcha',
      host: 'job-boards.greenhouse.io',
      prepared: [
        { key: 'id:first_name', value: 'Тест' },
        { key: 'id:resume', value: 'cv.pdf' },
      ],
      fieldKeys: [],
    });
    const asks = plan([field('id:q', 'Salary?')]);
    expect(manualCaseBeforeSubmit(report('ready'), asks)).toMatchObject({
      code: 'unknown_field',
      fieldKeys: ['id:q'],
    });
  });

  it('после нажатия «отправлено» — только подтверждение доски', () => {
    const ready = plan([field('id:first_name', 'First Name')]);
    expect(manualCaseAfterSubmit(receipt('confirmed'), ready)).toBeNull();
    expect(manualCaseAfterSubmit(receipt('unconfirmed'), ready)?.code).toBe('unconfirmed');
    expect(manualCaseAfterSubmit(receipt('captcha'), ready)?.code).toBe('captcha');
    expect(manualCaseAfterSubmit(receipt('rejected', ['id:email']), ready)).toMatchObject({
      code: 'rejected_form',
      fieldKeys: ['id:email'],
    });
  });
});

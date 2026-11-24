import { describe, expect, it, vi } from 'vitest';
import type { AtsConsentJournal } from './atsConsentJournal';
import type { AtsReceipt } from './atsFormTypes';
import { sendAtsForm, settleAtsConsents, type AtsSendInput } from './atsSend';

const input: AtsSendInput = {
  vacancyId: 'v1',
  applicationId: 'a1',
  employer: 'Acme',
  command: 'Отправить',
  values: { 'id:email': 'candidate@example.com' },
  consents: [
    {
      key: 'id:gdpr',
      text: 'I agree to the Privacy Policy',
      link: 'https://acme.example/privacy',
      host: 'job-boards.greenhouse.io',
      at: '2026-11-25T10:00:00.000Z',
    },
  ],
};
const receipt = (outcome: AtsReceipt['outcome'], pressedAtMs: number | null = 1): AtsReceipt => ({
  outcome,
  reason: null,
  host: 'job-boards.greenhouse.io',
  path: '/acme/jobs/1',
  pressedAtMs,
  fieldKeys: [],
  invalidKeys: [],
});

function setup(answer: AtsReceipt | null | Error) {
  const calls: string[] = [];
  const journal = {
    record: vi.fn<AtsConsentJournal['record']>(async () => void calls.push('record')),
    result: vi.fn<AtsConsentJournal['result']>(async (_, result) => void calls.push(result)),
  };
  const submit = vi.fn(async () => {
    calls.push('submit');
    if (answer instanceof Error) throw answer;
    return answer;
  });
  let next = 0;
  const newId = () => `id-${(next += 1)}`;
  return { calls, journal, submit, newId };
}

describe('отправка формы работодателя с журналом согласий', () => {
  it('пишет согласие до нажатия, передаёт приложению номера и дописывает итог', async () => {
    const deps = setup(receipt('confirmed'));
    const result = await sendAtsForm(input, deps);
    expect(result).toEqual({ kind: 'receipt', receipt: receipt('confirmed') });
    expect(deps.calls).toEqual(['record', 'submit', 'sent']);
    expect(deps.journal.record).toHaveBeenCalledWith({
      id: 'id-1',
      applicationId: 'a1',
      host: 'job-boards.greenhouse.io',
      employer: 'Acme',
      checkboxText: 'I agree to the Privacy Policy',
      policyUrl: 'https://acme.example/privacy',
      policySha256: null,
      checkboxLabel: 'I agree to the Privacy Policy',
      command: 'Отправить',
    });
    expect(deps.submit).toHaveBeenCalledWith('v1', input.values, {
      id: 'id-2',
      consentIds: ['id-1'],
    });
  });

  it('не нажимает, если согласие не записалось', async () => {
    const deps = setup(receipt('confirmed'));
    deps.journal.record.mockRejectedValueOnce(new Error('offline'));
    expect(await sendAtsForm(input, deps)).toEqual({ kind: 'consent_unrecorded' });
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.calls).toEqual(['failed']);
  });

  it.each([
    ['rejected', 1, 'failed'],
    ['not_submitted', null, 'failed'],
    ['captcha', null, 'failed'],
    ['captcha', 1, 'unconfirmed'],
    ['unconfirmed', 1, 'unconfirmed'],
  ] as const)('итог %s (нажатие %s) в журнале — %s', async (outcome, pressedAt, expected) => {
    const deps = setup(receipt(outcome, pressedAt));
    await sendAtsForm(input, deps);
    expect(deps.calls.at(-1)).toBe(expected);
  });

  it('потерянный ответ — «не подтверждено», сбой записи итога отклик не меняет', async () => {
    const lost = setup(new Error('ipc'));
    expect(await sendAtsForm(input, lost)).toEqual({ kind: 'unknown' });
    expect(lost.calls.at(-1)).toBe('unconfirmed');
    const deps = setup(receipt('confirmed'));
    deps.journal.result.mockRejectedValue(new Error('offline'));
    expect((await sendAtsForm(input, deps)).kind).toBe('receipt');
  });

  it('после перезапуска дописывает прерванной попытке «не подтверждено»', async () => {
    const { journal } = setup(null);
    const attempt = {
      id: 'id-9',
      vacancyId: 'v1',
      entryUrl: 'https://job-boards.greenhouse.io/acme/jobs/1',
      startedAtMs: 1,
      consentIds: ['id-1'],
      result: null,
    };
    await settleAtsConsents(attempt, journal);
    expect(journal.result).toHaveBeenCalledWith('id-1', 'unconfirmed');
  });
});

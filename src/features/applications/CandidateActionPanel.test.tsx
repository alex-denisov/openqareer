// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateActionPanel } from './CandidateActionPanel';
import * as applicationsApi from './applicationsApi';
import type { ApplicationView, CandidateActionUsageView } from './applicationsApi';
import { CoachApiError } from '../coach/apiClient';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const usage: CandidateActionUsageView = {
  usage: {
    localDate: '2026-10-01',
    hhAppliesCount: 0,
    linkedinEasyAppliesCount: 0,
    hhBoostsCount: 0,
    lastHhBoostAt: null,
  },
  timezone: 'Europe/Moscow',
  resetAt: '2026-10-01T21:00:00.000Z',
  killSwitchActive: false,
  limits: {
    maxHhAppliesPerDay: 15,
    maxLinkedinEasyAppliesPerDay: 10,
    maxHhBoostsPerDay: 3,
    minHhBoostIntervalMinutes: 240,
  },
};

function application(): ApplicationView {
  return {
    id: 'app-1',
    candidateId: 'candidate-1',
    clusterId: 'cluster-1',
    stage: 'saved',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Инженер',
      company: 'Компания',
      url: 'https://hh.ru/vacancy/123',
      source: 'hh',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-01T10:00:00.000Z',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
    nearestInterview: null,
  };
}

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  container = document.createElement('div');
  document.body.append(container);
  vi.spyOn(applicationsApi, 'getCandidateActionUsage').mockResolvedValue(usage);
  vi.spyOn(applicationsApi, 'listCandidateActionReceipts').mockResolvedValue([]);
  vi.spyOn(applicationsApi, 'getActionsOnBehalfConsent').mockResolvedValue({
    granted: true,
    consent: { versionId: 'actions_on_behalf-v1.0' },
  });
  vi.spyOn(applicationsApi, 'grantActionsOnBehalfConsent').mockResolvedValue(undefined);
  vi.spyOn(applicationsApi, 'setCandidateActionKillSwitch').mockResolvedValue(undefined);
  vi.spyOn(applicationsApi, 'executeCandidateActionBatch').mockResolvedValue({
    batchId: '00000000-0000-4000-8000-000000000001',
    status: 'completed',
    receipts: [{
      id: '00000000-0000-4000-8000-000000000002',
      batchId: '00000000-0000-4000-8000-000000000001',
      platform: 'hh',
      actionKind: 'hh_apply',
      status: 'delivered',
      applicationId: 'app-1',
      failureCode: null,
      executedAt: '2026-10-01T12:00:00.000Z',
    }],
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount(applications: readonly ApplicationView[] = [application()]) {
  root = createRoot(container);
  await act(async () => {
    root?.render(<CandidateActionPanel applications={applications} />);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(container.textContent).toContain('Отправка откликов'));
}

function setCheckbox(input: HTMLInputElement | undefined, checked: boolean): void {
  if (input && input.checked !== checked) input.click();
}

function setTextarea(textarea: HTMLTextAreaElement | null, value: string): void {
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CandidateActionPanel', () => {
  it('requires review of the selected vacancy, its letter, and candidate confirmation', async () => {
    await mount();
    const send = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Отправить'));
    expect(send?.disabled).toBe(true);

    const selection = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(selection).not.toBeNull();
    await act(async () => { setCheckbox(selection ?? undefined, true); });
    const letter = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(letter).not.toBeNull();
    await act(async () => { setTextarea(letter, 'Проверенный текст письма'); });

    const confirmation = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .at(-1);
    await act(async () => { setCheckbox(confirmation, true); });
    vi.mocked(applicationsApi.listCandidateActionReceipts).mockResolvedValue([{
      id: '00000000-0000-4000-8000-000000000002',
      batchId: '00000000-0000-4000-8000-000000000001',
      platform: 'hh',
      actionKind: 'hh_apply',
      status: 'delivered',
      applicationId: 'app-1',
      failureCode: null,
      executedAt: '2026-10-01T12:00:00.000Z',
    }]);
    expect(send?.disabled).toBe(false);

    await act(async () => { send?.click(); });
    await vi.waitFor(() => expect(applicationsApi.executeCandidateActionBatch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(container.textContent).toContain('Площадка подтвердила'));
    const request = vi.mocked(applicationsApi.executeCandidateActionBatch).mock.calls[0]?.[0];
    expect(request?.confirmedByCandidate).toBe(true);
    expect(request?.actions[0]).toMatchObject({
      platform: 'hh',
      actionKind: 'hh_apply',
      targetUrl: 'https://hh.ru/vacancy/123',
      letterText: 'Проверенный текст письма',
    });
    expect(container.textContent).toContain('Доставлено');
  });

  it('shows the consent terms and does not claim acceptance while the consent text is disabled', async () => {
    vi.mocked(applicationsApi.getActionsOnBehalfConsent).mockResolvedValue({ granted: false, consent: null });
    await mount();

    expect(container.textContent).toContain('Согласие на действия от вашего имени');
    expect(container.textContent).toContain('Принятие отключено');
    const consentButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Дать согласие'));
    expect(consentButton?.disabled).toBe(true);
    expect(applicationsApi.grantActionsOnBehalfConsent).not.toHaveBeenCalled();
  });

  it('reports the desktop runner boundary without turning a 503 into success', async () => {
    vi.mocked(applicationsApi.executeCandidateActionBatch).mockRejectedValue(
      new CoachApiError('Исполнитель действий не подключён к сессии на этом устройстве. Действия не запускались.', 'runner_not_connected', false),
    );
    await mount();
    const checks = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    await act(async () => { setCheckbox(checks[0], true); });
    const letter = container.querySelector<HTMLTextAreaElement>('textarea');
    await act(async () => { setTextarea(letter, 'Проверенное письмо'); });
    const confirmation = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).at(-1);
    await act(async () => { setCheckbox(confirmation, true); });
    const send = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Отправить'));
    await act(async () => { send?.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('Действия не запускались'));
    expect(container.textContent).not.toContain('Площадка подтвердила');
  });

  it('toggles the kill switch and reflects the saved state', async () => {
    vi.mocked(applicationsApi.getCandidateActionUsage)
      .mockResolvedValueOnce(usage)
      .mockResolvedValue({ ...usage, killSwitchActive: true });
    await mount();
    const stop = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Остановить всё'));
    expect(stop).toBeDefined();
    await act(async () => { stop?.click(); });
    await vi.waitFor(() => expect(applicationsApi.setCandidateActionKillSwitch).toHaveBeenCalledWith(true));
    expect(container.textContent).toContain('Снять остановку');
  });

  it('adds the one-resume boost as a real action in the confirmed package', async () => {
    await mount([]);
    const boost = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(boost).not.toBeNull();
    await act(async () => { setCheckbox(boost ?? undefined, true); });
    const confirmation = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).at(-1);
    await act(async () => { setCheckbox(confirmation, true); });
    const send = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Отправить'));
    expect(send?.disabled).toBe(false);
    await act(async () => { send?.click(); });
    await vi.waitFor(() => expect(applicationsApi.executeCandidateActionBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(applicationsApi.executeCandidateActionBatch).mock.calls[0]?.[0].actions[0]).toMatchObject({
      platform: 'hh',
      actionKind: 'hh_resume_boost',
      targetUrl: 'https://hh.ru/applicant/resumes',
    });
  });
});

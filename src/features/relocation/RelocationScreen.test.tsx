// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import * as relocationApi from './relocationApi';
import { RelocationScreen } from './RelocationScreen';

const notGranted = {
  status: 'not_granted' as const,
  granted: false,
  versionId: null,
  grantedAt: null,
  revokedAt: null,
};

describe('RelocationScreen', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    vi.restoreAllMocks();
  });

  it('keeps personal data entry disabled while the consent text awaits DPO review', async () => {
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile: null,
      consent: notGranted,
      consentTextStatus: 'pending_dpo_review',
      alerts: [],
    });
    const grantConsent = vi.spyOn(relocationApi, 'grantRelocationConsent');
    render();

    await act(async () => Promise.resolve());

    expect(host?.textContent).toContain('Текст согласия ожидает проверки');
    const startButton = [...(host?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('Заполнить анкету'),
    );
    expect(startButton?.disabled).toBe(true);
    expect(grantConsent).not.toHaveBeenCalled();
  });

  it('grants the approved consent only after the candidate ticks it, then opens the workspace', async () => {
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile: null,
      consent: notGranted,
      consentTextStatus: 'approved',
      alerts: [],
    });
    const grantConsent = vi.spyOn(relocationApi, 'grantRelocationConsent').mockResolvedValueOnce({
      consent: {
        ...notGranted,
        status: 'granted',
        granted: true,
        versionId: 'v1',
        grantedAt: '2026-10-19T12:00:00.000Z',
      },
    });
    render();
    await act(async () => Promise.resolve());

    const startButton = () =>
      [...(host?.querySelectorAll('button') ?? [])].find((button) =>
        button.textContent?.includes('Заполнить анкету'),
      );
    expect(host?.textContent).not.toContain('ожидает проверки');
    expect(startButton()?.disabled).toBe(true);

    const checkbox = host?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => checkbox?.click());
    expect(startButton()?.disabled).toBe(false);
    await act(async () => startButton()?.click());

    expect(grantConsent).toHaveBeenCalledTimes(1);
    expect(host?.querySelectorAll('[role="tab"]').length).toBe(4);
  });

  it('exposes the four workspace tabs when consent is active', async () => {
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile: emptyRelocationQuestionnaire(),
      consent: {
        ...notGranted,
        status: 'granted',
        granted: true,
        versionId: 'v1',
        grantedAt: '2026-10-10T12:00:00.000Z',
      },
      consentTextStatus: 'pending_dpo_review',
      alerts: [],
    });
    render();

    await act(async () => Promise.resolve());

    const tabs = [...(host?.querySelectorAll('[role="tab"]') ?? [])];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Страны 17',
      'Сравнение 0',
      'Экономика',
      'Мои данные',
    ]);
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('opens profile data when citizenship is missing', async () => {
    mockGrantedQuestionnaire();
    render();

    await flushLoad();
    await clickButton('Указать в профиле');

    expect(host?.textContent).toContain('Мои данные');
    expect(
      host?.querySelector('#career-relocation-tab-profile')?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('shows citizenship and document-expiration alerts from the profile response', async () => {
    const profile = emptyRelocationQuestionnaire();
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile: {
        ...profile,
        citizenshipDocuments: {
          ...profile.citizenshipDocuments,
          documents: [
            {
              id: 'permit-1',
              kind: 'residence_permit',
              countryCode: 'DE',
              expiresAt: '2026-10-20',
            },
          ],
        },
      },
      consent: {
        ...notGranted,
        status: 'granted',
        granted: true,
        versionId: 'v1',
        grantedAt: '2026-10-10T12:00:00.000Z',
      },
      consentTextStatus: 'pending_dpo_review',
      alerts: [
        { kind: 'citizenship_missing' },
        { kind: 'document_expiring', documentId: 'permit-1', expiresAt: '2026-10-20' },
      ],
    });
    render();

    await flushLoad();
    await clickButton('Мои данные');

    expect(host?.textContent).toContain('Укажите страну гражданства');
    expect(host?.textContent).toContain('Срок действия документа «Вид на жительство» истекает');
    expect(host?.querySelector('[aria-label="Предупреждения профиля"]')).not.toBeNull();
  });

  it('resumes an interrupted questionnaire at its saved step', async () => {
    const profile = { ...emptyRelocationQuestionnaire(), currentStep: 'education' as const };
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile,
      consent: {
        ...notGranted,
        status: 'granted',
        granted: true,
        versionId: 'v1',
        grantedAt: '2026-10-10T12:00:00.000Z',
      },
      consentTextStatus: 'pending_dpo_review',
      alerts: [],
    });
    render();

    await flushLoad();
    await clickButton('Мои данные');
    await clickButton('Продолжить с шага 2');

    expect(host?.textContent).toContain('Шаг 2 из 4: Диплом и опыт');
  });

  it('opens economy for the country selected from its details', async () => {
    mockGrantedQuestionnaire();
    render();

    await flushLoad();
    await clickButton('Германия');
    await clickButton('Посчитать экономику');

    expect(host?.textContent).toContain('Экономика переезда');
    expect(host?.querySelector('select')?.value).toBe('DE');
  });

  function render() {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<RelocationScreen onNavigateBack={vi.fn()} />));
  }

  function mockGrantedQuestionnaire() {
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile: emptyRelocationQuestionnaire(),
      consent: {
        ...notGranted,
        status: 'granted',
        granted: true,
        versionId: 'v1',
        grantedAt: '2026-10-10T12:00:00.000Z',
      },
      consentTextStatus: 'pending_dpo_review',
      alerts: [],
    });
  }

  async function flushLoad() {
    await act(async () => Promise.resolve());
  }

  async function clickButton(label: string) {
    const button = [...(host?.querySelectorAll('button') ?? [])].find((item) =>
      item.textContent?.includes(label),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
  }
});

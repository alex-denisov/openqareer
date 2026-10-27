// @vitest-environment jsdom
import { act, StrictMode } from 'react';
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

  it('grants the approved consent only after the candidate ticks it, then opens the questionnaire', async () => {
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
    expect(host?.textContent).toContain('Условия для переезда');
    expect(host?.textContent).toContain('Шаг 1 из 4');
  });

  it('«Позже» goes back to roles and writes nothing', async () => {
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile: null,
      consent: notGranted,
      consentTextStatus: 'approved',
      alerts: [],
    });
    const grantConsent = vi.spyOn(relocationApi, 'grantRelocationConsent');
    const onBack = vi.fn();
    render(onBack);
    await flushLoad();

    expect(host?.textContent).toContain('Что мы спросим');
    expect(host?.querySelector('[aria-label="Назад к ролям"]')).not.toBeNull();
    await clickButton('Позже');
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(grantConsent).not.toHaveBeenCalled();
  });

  it('does not show an error when an aborted first load is superseded', async () => {
    const granted = { ...notGranted, status: 'granted' as const, granted: true, versionId: 'v1', grantedAt: '2026-10-10T12:00:00.000Z' };
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockImplementation(async (signal) => {
      if (signal?.aborted) throw new TypeError('Failed to fetch');
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw new TypeError('Failed to fetch');
      return { profile: emptyRelocationQuestionnaire(), consent: granted, consentTextStatus: 'approved', alerts: [] };
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<StrictMode><RelocationScreen onNavigateBack={vi.fn()} /></StrictMode>));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));

    expect(host.textContent).not.toContain('Не удалось');
    expect(host.querySelectorAll('[role="tab"]').length).toBe(4);
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
    await clickButton('Указать в анкете');

    expect(host?.textContent).toContain('Шаг 1 из 4');
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

    // Mockup 15: no banner above the page, the warning sits in the document's own row.
    expect(host?.textContent).toContain('До 20.10.2026: срок скоро закончится');
    expect(host?.querySelector('[aria-label="Предупреждения профиля"]')).toBeNull();
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

    expect(host?.textContent).toContain('Шаг 2 из 4: образование и сертификаты');
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

  function render(onNavigateBack: () => void = vi.fn()) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<RelocationScreen onNavigateBack={onNavigateBack} />));
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

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

  it('exposes the four workspace tabs when consent is active', async () => {
    vi.spyOn(relocationApi, 'getRelocationQuestionnaire').mockResolvedValueOnce({
      profile: emptyRelocationQuestionnaire(),
      consent: { ...notGranted, status: 'granted', granted: true, versionId: 'v1', grantedAt: '2026-10-10T12:00:00.000Z' },
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
    expect(host?.querySelector('#career-relocation-tab-profile')?.getAttribute('aria-selected')).toBe('true');
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
      consent: { ...notGranted, status: 'granted', granted: true, versionId: 'v1', grantedAt: '2026-10-10T12:00:00.000Z' },
      consentTextStatus: 'pending_dpo_review',
      alerts: [],
    });
  }

  async function flushLoad() {
    await act(async () => Promise.resolve());
  }

  async function clickButton(label: string) {
    const button = [...(host?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(label));
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
  }
});

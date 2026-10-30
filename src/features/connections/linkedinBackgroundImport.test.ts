import { describe, expect, it, vi } from 'vitest';
import type { SessionInspectionResult, SessionPageResult } from './connectorSession';
import {
  runLinkedInBackgroundImport,
  type LinkedInBackgroundImportDependencies,
  type LinkedInBackgroundState,
} from './linkedinBackgroundImport';

const PROFILE_HTML = `<main><h1>Ada Lovelace</h1><section><h2>Experience</h2>
<p>Lead Engineer at Analytical Engines</p><p>2020 – Present</p></section></main>`;

function page(overrides: Partial<SessionInspectionResult> = {}): SessionInspectionResult {
  return {
    ready: true,
    url: 'https://www.linkedin.com/feed/',
    signedInApplicant: true,
    login: false,
    otp: false,
    captcha: false,
    ...overrides,
  };
}

const LOGIN_PAGE = page({
  url: 'https://www.linkedin.com/login',
  signedInApplicant: false,
  login: true,
});

function profileRead(url: string): Promise<SessionPageResult> {
  if (url === 'https://www.linkedin.com/in/me/') {
    return Promise.resolve({
      ok: true,
      url: 'https://www.linkedin.com/in/ada/',
      body: PROFILE_HTML,
    });
  }
  return Promise.resolve({ ok: false });
}

function harness(
  inspections: SessionInspectionResult[],
  overrides: Partial<LinkedInBackgroundImportDependencies> = {},
) {
  const states: LinkedInBackgroundState[] = [];
  const calls: string[] = [];
  let index = 0;
  let clock = 0;
  const dependencies: LinkedInBackgroundImportDependencies = {
    prepareRoute: async () => {
      calls.push('route');
      return { release: async () => void calls.push('release') };
    },
    isWindowOpen: async () => calls.includes('open') && !calls.includes('close'),
    openOutOfSight: async () => {
      calls.push('open');
      return true;
    },
    reveal: async () => void calls.push('reveal'),
    park: async () => void calls.push('park'),
    close: async () => void calls.push('close'),
    inspectCurrentPage: async () => inspections[Math.min(index++, inspections.length - 1)],
    readSessionPage: profileRead,
    detailReadThrottle: { lastReadAt: () => Date.now(), markRead: () => undefined },
    persist: async () => 'Из LinkedIn сохранено 3 факта.',
    onState: (state) => states.push(state),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    ...overrides,
  };
  return { dependencies, states, calls };
}

describe('runLinkedInBackgroundImport', () => {
  it('imports a signed-in profile without ever showing the window', async () => {
    const { dependencies, states, calls } = harness([page()]);
    const outcome = await runLinkedInBackgroundImport(dependencies);
    expect(outcome).toEqual({ phase: 'done', message: 'Из LinkedIn сохранено 3 факта.' });
    expect(calls).not.toContain('reveal');
    expect(calls[0]).toBe('route');
    expect(calls).toContain('open');
    expect(calls.slice(-2)).toEqual(['close', 'release']);
    expect(states.map((state) => state.phase)).toEqual(['opening', 'reading', 'saving', 'done']);
  });

  it('shows the window only when LinkedIn asks a person to sign in, then parks it', async () => {
    const { dependencies, states, calls } = harness([LOGIN_PAGE, LOGIN_PAGE, page()]);
    const outcome = await runLinkedInBackgroundImport(dependencies);
    expect(outcome.phase).toBe('done');
    expect(calls.filter((call) => call === 'reveal')).toHaveLength(1);
    expect(calls.indexOf('park')).toBeGreaterThan(calls.indexOf('reveal'));
    expect(states).toContainEqual({
      phase: 'needs_person',
      message: 'Ждём, пока вы войдёте в LinkedIn в открывшемся окне.',
    });
  });

  it('shows the window for a captcha', async () => {
    const captcha = page({ signedInApplicant: false, captcha: true });
    const { dependencies, calls } = harness([captcha, page()]);
    await runLinkedInBackgroundImport(dependencies);
    expect(calls).toContain('reveal');
  });

  it('keeps the window hidden while the page is still loading', async () => {
    const loading = page({ ready: false, signedInApplicant: false });
    const { dependencies, calls } = harness([loading, loading, page()]);
    await runLinkedInBackgroundImport(dependencies);
    expect(calls).not.toContain('reveal');
  });

  it('shows the window when the page never settles on its own', async () => {
    const loading = page({ ready: false, signedInApplicant: false });
    const { dependencies, calls } = harness([loading]);
    const run = runLinkedInBackgroundImport({
      ...dependencies,
      isWindowOpen: async () => calls.includes('open') && !calls.includes('reveal'),
    });
    await expect(run).resolves.toEqual({
      phase: 'failed',
      message: 'Окно LinkedIn закрыто, импорт не завершён. Профиль не изменился.',
    });
    expect(calls).toContain('reveal');
  });

  it('fails without a window when the route cannot be raised', async () => {
    const { dependencies, calls } = harness([page()], {
      prepareRoute: async () => {
        throw new Error('tunnel_down');
      },
    });
    const outcome = await runLinkedInBackgroundImport(dependencies);
    expect(outcome.phase).toBe('failed');
    expect(calls).not.toContain('open');
  });

  it('reports a failed capture after sign-in once and closes the window', async () => {
    const { dependencies, calls } = harness([page()], {
      readSessionPage: async () => ({ ok: false }),
      waitBeforeRetry: async () => undefined,
    });
    const outcome = await runLinkedInBackgroundImport(dependencies);
    expect(outcome).toEqual({
      phase: 'failed',
      message:
        'Вход в LinkedIn выполнен, но получить данные профиля не удалось. Повторите импорт или загрузите PDF-экспорт.',
    });
    expect(calls.slice(-2)).toEqual(['close', 'release']);
  });

  it('says the profile was read but not saved when the save fails', async () => {
    const { dependencies } = harness([page()], {
      persist: async () => {
        throw new Error('server_down');
      },
    });
    const outcome = await runLinkedInBackgroundImport(dependencies);
    expect(outcome).toEqual({
      phase: 'failed',
      message: 'Профиль LinkedIn прочитан, но сохранить его не удалось. Повторите импорт.',
    });
  });

  it('waits for another LinkedIn read to free the window before opening it', async () => {
    let open = 2;
    const { dependencies, calls } = harness([page()], {
      isWindowOpen: async () => {
        if (!calls.includes('open')) return open-- > 0;
        return true;
      },
    });
    const outcome = await runLinkedInBackgroundImport(dependencies);
    expect(outcome.phase).toBe('done');
  });

  it('gives up when the window stays busy', async () => {
    const { dependencies, calls } = harness([page()], { isWindowOpen: async () => true });
    const outcome = await runLinkedInBackgroundImport(dependencies);
    expect(outcome).toEqual({
      phase: 'failed',
      message: 'LinkedIn сейчас занят другим чтением. Повторите импорт через несколько минут.',
    });
    expect(calls).not.toContain('open');
  });

  it('reports detail progress through the flow', async () => {
    const onDetailProgress = vi.fn();
    const { dependencies } = harness([page()], {
      detailReadThrottle: { lastReadAt: () => undefined, markRead: () => undefined },
      pauseBetweenDetailReads: async () => undefined,
      onDetailProgress,
    });
    await runLinkedInBackgroundImport(dependencies);
    expect(onDetailProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }));
    expect(onDetailProgress).toHaveBeenCalledWith({ type: 'end' });
  });
});

// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openExternalLinkModule from '../../services/desktop/openExternalLink';
import * as apiClient from '../coach/apiClient';
import { VacancyInfoModal } from './VacancyInfoModal';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

function cluster(
  overrides: Partial<MatchedVacancyItem['cluster']> = {},
): MatchedVacancyItem['cluster'] {
  return {
    id: 'c-1',
    canonicalTitle: 'Senior Product Designer',
    canonicalCompany: 'Acme',
    canonicalLocation: 'Berlin',
    isRemote: true,
    salary: { from: 100000, to: 140000, currency: '€' },
    descriptionSummary: 'Full description text about the role.',
    skills: ['Figma', 'Research'],
    primaryUrl: 'https://boards.example/1',
    sources: [
      {
        sourceType: 'linkedin',
        sourceId: 'linkedin',
        sourceUrl: 'https://boards.example/1',
        observedAt: '2026-09-24T08:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-24T08:00:00.000Z',
    lastSeenAt: '2026-09-24T08:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
    ...overrides,
  };
}

describe('VacancyInfoModal (B266)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    act(() => {
      root.render(<VacancyInfoModal isOpen={false} onClose={vi.fn()} cluster={cluster()} />);
    });
    expect(document.body.textContent).toBe('');
  });

  it('falls back to the card summary and skills when the full text is unavailable', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockRejectedValue(new Error('offline'));
    await act(async () => {
      root.render(<VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster()} />);
    });
    expect(document.body.textContent).toContain('Full description text about the role.');
    expect(document.body.textContent).toContain('Figma');
  });

  it('shows a fallback instead of nothing when no text exists anywhere', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockRejectedValue(new Error('offline'));
    await act(async () => {
      root.render(
        <VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster({ descriptionSummary: '' })} />,
      );
    });
    expect(document.body.textContent).toContain('Площадка не отдала текст вакансии');
  });

  it('opens the source link through the shared external-link utility, not a dead anchor', () => {
    const spy = vi.spyOn(openExternalLinkModule, 'openExternalLink').mockResolvedValue(true);
    act(() => {
      root.render(<VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster()} />);
    });
    const button = Array.from(document.body.querySelectorAll('button')).find(
      (el) => el.textContent === 'Открыть на площадке',
    );
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(spy).toHaveBeenCalledWith('https://boards.example/1');
  });
});

describe('VacancyInfoModal full text (B266)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the full description from the server, not the empty list summary', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response('{}'));
    vi.spyOn(apiClient, 'readData').mockResolvedValue({
      id: 'c-1',
      description: 'Lead 250 engineers across three regions.\nOwn the P&L.',
      skills: ['Cloud'],
      responsibilities: [],
    } as never);
    await act(async () => {
      root.render(
        <VacancyInfoModal
          isOpen
          onClose={vi.fn()}
          cluster={cluster({ descriptionSummary: '', skills: [] })}
        />,
      );
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/candidate/vacancies/c-1/detail');
    expect(document.body.textContent).toContain('Lead 250 engineers across three regions.');
    expect(document.body.textContent).toContain('Own the P&L.');
    expect(document.body.textContent).toContain('Cloud');
  });
});

describe('VacancyInfoModal recruiter contacts (B266)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('offers the full «Кто нанимает» search inside the modal', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockRejectedValue(new Error('offline'));
    await act(async () => {
      root.render(<VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster()} />);
    });
    expect(document.body.textContent).toContain('Кто нанимает');
    expect(document.body.textContent).toContain('Рекрутер');
  });

  it('tells the candidate why nothing came back instead of spinning forever', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.includes('enrich-contacts')) {
        return Promise.reject(new Error('recruiter search failed'));
      }
      return Promise.reject(new Error('offline'));
    });
    await act(async () => {
      root.render(<VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster()} />);
    });
    const trigger = Array.from(document.body.querySelectorAll('button')).find(
      (el) => el.textContent === 'Рекрутер',
    );
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('recruiter search failed');
    expect(document.querySelector('.career-recruiter-loading')).toBeNull();
  });
});

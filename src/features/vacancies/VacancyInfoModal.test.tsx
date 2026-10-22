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
  });

  it('says the text is only the beginning when the server marks it truncated (B266)', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'c',
            description: 'Lead the platform…',
            truncated: true,
            skills: [],
            responsibilities: [],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await act(async () => {
      root.render(<VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster()} />);
    });
    expect(document.body.textContent).toContain('Lead the platform…');
    expect(document.body.textContent).toContain('Площадка отдала только начало описания');
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
  });

  it('renders stored paragraph and list markers as safe semantic elements', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response('{}'));
    vi.spyOn(apiClient, 'readData').mockResolvedValue({
      id: 'c-1',
      description: 'О роли\n\n- Руководить командой\n- Развивать платформу\n\nУсловия обсуждаются.',
      skills: [],
      responsibilities: [],
    } as never);
    await act(async () => {
      root.render(<VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster()} />);
    });
    expect(document.querySelectorAll('.vacancies-info-description p')).toHaveLength(2);
    expect(document.querySelectorAll('.vacancies-info-description ul li')).toHaveLength(2);
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

  it('matches mockup 4: subtitle, sections and a two-button footer, no recruiter block (B549)', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response('{}'));
    vi.spyOn(apiClient, 'readData').mockResolvedValue({
      id: 'c-1',
      description:
        'Команда платежей.\n\nОбязанности:\n- Развитие платформы\n\nТребования:\n- Kafka',
      skills: [],
      responsibilities: [],
    } as never);
    const onClose = vi.fn();
    await act(async () => {
      root.render(<VacancyInfoModal isOpen onClose={onClose} cluster={cluster()} />);
    });
    const body = document.body.textContent ?? '';
    expect(body).toContain('Acme · linkedin, 24.09 · полный текст вакансии');
    const headings = Array.from(document.querySelectorAll('.vacancies-info-description h4')).map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(['Чем предстоит заниматься', 'Что мы ждём']);
    expect(body).not.toContain('Кто нанимает');
    expect(body).not.toContain('Сопроводительное письмо');
    const footer = document.querySelector('.vacancies-info-footer');
    const labels = Array.from(footer?.querySelectorAll('button') ?? []).map((b) => b.textContent);
    expect(labels).toEqual(['Открыть на площадке', 'Закрыть']);
    act(() => {
      (footer?.querySelectorAll('button')[1] as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('decodes entities and dates the subtitle like the row (G5 M2/M3)', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response('{}'));
    vi.spyOn(apiClient, 'readData').mockResolvedValue({
      id: 'c-1',
      description: 'Oregon Tilth&rsquo;s R&amp;D team.',
      skills: [],
      responsibilities: [],
    } as never);
    await act(async () => {
      root.render(
        <VacancyInfoModal
          isOpen
          onClose={vi.fn()}
          cluster={cluster({
            firstObservedAt: '2026-10-15T08:00:00.000Z',
            sources: [
              {
                sourceType: 'indeed',
                sourceId: 'indeed',
                sourceUrl: 'https://boards.example/1',
                observedAt: '2026-10-20T08:00:00.000Z',
              },
            ],
          })}
        />,
      );
    });
    const body = document.body.textContent ?? '';
    expect(body).toContain('20.10 · полный текст вакансии');
    expect(body).not.toContain('15.10');
    expect(body).toContain('Oregon Tilth’s R&D team.');
  });
});

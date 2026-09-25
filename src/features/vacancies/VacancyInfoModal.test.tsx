// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openExternalLinkModule from '../../services/desktop/openExternalLink';
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

  it('shows the full description and skills when open', () => {
    act(() => {
      root.render(<VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster()} />);
    });
    expect(document.body.textContent).toContain('Full description text about the role.');
    expect(document.body.textContent).toContain('Figma');
  });

  it('shows a fallback instead of nothing when the description is missing', () => {
    act(() => {
      root.render(
        <VacancyInfoModal isOpen onClose={vi.fn()} cluster={cluster({ descriptionSummary: '' })} />,
      );
    });
    expect(document.body.textContent).toContain('Полное описание не сохранено');
  });

  it('opens the source link through the shared external-link utility, not a dead anchor', () => {
    const spy = vi.spyOn(openExternalLinkModule, 'openExternalLink').mockResolvedValue();
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

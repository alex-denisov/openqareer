// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileTopcard } from './ProfileTopcard';
import type { ResumeDraft } from './resumeTypes';
import type { CandidateConnection } from '../coach/coachApi';

const draft: ResumeDraft = {
  candidate: { fullName: 'Jordan Rivers', contact: { email: 'jordan@example.com' } },
  experience: [
    {
      id: 'e1',
      chronologyMemoryId: 'm1',
      title: 'PM',
      employer: 'Acme',
      current: true,
      bulletMemoryIds: [],
    },
  ],
  skills: [{ id: 's1', name: 'SQL' }],
  education: [],
  languages: [],
  courses: [],
};

const connections: CandidateConnection[] = [
  {
    platform: 'hh',
    available: true,
    capabilities: ['resume_read'],
    importsCareerHistory: true,
    status: 'connected',
    accessMode: 'native_session_snapshot',
    connectedAt: '2026-01-01T00:00:00Z',
    lastImportedAt: '2026-01-01T00:00:00Z',
    factCount: 3,
  },
  {
    platform: 'linkedin',
    available: true,
    capabilities: ['profile_read'],
    importsCareerHistory: true,
    status: 'disconnected',
  },
];

describe('ProfileTopcard — source and connection status (C54)', () => {
  it('folds the source coverage into a single-line chip, not a separate card', () => {
    const html = renderToStaticMarkup(
      <ProfileTopcard draft={draft} onDraftChange={() => {}} reader={null} />,
    );
    expect(html).toContain('career-profile-screen-source-chip');
    expect(html).not.toContain('career-profile-screen-rail-card');
  });

  it('places the reader method beside the source chip and makes no claim for legacy profiles', () => {
    const modelHtml = renderToStaticMarkup(
      <ProfileTopcard
        draft={draft}
        onDraftChange={() => {}}
        reader={{
          method: 'model',
          model: 'openai:gpt-5.6-mini',
          promptRevision: 'resume-structuring-v1',
          readAt: '2026-09-26T10:00:00.000Z',
        }}
      />,
    );
    const rulesHtml = renderToStaticMarkup(
      <ProfileTopcard
        draft={draft}
        onDraftChange={() => {}}
        reader={{
          method: 'rules',
          model: null,
          promptRevision: null,
          readAt: '2026-09-26T10:00:00.000Z',
        }}
      />,
    );
    const legacyHtml = renderToStaticMarkup(
      <ProfileTopcard draft={draft} onDraftChange={() => {}} reader={null} />,
    );

    expect(modelHtml).toContain('Прочитано моделью');
    expect(rulesHtml).toContain('Прочитано правилами');
    expect(legacyHtml).not.toContain('Прочитано');
    expect(legacyHtml).not.toContain('Резюме прочитано: неизвестно');
    expect(modelHtml.indexOf('Прочитано моделью')).toBeGreaterThan(
      modelHtml.indexOf('career-profile-screen-source-chip'),
    );
  });

  it('shows hh.ru and LinkedIn connection status chips using the shared status labels', () => {
    const html = renderToStaticMarkup(
      <ProfileTopcard
        draft={draft}
        onDraftChange={() => {}}
        reader={null}
        connections={connections}
        onOpenConnections={() => {}}
      />,
    );
    expect(html).toContain('hh.ru');
    expect(html).toContain('3 факта · 01.01');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('Не подключено');
  });

  it('renders the 64px avatar size, not the old 96px one', () => {
    const html = renderToStaticMarkup(
      <ProfileTopcard
        draft={{ ...draft, candidate: { ...draft.candidate, photoMediaId: undefined } }}
        onDraftChange={() => {}}
        reader={null}
      />,
    );
    expect(html).not.toContain('width="96"');
  });

  it('shows no connection chips when there is nowhere to open connections', () => {
    const html = renderToStaticMarkup(
      <ProfileTopcard
        draft={draft}
        onDraftChange={() => {}}
        reader={null}
        connections={connections}
      />,
    );
    expect(html).not.toContain('career-profile-screen-connection-chip');
  });

  it('keeps the search-consent banner out of the profile topcard per mockup 2', () => {
    const html = renderToStaticMarkup(
      <ProfileTopcard draft={draft} onDraftChange={() => {}} reader={null} />,
    );
    expect(html).not.toContain('career-profile-screen-search-consent');
    expect(html).not.toContain('Вы в поиске');
  });

  describe('ProfileTopcard mobile details collapse (C74)', () => {
    const detailedDraft: ResumeDraft = {
      ...draft,
      candidate: {
        ...draft.candidate,
        headline: 'VP of Engineering',
        contact: {
          email: 'jordan@example.com',
          location: 'Берлин, Германия',
          phone: '+49 123 456789',
        },
      },
    };

    it('renders a «Подробнее» toggle when topcard has extra details and details are collapsed initially', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <ProfileTopcard
            draft={detailedDraft}
            updatedAt="2026-09-21T09:00:00.000Z"
            onDraftChange={() => {}}
            reader={null}
          />,
        );
      });

      const toggle = container.querySelector(
        '.career-profile-screen-details-toggle',
      ) as HTMLButtonElement;
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent).toContain('Подробнее');

      const details = container.querySelector('.career-profile-screen-details') as HTMLElement;
      expect(details).not.toBeNull();
      expect(details.classList.contains('is-open')).toBe(false);

      act(() => root.unmount());
      container.remove();
    });

    it('toggles details open and closed when clicking «Подробнее»', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <ProfileTopcard
            draft={detailedDraft}
            updatedAt="2026-09-21T09:00:00.000Z"
            onDraftChange={() => {}}
            reader={null}
          />,
        );
      });

      const toggle = container.querySelector(
        '.career-profile-screen-details-toggle',
      ) as HTMLButtonElement;
      const details = container.querySelector('.career-profile-screen-details') as HTMLElement;

      act(() => {
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.textContent).toContain('Скрыть');
      expect(details.classList.contains('is-open')).toBe(true);

      act(() => {
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent).toContain('Подробнее');
      expect(details.classList.contains('is-open')).toBe(false);

      act(() => root.unmount());
      container.remove();
    });
  });
});

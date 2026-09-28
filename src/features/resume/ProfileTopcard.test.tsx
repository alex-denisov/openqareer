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
    expect(html).toContain('Подключено');
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
});

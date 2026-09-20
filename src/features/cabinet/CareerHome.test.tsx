import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CareerHome } from './CareerHome';
import type { CandidateSnapshot } from '../coach/coachApi';
import { buildCanonicalProfileJourney } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import type { AuthUser } from '../coach/coachApi';
import type { CareerCabinetView } from './cabinetViews';

const session: AuthUser = {
  username: 'test.candidate',
  email: 'test@example.com',
  displayName: 'Тестовый Кандидат',
  role: 'candidate',
  isTest: false,
  candidateId: 'cand-1',
};

const workspace: CandidateWorkspace = {
  version: 7,
  createdAt: '2026-08-18T12:00:00.000Z',
  updatedAt: '2026-08-18T12:00:00.000Z',
  resumeText: 'Senior Software Engineer with 8+ years experience in TypeScript, React, Node.js.',
  resumeSource: 'text',
  targetDirection: 'Руководитель продукта',
  regions: ['ru'],
  currentSituation: 'Ищу работу ведущим инженером.',
  constraints: 'Remote',
  urgency: 'active',
  outcomes: [],
};

function createTestJourney() {
  return buildCanonicalProfileJourney(
    undefined,
    [
      {
        id: 'confirmed-result',
        statement: 'Запустил продукт и сократил срок релиза на 30 процентов.',
        kind: 'fact',
        domain: 'outcome',
        status: 'confirmed',
        sourceMessageIds: ['message-1'],
      },
    ],
    'Руководитель продукта',
    '2026-08-14T00:00:00.000Z',
  );
}

describe('CareerHome HomeRail integration (B103, B105)', () => {
  it('renders NextAction and AtsReadability in HomeRail when journey is provided', () => {
    const journey = createTestJourney();
    const onNavigate = vi.fn();

    const html = renderToStaticMarkup(
      <CareerHome
        session={session}
        workspace={workspace}
        targetDirection="Руководитель продукта"
        journey={journey}
        loading={false}
        onRefresh={vi.fn(async () => undefined)}
        onNavigate={onNavigate}
        onUpdateWorkspace={vi.fn()}
        onOpenAccount={vi.fn()}
        onOpenExpert={vi.fn()}
      />,
    );

    expect(html).toContain('career-next-action-card');
    expect(html).toContain('Следующее действие');
    expect(html).toContain('career-ats-card');
    expect(html).toContain('ATS-читаемость');
    expect(html).toContain('Оценка профиля');
  });

  it('calls onNavigate with reasoned destination when clicking next action button', () => {
    const journey = createTestJourney();
    const onNavigate = vi.fn();

    const homeElement = CareerHome({
      session,
      workspace,
      targetDirection: 'Руководитель продукта',
      journey,
      loading: false,
      onRefresh: vi.fn(async () => undefined),
      onNavigate,
      onUpdateWorkspace: vi.fn(),
      onOpenAccount: vi.fn(),
      onOpenExpert: vi.fn(),
    });

    const homeChildren = homeElement.props.children as ReactElement[];
    const railElement = homeChildren[1];
    expect(railElement).toBeDefined();

    const railTree = (railElement.type as (props: unknown) => ReactElement)(railElement.props);
    const railChildren = railTree.props.children as ReactElement[];

    const nextActionNode = railChildren.find(
      (child) =>
        Boolean(child) &&
        typeof child.type === 'function' &&
        child.type.name === 'NextAction',
    );
    expect(nextActionNode).toBeDefined();

    const nextActionTree = (nextActionNode!.type as (props: unknown) => ReactElement)(
      nextActionNode!.props,
    );
    const actionChildren = nextActionTree.props.children as ReactElement[];
    const actionButton = actionChildren.find((child) => child?.type === 'button');
    expect(actionButton).toBeDefined();

    actionButton!.props.onClick();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const destination = onNavigate.mock.calls[0][0] as CareerCabinetView;
    expect(['today', 'profile', 'career', 'opportunities']).toContain(destination);
  });

  it('renders gracefully when journey is undefined', () => {
    const html = renderToStaticMarkup(
      <CareerHome
        session={session}
        workspace={workspace}
        targetDirection="Руководитель продукта"
        loading={false}
        onRefresh={vi.fn(async () => undefined)}
        onNavigate={vi.fn()}
        onUpdateWorkspace={vi.fn()}
        onOpenAccount={vi.fn()}
        onOpenExpert={vi.fn()}
      />,
    );

    expect(html).toContain('career-next-action-card');
    expect(html).toContain('Следующее действие');
    expect(html).toContain('career-ats-card');
    expect(html).toContain('ATS-читаемость');
  });

  // B233: служебный идентификатор метода «profile-assessment-resume-v2» стоял
  // в подписи кандидату (аудит 2026-09-20, находка 10).
  it('names the assessment method without a service identifier (B233)', () => {
    const snapshot = {
      candidate: { id: 'c1', dataClass: 'synthetic', locale: 'ru-RU', createdAt: '2026-09-01T00:00:00.000Z' },
      messages: [],
      memory: [],
      turns: [],
      dossier: { sections: [], confirmedCount: 0, proposedCount: 0, readiness: { complete: false, unresolvedQuestions: 0, checks: [] } },
      assessments: [],
      germanyMarket: null,
      resume: {
        draft: {
          candidate: { fullName: 'Тест' },
          targetRole: 'Руководитель продукта',
          experience: [
            { id: 'e1', chronologyMemoryId: 'm1', title: 'PM', employer: 'X', current: true, bulletMemoryIds: [] },
          ],
          skills: [],
          education: [],
          languages: [],
        },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      documents: [],
      vacancySubscriptions: [],
    } as unknown as CandidateSnapshot;
    const html = renderToStaticMarkup(
      <CareerHome
        session={session}
        snapshot={snapshot}
        workspace={workspace}
        targetDirection="Руководитель продукта"
        journey={createTestJourney()}
        loading={false}
        onRefresh={vi.fn(async () => undefined)}
        onNavigate={vi.fn()}
        onUpdateWorkspace={vi.fn()}
        onOpenAccount={vi.fn()}
        onOpenExpert={vi.fn()}
      />,
    );
    expect(html).toContain('посчитано по вашему профилю');
    expect(html).not.toMatch(/-v\d\b/u);
    expect(html).not.toContain('profile-assessment');
  });
});

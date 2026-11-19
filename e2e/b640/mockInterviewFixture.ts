import type { Page, Route } from '@playwright/test';
import { mockPrep, PREP_NOW } from './interviewFixture';

type Json = Record<string, unknown>;

export interface MockInterviewOptions {
  /** Тариф без пробных интервью: старт отвечает 402. */
  readonly paywall?: boolean;
  /** Не закончено интервью по другому отклику. */
  readonly otherSession?: boolean;
}

export interface MockInterviewState {
  readonly calls: string[];
}

const QUESTIONS = [
  { id: 'q-release', prompt: 'Расскажите о самом тяжёлом релизе' },
  { id: 'q-conflict', prompt: 'Как вы решали конфликт в команде?' },
];

const EVALUATION = {
  rubric: 'star',
  points: 5,
  maxPoints: 8,
  criteria: {
    situation: { points: 2, reason: 'Контекст ситуации описан.' },
    task: { points: 1, reason: 'Уточните цель и ограничения.' },
    action: { points: 2, reason: 'Ваши шаги описаны.' },
    result: { points: 0, reason: 'Не указан результат.' },
  },
};

interface Session {
  id: string;
  version: number;
  status: string;
  applicationId: string;
  vacancyTitle: string;
  index: number;
  answers: Record<string, string>;
}

function view(session: Session): Json {
  const questions = QUESTIONS.map((question) => ({
    id: question.id,
    type: 'behavioral',
    topic: 'Опыт',
    prompt: question.prompt,
    storyId: null,
    storyTitle: null,
    sourceFactIds: [],
    skipped: false,
    ...(session.answers[question.id]
      ? {
          answer: {
            text: session.answers[question.id],
            elapsedSeconds: 30,
            evaluation: EVALUATION,
          },
        }
      : {}),
  }));
  return {
    id: session.id,
    version: session.version,
    status: session.status,
    mode: 'text',
    roleTitle: session.vacancyTitle,
    applicationId: session.applicationId,
    vacancyTitle: session.vacancyTitle,
    questionTypes: ['behavioral'],
    stressMode: false,
    questions,
    currentQuestionIndex: session.index,
    currentQuestion: session.status === 'completed' ? null : (questions[session.index] ?? null),
    topicSummary: [],
    startedAt: PREP_NOW,
    updatedAt: PREP_NOW,
  };
}

function bump(session: Session, change: Partial<Session>): Session {
  return { ...session, ...change, version: session.version + 1 };
}

async function handle(
  route: Route,
  state: { session: Session | null },
  options: MockInterviewOptions,
  calls: string[],
) {
  const request = route.request();
  const path = new URL(request.url()).pathname.replace('/api/v1/candidate/interview-sessions', '');
  const method = request.method();
  if (path === '/current')
    return route.fulfill({
      json: { data: { session: state.session ? view(state.session) : null } },
    });
  if (path === '' && method === 'POST') {
    calls.push('start');
    if (options.paywall) {
      return route.fulfill({
        status: 402,
        json: { error: { code: 'paywall_required', message: 'Нужен тариф', retryable: false } },
      });
    }
    state.session = {
      id: 's-1',
      version: 1,
      status: 'active',
      applicationId: 'r-arka',
      vacancyTitle: 'Руководитель платформы',
      index: 0,
      answers: {},
    };
    return route.fulfill({ status: 201, json: { data: { session: view(state.session) } } });
  }
  const session = state.session;
  if (!session)
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'нет' } } });
  const body = request.postDataJSON() as Json;
  if (path.endsWith('/answers')) {
    calls.push(`answer ${String(body.questionId)} replace=${String(body.replaceAnswer)}`);
    state.session = bump(session, {
      answers: { ...session.answers, [String(body.questionId)]: String(body.answer) },
    });
  } else if (method === 'PATCH') {
    calls.push(`${String(body.action)} ${session.id}`);
    state.session =
      body.action === 'finish'
        ? bump(session, { status: 'completed' })
        : bump(session, { index: session.index + 1 });
  }
  return route.fulfill({ json: { data: { session: view(state.session ?? session) } } });
}

/** Пробное интервью B640 поверх «Подготовки»: два вопроса, разбор STAR по четырём критериям. */
export async function mockInterview(
  page: Page,
  options: MockInterviewOptions = {},
): Promise<MockInterviewState> {
  const calls: string[] = [];
  await mockPrep(page);
  const state: { session: Session | null } = {
    session: options.otherSession
      ? {
          id: 's-old',
          version: 3,
          status: 'active',
          applicationId: 'r-other',
          vacancyTitle: 'Head of Platform',
          index: 0,
          answers: {},
        }
      : null,
  };
  await page.route('**/api/v1/candidate/interview-sessions**', (route) =>
    handle(route, state, options, calls),
  );
  return { calls };
}

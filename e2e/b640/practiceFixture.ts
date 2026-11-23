import type { Page, Route } from '@playwright/test';
import { mockPrep, PREP_NOW } from './interviewFixture';

type Json = Record<string, unknown>;

export interface PracticeOptions {
  /** Пробные интервью на тарифе закончились: старт отвечает 402. */
  readonly paywall?: boolean;
  /** Тренировка уже отвечена: экран открывает разбор. */
  readonly answered?: string;
}

export interface PracticeState {
  readonly calls: string[];
  readonly schemas: Json[];
}

export const PRACTICE_ANSWER =
  'Требования: 2 000 платежей в секунду, пики нагрузки. Приложение шлёт запрос в шлюз API, ' +
  'шлюз кладёт платёж в очередь, сервис платежей пишет в базу PostgreSQL.';

/** B750: задача, которую сервер написал по вакансии; четыре пункта — как в макете i03a. */
export const PRACTICE_TASK = {
  title: 'Приём платежей на 2 000 в секунду',
  prompt:
    'Спроектируйте сервис приёма платежей для «Go-разработчик» в «Арка Пэй»: приём оплаты без двойного списания. Начните с требований и ограничений.',
  points: [
    'Платформа на нескольких командах: 3 команды, общие сервисы',
    'Переход на Kubernetes без остановки приёма',
    'Отказоустойчивость и понятная эксплуатация',
    'Работа с платёжными данными и повторами запросов',
  ],
  hint: 'Начните с вопросов о нагрузке.',
  timeLimitMinutes: 45,
  basis: 'vacancy',
  domain: 'payments',
  stack: ['Go', 'Kafka'],
  origin: 'model',
};

const EVALUATION = {
  rubric: 'system_design',
  points: 5,
  maxPoints: 8,
  criteria: {
    requirements: {
      points: 2,
      reason: 'Названы нагрузка и пики',
      quote: '2 000 платежей в секунду',
    },
    architecture: {
      points: 2,
      reason: 'Названы все части и порядок',
      quote: 'шлюз API, очередь, сервис платежей, PostgreSQL',
    },
    tradeoffs: { points: 0, reason: 'Не сказали, как отличить повтор от нового платежа' },
    operations: {
      points: 1,
      reason: 'Про наблюдение сказали, про откат нет',
      quote: 'следим за очередью',
    },
  },
};

interface Session {
  version: number;
  status: string;
  mode: string;
  answer: string | null;
}

function view(session: Session): Json {
  const questions = ['q-sd-1', 'q-sd-2'].map((id, index) => ({
    id,
    type: 'system_design',
    topic: 'System Design',
    prompt: 'Спроектируйте приём платежей',
    storyId: null,
    storyTitle: null,
    sourceFactIds: [],
    skipped: false,
    ...(index === 0 && session.answer
      ? { answer: { text: session.answer, elapsedSeconds: 600, evaluation: EVALUATION } }
      : {}),
  }));
  const index = session.answer ? 1 : 0;
  return {
    id: 's-sd',
    version: session.version,
    status: session.status,
    mode: session.mode,
    roleTitle: 'Руководитель платформы',
    applicationId: 'r-arka',
    vacancyTitle: 'Руководитель платформы',
    questionTypes: ['system_design'],
    stressMode: false,
    questions,
    currentQuestionIndex: index,
    currentQuestion: session.status === 'completed' ? null : questions[index],
    topicSummary: [],
    startedAt: PREP_NOW,
    updatedAt: PREP_NOW,
  };
}

const fulfillSession = (route: Route, session: Session, status = 200) =>
  route.fulfill({ status, json: { data: { session: view(session) } } });

async function sessions(
  route: Route,
  ref: { session: Session | null },
  options: PracticeOptions,
  calls: string[],
) {
  const request = route.request();
  const path = new URL(request.url()).pathname.replace('/api/v1/candidate/interview-sessions', '');
  if (path === '/current') {
    return route.fulfill({ json: { data: { session: ref.session ? view(ref.session) : null } } });
  }
  const body = (request.postDataJSON() ?? {}) as Json;
  if (path === '' && request.method() === 'POST') {
    calls.push(`start ${String(body.mode)} ${(body.questionTypes as string[]).join(',')}`);
    if (options.paywall) {
      return route.fulfill({
        status: 402,
        json: { error: { code: 'paywall_required', message: 'Нужен тариф', retryable: false } },
      });
    }
    ref.session = { version: 1, status: 'active', mode: String(body.mode), answer: null };
    return fulfillSession(route, ref.session, 201);
  }
  const session = ref.session!;
  if (path.endsWith('/answers')) {
    calls.push(`answer ${String(body.questionId)}${body.feedback === false ? '' : ' +feedback'}`);
    ref.session = { ...session, version: session.version + 1, answer: String(body.answer) };
  } else {
    calls.push(String(body.action));
    ref.session = { ...session, version: session.version + 1, status: 'completed' };
  }
  return fulfillSession(route, ref.session);
}

async function training(route: Route, ref: { session: Session | null }, state: PracticeState) {
  const request = route.request();
  const tail = new URL(request.url()).pathname.split('/').at(-1);
  const body = (request.postDataJSON() ?? {}) as Json;
  state.calls.push(`${tail} ${request.method()}`);
  if (tail === 'review') {
    const saved = state.schemas.at(-1) ?? null;
    return route.fulfill({
      json: {
        data: {
          questionId: 'q-sd-1',
          evaluation: EVALUATION,
          exampleAnswer: 'Приложение шлёт ключ повтора. Шлюз ищет его в хранилище.',
          helpful: null,
          schema: saved ? { schema: saved, source: 'corrected' } : null,
          answer: ref.session?.answer,
        },
      },
    });
  }
  if (tail === 'helpful') return route.fulfill({ json: { data: { helpful: body.helpful } } });
  state.schemas.push(body.schema as Json);
  return route.fulfill({ json: { data: { schema: body.schema, source: 'corrected' } } });
}

/** Тренировка System Design (I3) поверх «Подготовки»: отклик «Арка Холдинг», 27 из 30 пробных. */
export async function mockPractice(
  page: Page,
  options: PracticeOptions = {},
): Promise<PracticeState> {
  await mockPrep(page);
  const state: PracticeState = { calls: [], schemas: [] };
  const ref: { session: Session | null } = {
    session: options.answered
      ? { version: 4, status: 'completed', mode: 'text', answer: options.answered }
      : null,
  };
  await page.route('**/api/v1/candidate/billing/quotas', (route) =>
    route.fulfill({
      json: {
        data: {
          plan: 'pro',
          unlimited: false,
          period: null,
          fitPercentLimit: null,
          quotas: [
            {
              key: 'interview_trainings',
              label: 'Пробные интервью',
              limit: 30,
              used: 3,
              remaining: 27,
              upgradePlan: null,
            },
          ],
        },
      },
    }),
  );
  await page.route('**/api/v1/candidate/interview-sessions**', (route) =>
    sessions(route, ref, options, state.calls),
  );
  await page.route('**/api/v1/candidate/b640/interview-sessions/**', (route) =>
    training(route, ref, state),
  );
  // B750: задача по отклику — с сервера, четыре пункта, как в макете i03a.
  await page.route('**/api/v1/candidate/b640/interview-tasks', (route) =>
    route.fulfill({ json: { data: PRACTICE_TASK, meta: { requestId: 'e2e-task' } } }),
  );
  return state;
}

import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

interface InterviewSessionView {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly questions: readonly {
    readonly id: string;
    readonly answer?: {
      readonly text: string;
      readonly evaluation: {
        readonly points: number;
        readonly criteria: Readonly<
          Record<string, { readonly points: number; readonly reason: string }>
        >;
      };
    };
  }[];
  readonly currentQuestionIndex: number;
  readonly currentQuestion: { readonly id: string } | null;
  readonly topicSummary: readonly { readonly topic: string; readonly answered: number }[];
}

interface SimulatorResponse {
  readonly data?: { readonly session?: InterviewSessionView | null };
  readonly error?: { readonly code: string };
}

async function simulatorRequest(
  page: Page,
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: SimulatorResponse }> {
  return page.evaluate(
    async ({ requestPath, requestMethod, requestPayload }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        ...(requestPayload
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestPayload),
            }
          : {}),
      });
      return { status: response.status, body: (await response.json()) as SimulatorResponse };
    },
    { requestPath: path, requestMethod: method, requestPayload: payload },
  );
}

test('B356 fixture serves the full interview flow through its own route', async ({ page }) => {
  const unmatched = await mockSignedInCabinet(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });

  const empty = await simulatorRequest(page, '/api/v1/candidate/interview-sessions/current', 'GET');
  expect(empty.status).toBe(200);
  expect(empty.body.data?.session).toBeNull();

  const started = await simulatorRequest(page, '/api/v1/candidate/interview-sessions', 'POST', {
    mode: 'text',
    roleTitle: 'Руководитель инженерной команды',
    questionTypes: ['behavioral', 'system_design'],
  });
  const session = started.body.data?.session;
  expect(started.status).toBe(201);
  expect(session?.questions).toHaveLength(5);
  expect(session?.currentQuestion?.id).toBe(session?.questions[0]?.id);

  const firstQuestion = session?.questions[0];
  if (!session || !firstQuestion) throw new Error('interview_fixture_session_missing');
  const answered = await simulatorRequest(
    page,
    `/api/v1/candidate/interview-sessions/${session.id}/answers`,
    'POST',
    {
      expectedVersion: session.version,
      questionId: firstQuestion.id,
      answer:
        'В проекте команда выпускала релизы раз в две недели. Задачей было сократить цикл без потери качества. Я настроил автотесты и автоматизировал деплой. Результат: цикл сократился с 14 до 3 дней.',
      elapsedSeconds: 90,
    },
  );
  expect(answered.status).toBe(200);
  expect(answered.body.data?.session?.questions[0]?.answer?.evaluation.points).toBe(8);
  expect(answered.body.data?.session?.questions[0]?.answer?.evaluation.criteria).toHaveProperty(
    'result',
  );

  const advanced = await simulatorRequest(
    page,
    `/api/v1/candidate/interview-sessions/${session.id}`,
    'PATCH',
    { expectedVersion: answered.body.data?.session?.version, action: 'next' },
  );
  expect(advanced.status).toBe(200);
  expect(advanced.body.data?.session?.currentQuestionIndex).toBe(1);
  expect(advanced.body.data?.session?.currentQuestion?.id).toBe(
    advanced.body.data?.session?.questions[1]?.id,
  );
  expect(unmatched).not.toContain('/api/v1/candidate/interview-sessions');
});

import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { mockPrep, PREP_NOW } from './interviewFixture';

type Analysis = 'ready' | 'none' | 'failed';

const LINES = [
  {
    speaker: null,
    startMs: 0,
    endMs: 4_000,
    text: 'Расскажите, как вы снижали затраты на инфраструктуру.',
  },
  {
    speaker: null,
    startMs: 9_000,
    endMs: 30_000,
    text: 'Мы перенесли кластеры и сократили счёт на тридцать процентов.',
  },
];

const FINDINGS = {
  questions: [
    {
      atMs: 0,
      question: 'Как снижали затраты на инфраструктуру',
      summary: 'Рассказали про перенос кластеров',
      prepared: true,
      quote: 'сократили счёт на тридцать процентов',
      fix: null,
    },
  ],
  agreements: [{ atMs: 9_000, text: 'Ответ до пятницы', quote: 'перенесли кластеры' }],
  nextPrep: ['Цифры по команде'],
};

function view(analysis: Analysis, withRecording = true) {
  return {
    interviewId: 'iv-1',
    scheduledAt: '2026-11-09T12:00:00.000Z',
    format: 'Видео',
    interviewerName: 'Ирина Петрова',
    recording: withRecording
      ? {
          id: 'rec-1',
          status: 'ready',
          source: 'upload',
          startedAt: '2026-11-09T12:00:00.000Z',
          gaps: 0,
        }
      : null,
    transcript: withRecording ? LINES : [],
    metrics: withRecording
      ? {
          durationMs: 30_000,
          candidateShare: null,
          interviewerShare: null,
          wordsPerMinute: 120,
          longPauses: 1,
        }
      : null,
    analysis:
      analysis === 'ready'
        ? { status: 'ready', findings: FINDINGS, answeredBy: 'openrouter z-ai/glm' }
        : { status: analysis },
    notes: null,
  };
}

async function open(
  page: Page,
  path: string,
  node: string,
  first: Analysis,
  after: Analysis = 'ready',
  withRecording = true,
  recordingOn = true,
) {
  await page.clock.setFixedTime(new Date(PREP_NOW));
  await mockPrep(page, { interviewRecording: recordingOn });
  const calls: string[] = [];
  await page.route('**/api/v1/candidate/applications/r-arka/debrief**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    calls.push(`${method} ${url.pathname.replace(/.*\/debrief/u, 'debrief')}`);
    const state = method === 'POST' && url.pathname.endsWith('/analysis') ? after : first;
    await route.fulfill({ json: { data: view(state, withRecording) } });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B751: «Разбор интервью» (I4)', () => {
  test('готовый разбор: вопросы с цитатой, договорённость, заметки; модель не зовётся', async ({
    page,
  }) => {
    const calls = await open(page, '/app/responses/r-arka/debrief', 'i04', 'ready');
    await expect(page.getByRole('heading', { name: 'Что спросили и как прошло' })).toBeVisible();
    await expect(page.locator('.lead-sub').first()).toHaveText(
      'Арка Холдинг · интервью 9 ноября · собеседник: Ирина Петрова',
    );
    await expect(page.getByText('Как снижали затраты на инфраструктуру').first()).toBeVisible();
    await expect(page.getByText('Ответ до пятницы').first()).toBeVisible();
    await expect(page.getByText('Ваши заметки').first()).toBeVisible();
    await expect(page.getByText(/доля речи/iu)).toHaveCount(0);
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([]);
    await expectGates(page);
  });

  test('расшифровка без разбора: один вызов модели, затем вопросы', async ({ page }) => {
    const calls = await open(page, '/app/responses/r-arka/debrief', 'i04', 'none', 'ready');
    await expect(page.getByText('Как снижали затраты на инфраструктуру').first()).toBeVisible();
    expect(calls.filter((call) => call === 'POST debrief/analysis')).toHaveLength(1);
  });

  test('сбой модели: меры и заметки на месте, «Повторить разбор» зовёт модель', async ({
    page,
  }) => {
    const calls = await open(page, '/app/responses/r-arka/debrief', 'i04', 'failed', 'ready');
    await expect(page.getByText('Разбор вопросов не получился.')).toBeVisible();
    await expect(page.getByText('Ваши заметки').first()).toBeVisible();
    await page.getByRole('button', { name: 'Повторить разбор' }).click();
    await expect(page.getByText('Как снижали затраты на инфраструктуру').first()).toBeVisible();
    expect(calls.filter((call) => call === 'POST debrief/analysis')).toHaveLength(1);
    await expectGates(page);
  });

  test('записи нет: на сайте — путь к загрузке файла', async ({ page }) => {
    await open(page, '/app/responses/r-arka/debrief', 'i04', 'none', 'none', false);
    await expect(page.getByText('Записи этого интервью ещё нет.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Загрузить запись' })).toHaveAttribute(
      'href',
      '/app/responses/r-arka/debrief/upload',
    );
  });
});

test.describe('B751: «Загрузка записи» (I4c)', () => {
  test('выбор файла и имя собеседника; записи в приложении на сайте нет', async ({ page }) => {
    await open(page, '/app/responses/r-arka/debrief/upload', 'i04c', 'none', 'none', false);
    await expect(page.getByText('Выбрать файл').first()).toBeVisible();
    await expect(page.getByLabel('Имя собеседника')).toHaveValue('Ирина Петрова');
    await expect(page.getByRole('link', { name: 'Записать интервью' })).toHaveCount(0);
    await expectGates(page);
  });

  test('до файла текущий шаг — «Запись или файл»; файл не прочитался — снова «Загрузите запись»', async ({
    page,
  }) => {
    await open(page, '/app/responses/r-arka/debrief/upload', 'i04c', 'none', 'none', false);
    const steps = page.getByRole('navigation', { name: 'Шаги' });
    await expect(steps.getByRole('link', { name: 'Запись или файл' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: 'interview.m4a',
      mimeType: 'audio/mp4',
      buffer: Buffer.from('not audio at all'),
    });
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Загрузите запись интервью');
    await expect(page.locator('.ls-err, [role="alert"]').first()).toBeVisible();
    await expect(steps.getByRole('link', { name: 'Запись или файл' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

const VOICES = {
  status: 'ready',
  candidate: null,
  items: [
    {
      voice: 1,
      sharePercent: 84,
      quote: 'Мы перенесли кластеры и сократили счёт на тридцать процентов.',
    },
    { voice: 2, sharePercent: 16, quote: 'Расскажите, как вы снижали затраты на инфраструктуру.' },
  ],
};

/** I4c после расшифровки файла: голоса ещё не разделены, POST делит, PUT подтверждает. */
async function openVoices(page: Page) {
  await page.clock.setFixedTime(new Date(PREP_NOW));
  await mockPrep(page, { interviewRecording: true });
  const calls: string[] = [];
  await page.route('**/api/v1/candidate/applications/r-arka/debrief**', async (route) => {
    const method = route.request().method();
    const tail = new URL(route.request().url()).pathname.replace(/.*\/debrief/u, '');
    calls.push(`${method} ${tail || '/'} ${route.request().postData() ?? ''}`.trim());
    const voices =
      tail === '/voices'
        ? { ...VOICES, candidate: method === 'PUT' ? 2 : null }
        : { status: 'none', candidate: null, items: [] };
    await route.fulfill({ json: { data: { ...view('none'), voices } } });
  });
  await page.goto('/app/responses/r-arka/debrief/upload', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="i04c"]')).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B642: «Чей голос» после расшифровки файла (I4c)', () => {
  test('голоса делятся один раз; «Нет» — кандидат второй голос, имя у первого; подтверждение ведёт к разбору', async ({
    page,
  }) => {
    const calls = await openVoices(page);
    await expect(
      page.getByRole('heading', { name: 'Запись загружена — отметьте, кто говорит' }),
    ).toBeVisible();
    const voices = page.locator('section.mod', { hasText: 'Чей голос' });
    await expect(voices.locator('.ir-voice .row-title')).toHaveText([
      'Голос 1 — это вы?',
      'Голос 2 — интервьюер',
    ]);
    await expect(voices.locator('.ir-voice').first()).toContainText(
      '84 % речи · «Мы перенесли кластеры',
    );
    await expect(voices.getByRole('button', { name: 'Да, это я' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectGates(page);
    await voices.getByRole('button', { name: 'Нет' }).click();
    await expect(voices.locator('.ir-voice .row-title').nth(1)).toHaveText('Голос 2 — это вы');
    await expect(voices.locator('.ir-voice').first().getByLabel('Имя собеседника')).toHaveValue(
      'Ирина Петрова',
    );
    await voices.getByRole('button', { name: 'Подтвердить голоса' }).click();
    await expect(page.locator('[data-b640-node="i04"]')).toBeVisible();
    expect(calls.filter((call) => call.startsWith('POST /voices'))).toHaveLength(1);
    expect(calls).toContain('PUT /voices {"candidate":2}');
  });
});

test.describe('B642: запись разговоров выключена на сервере (до редакции 1.3)', () => {
  test('экраны разбора не открываются и сервер разбора не зовётся', async ({ page }) => {
    const calls = await open(
      page,
      '/app/responses/r-arka/debrief',
      'i04',
      'ready',
      'ready',
      true,
      false,
    );
    await expect(page.getByRole('heading', { name: 'Что спросили и как прошло' })).toHaveCount(0);
    expect(calls).toEqual([]);
  });
});

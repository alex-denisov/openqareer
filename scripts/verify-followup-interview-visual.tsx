import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FollowUpActionCard } from '../src/features/applications/FollowUpActionCard';
import type { PendingFollowUp } from '../src/features/applications/followUpTracker';
import type { CandidateMemory } from '../src/features/coach/coachApi';
import type { MatchedVacancyItem } from '../src/features/coach/cabinetTypes';
import { InterviewPrepModal } from '../src/features/interview/InterviewPrepModal';
import { VacancyBoard } from '../src/features/vacancies/VacancyBoard';

const ARTIFACT_DIRS = [
  '/Users/alexeydenisov/.gemini/antigravity/brain/54b1177c-3eb9-45df-8668-b831493636b3',
  '/Users/alexeydenisov/.gemini/antigravity/brain/9acb146f-50a0-446f-808b-f754d73492aa',
];

const sampleVacancy = {
  id: 'vac-prod-01',
  title: 'Lead Backend Engineer',
  company: 'FinTech Cloud Platform',
  location: 'Москва (Удалённо)',
  isRemote: true,
  skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Kafka', 'Docker'],
  descriptionSummary: 'Разработка архитектуры платежного ядра, оптимизация p99 latency микросервисов.',
};

const sampleMatchedItem: MatchedVacancyItem = {
  cluster: {
    id: 'vac-prod-01',
    canonicalTitle: 'Lead Backend Engineer',
    canonicalCompany: 'FinTech Cloud Platform',
    canonicalLocation: 'Москва (Удалённо)',
    isRemote: true,
    descriptionSummary: 'Разработка архитектуры платежного ядра, оптимизация p99 latency микросервисов.',
    skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Kafka', 'Docker'],
    primaryUrl: 'https://example.com/vacancies/vac-prod-01',
    sources: [
      {
        sourceType: 'hh',
        sourceId: 'hh',
        sourceName: 'hh.ru',
        sourceUrl: 'https://hh.ru/vacancy/12345678',
        observedAt: '2026-09-17T00:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-17T00:00:00.000Z',
    lastSeenAt: '2026-09-17T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  },
  explanation: {
    clusterId: 'vac-prod-01',
    roleMatch: 'target',
    requirements: { matched: 4, total: 5 },
    matchingPoints: ['Опыт Node.js/TypeScript от 5 лет', 'Архитектура высоких нагрузок'],
    missingPoints: ['Kafka стриминг в проде'],
    summary: 'Высокое совпадение по стеку бэкенда и подтверждённым фактам',
    calculatedAt: '2026-09-17T00:00:00.000Z',
  },
};

const sampleFacts: CandidateMemory[] = [
  {
    id: 'fact-achieve-1',
    kind: 'fact',
    domain: 'outcome',
    statement: 'Сократил Time-to-Interactive ядра платформы на 42% за счёт code-splitting и перехода на Webpack 5.',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['m1'],
    sensitive: false,
    status: 'confirmed',
  },
  {
    id: 'fact-exp-2',
    kind: 'fact',
    domain: 'responsibility',
    statement: 'Руководил технической гильдией из 14 инженеров и внедрил стандарты zero-downtime релизов.',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['m2'],
    sensitive: false,
    status: 'confirmed',
  },
  {
    id: 'fact-skill-3',
    kind: 'fact',
    domain: 'skill',
    statement: 'Глубокая экспертиза в проектировании микрофронтендов и дизайн-систем на React и TypeScript.',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['m3'],
    sensitive: false,
    status: 'confirmed',
  },
];

const samplePendingFollowUps: PendingFollowUp[] = [
  {
    application: {
      clusterId: 'app-01',
      status: 'applied',
      vacancy: {
        title: 'Lead Backend Engineer',
        company: 'FinTech Cloud Platform',
        url: 'https://example.com/vacancies/vac-prod-01',
        source: 'hh',
      },
      openedAt: '2026-09-12T10:00:00.000Z',
      appliedAt: '2026-09-12T10:00:00.000Z',
      confirmedBy: 'candidate',
    },
    stage: 'day_5',
    daysSinceApplied: 5,
    message:
      'Здравствуйте! Несколько дней назад я откликался на вакансию «Lead Backend Engineer» в компании FinTech Cloud Platform. Хотел деликатно уточнить, удалось ли вашей команде ознакомиться с откликом и на каком этапе сейчас рассмотрение кандидатов. Если интерес к роли сохраняется, я готов ответить на вопросы и предоставить дополнительные подтверждённые материалы.\n\nС уважением,\nАлексей Денисов',
  },
  {
    application: {
      clusterId: 'app-02',
      status: 'applied',
      vacancy: {
        title: 'Engineering Manager',
        company: 'NeoBank International',
        url: 'https://example.com/vacancies/vac-prod-02',
        source: 'linkedin',
      },
      openedAt: '2026-09-09T10:00:00.000Z',
      appliedAt: '2026-09-09T10:00:00.000Z',
      confirmedBy: 'candidate',
    },
    stage: 'day_8',
    daysSinceApplied: 8,
    message:
      'Здравствуйте! Хочу уточнить статус своего отклика на позицию «Engineering Manager» в NeoBank International. Понимаю высокую загрузку команды найма, поэтому пишу лишь узнать, остаётся ли вакансия открытой и в силе ли рассмотрение моей кандидатуры. Если процесс ещё идёт, я готов предоставить любые дополнительные материалы. Если же позиция закрыта или приоритеты сменились, буду благодарен за короткий ответ.\n\nС уважением,\nАлексей Денисов',
  },
];

interface TestCase {
  name: string;
  viewport: { width: number; height: number };
  html: string;
  description: string;
}

interface TestResult {
  name: string;
  viewport: string;
  overflow: number;
  modalWidth?: number;
  modalHeight?: number;
  modalLeft?: number;
  description: string;
}

function buildHtml(
  contentHtml: string,
  appCss: string,
  shellCss: string,
  options?: { showModal?: boolean; modalHtml?: string },
) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenQareer Follow-up and Interview Prep Verification</title>
  <style>
    ${appCss}
    ${shellCss}
    body {
      margin: 0;
      background: var(--career-bg, #090d12);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--career-text, #f1f5f9);
    }
  </style>
</head>
<body>
  <div class="career-shell">
    <div style="flex: 1; padding: 24px; max-width: 1200px; margin: 0 auto; width: 100%;">
      ${contentHtml}
    </div>
    ${options?.showModal && options.modalHtml ? options.modalHtml : ''}
  </div>
</body>
</html>`;
}

function renderCareerHomeSurface(pending: PendingFollowUp[]) {
  const followUpHtml = renderToStaticMarkup(
    React.createElement(FollowUpActionCard, {
      pendingFollowUps: pending,
      onOpenVacancy: () => {},
    }),
  );

  return `
    <div class="career-home">
      <div class="career-home-main">
        <section class="career-home-panel">
          <header>
            <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600;">Профиль кандидата: Алексей Денисов</h2>
            <p style="margin: 0; color: var(--career-text-muted); font-size: 14px;">Целевая роль: Staff Frontend Engineer / Tech Lead</p>
          </header>
          <div style="margin-top: 16px; padding: 16px; background: var(--career-surface-soft); border-radius: 8px;">
            <h4 style="margin: 0 0 8px 0; font-size: 15px;">Подтверждённые результаты и опыт</h4>
            <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; color: var(--career-text-dim);">
              <li>Сократил Time-to-Interactive ядра платформы на 42% за счёт code-splitting и Webpack 5.</li>
              <li>Руководил технической гильдией из 14 инженеров и внедрил стандарты zero-downtime релизов.</li>
              <li>Глубокая экспертиза в проектировании микрофронтендов и дизайн-систем на React и TypeScript.</li>
            </ul>
          </div>
        </section>
      </div>
      <aside class="career-home-rail" aria-label="Оценка и позиционирование">
        ${followUpHtml}
        <section class="career-home-panel">
          <h3 style="margin: 0 0 6px 0; font-size: 16px;">Один шаг на сегодня</h3>
          <p style="margin: 0; font-size: 13px; color: var(--career-text-muted);">
            Отправьте повторные сообщения по 2 активным откликам для поддержания контакта с нанимателями.
          </p>
        </section>
        <section class="career-home-panel">
          <h3 style="margin: 0 0 6px 0; font-size: 16px;">ATS-читаемость</h3>
          <p style="margin: 0; font-size: 13px; color: var(--career-text-muted);">
            Оценка читаемости профиля: 94/100 (высокая точность распознавания фактов).
          </p>
        </section>
      </aside>
    </div>
  `;
}

function renderVacancyBoardWithInterviewButton() {
  return renderToStaticMarkup(
    React.createElement(VacancyBoard, {
      pool: {
        matched: [sampleMatchedItem],
        total: 1,
        poolTotal: 1,
        loading: false,
        failed: false,
        complete: true,
      },
      applications: [],
      candidateFacts: sampleFacts,
    }),
  );
}

function renderInterviewModal(tab: 'overview' | 'star' | 'questions') {
  return renderToStaticMarkup(
    React.createElement(InterviewPrepModal, {
      isOpen: true,
      onClose: () => {},
      vacancy: sampleVacancy,
      facts: sampleFacts,
      candidateName: 'Алексей Денисов',
      initialTab: tab,
    }),
  );
}

interface RenderedHtmls {
  readonly home: string;
  readonly board: string;
  readonly modalOverview: string;
  readonly modalStar: string;
  readonly modalQuestions: string;
}

function buildDesktopTestCases(htmls: RenderedHtmls, appCss: string, shellCss: string): TestCase[] {
  return [
    {
      name: 'desktop-1440-career-home-followup',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(htmls.home, appCss, shellCss),
      description:
        'Десктоп (1440×900): Главная (CareerHome) с карточками Follow-up в правом рельсе (day_5 первое касание и day_8 финальное касание)',
    },
    {
      name: 'desktop-1440-interview-modal-overview',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(htmls.board, appCss, shellCss, { showModal: true, modalHtml: htmls.modalOverview }),
      description:
        'Десктоп (1440×900): модальное окно подготовки к интервью — вкладка справки о компании, ожидаемых вызовов и рекомендаций',
    },
    {
      name: 'desktop-1440-interview-modal-star',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(htmls.board, appCss, shellCss, { showModal: true, modalHtml: htmls.modalStar }),
      description:
        'Десктоп (1440×900): модальное окно подготовки — вкладка STAR (структурированные вопросы, привязка подтвержденных фактов кандидата, копирование ответа)',
    },
    {
      name: 'desktop-1440-interview-modal-questions',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(htmls.board, appCss, shellCss, { showModal: true, modalHtml: htmls.modalQuestions }),
      description:
        'Десктоп (1440×900): модальное окно подготовки — вкладка встречных вопросов работодателю с кнопками копирования',
    },
    {
      name: 'desktop-1440-board-interview-button',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(htmls.board, appCss, shellCss),
      description:
        'Десктоп (1440×900): лента вакансий с кнопкой «К интервью» на карточке вакансии рядом с откликом и нетворкингом',
    },
  ];
}

function buildMobileTestCases(htmls: RenderedHtmls, appCss: string, shellCss: string): TestCase[] {
  return [
    {
      name: 'mobile-390-career-home-followup',
      viewport: { width: 390, height: 844 },
      html: buildHtml(htmls.home, appCss, shellCss),
      description:
        'Мобайл (390×844): адаптивная карточка Follow-up в CareerHome с вертикальной компоновкой кнопок копирования и перехода',
    },
    {
      name: 'mobile-390-interview-modal-star',
      viewport: { width: 390, height: 844 },
      html: buildHtml(htmls.board, appCss, shellCss, { showModal: true, modalHtml: htmls.modalStar }),
      description:
        'Мобайл (390×844): адаптивное модальное окно интервью, читаемые шаги STAR (Situation, Task, Action, Result) и перенос кнопок',
    },
    {
      name: 'mobile-390-interview-modal-questions',
      viewport: { width: 390, height: 844 },
      html: buildHtml(htmls.board, appCss, shellCss, { showModal: true, modalHtml: htmls.modalQuestions }),
      description:
        'Мобайл (390×844): адаптивная вкладка встречных вопросов работодателю на мобильном экране',
    },
    {
      name: 'mobile-320-narrow-followup-overflow',
      viewport: { width: 320, height: 568 },
      html: buildHtml(htmls.home, appCss, shellCss),
      description:
        'Узкий экран (320×568): проверка отсутствия горизонтального скролла для Главной с карточкой Follow-up (overflow: 0px)',
    },
    {
      name: 'mobile-320-narrow-interview-modal-overflow',
      viewport: { width: 320, height: 568 },
      html: buildHtml(htmls.board, appCss, shellCss, { showModal: true, modalHtml: htmls.modalStar }),
      description:
        'Узкий экран (320×568): проверка отсутствия горизонтального скролла для модального окна интервью (overflow: 0px)',
    },
  ];
}

function createTestCases(appCss: string, shellCss: string): TestCase[] {
  const htmls: RenderedHtmls = {
    home: renderCareerHomeSurface(samplePendingFollowUps),
    board: renderVacancyBoardWithInterviewButton(),
    modalOverview: renderInterviewModal('overview'),
    modalStar: renderInterviewModal('star'),
    modalQuestions: renderInterviewModal('questions'),
  };

  return [
    ...buildDesktopTestCases(htmls, appCss, shellCss),
    ...buildMobileTestCases(htmls, appCss, shellCss),
  ];
}

async function saveScreenshots(page: Page, name: string): Promise<void> {
  const filename = `${name}.png`;
  for (const dir of ARTIFACT_DIRS) {
    const targetPath = path.join(dir, filename);
    await page.screenshot({ path: targetPath, fullPage: false });
  }
}

async function executeSingleTestCase(browser: Browser, tc: TestCase): Promise<TestResult> {
  const page = await browser.newPage({
    viewport: tc.viewport,
    deviceScaleFactor: 2,
  });
  await page.setContent(tc.html, { waitUntil: 'load' });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );

  let modalBox = null;
  const modalEl = page.locator('.career-interview-modal');
  if ((await modalEl.count()) > 0) {
    modalBox = await modalEl.boundingBox();
  }

  await saveScreenshots(page, tc.name);
  await page.close();

  return {
    name: tc.name,
    viewport: `${tc.viewport.width}×${tc.viewport.height}`,
    overflow,
    modalWidth: modalBox ? Math.round(modalBox.width) : undefined,
    modalHeight: modalBox ? Math.round(modalBox.height) : undefined,
    modalLeft: modalBox ? Math.round(modalBox.x) : undefined,
    description: tc.description,
  };
}

async function runVisualVerification(): Promise<void> {
  const appCss = fs.readFileSync(path.resolve('src/App.css'), 'utf8');
  const shellCss = fs.readFileSync(path.resolve('src/features/shell/career-shell.css'), 'utf8');

  for (const dir of ARTIFACT_DIRS) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const testCases = createTestCases(appCss, shellCss);
  const results: TestResult[] = [];

  for (const tc of testCases) {
    results.push(await executeSingleTestCase(browser, tc));
  }

  await browser.close();

  console.log('--- VISUAL QA MEASUREMENT REPORT FOR FOLLOW-UP AND INTERVIEW PREP ---');
  console.log(JSON.stringify(results, null, 2));
}

runVisualVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});

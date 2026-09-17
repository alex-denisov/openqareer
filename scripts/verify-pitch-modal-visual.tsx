import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VacancyPitchModal } from '../src/features/vacancies/VacancyPitchModal';
import { VacancyBoard } from '../src/features/vacancies/VacancyBoard';
import type { MatchedVacancyItem } from '../src/features/coach/cabinetTypes';
import type { VacancyPitchResult } from '../src/features/vacancies/vacancyPitchApi';

const ARTIFACT_DIRS = [
  '/Users/alexeydenisov/.gemini/antigravity/brain/1e4d0bc6-c581-404d-9d66-cdc2cb14e769',
  '/Users/alexeydenisov/.gemini/antigravity/brain/54b1177c-3eb9-45df-8668-b831493636b3',
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

const samplePitch: VacancyPitchResult = {
  vacancyId: 'vac-prod-01',
  emailPitch: {
    subject: 'Lead Backend Engineer — Алексей Денисов | Масштабирование процессов и результаты',
    body: `Здравствуйте! Заинтересовала позиция Lead Backend Engineer в компании FinTech Cloud Platform. В управлении процессами опираюсь на системный подход, масштабирование команд и достижение измеримых бизнес-результатов.

В подтверждённом опыте опираюсь на измеримые результаты: Спроектировал и запустил платежный шлюз с обработкой 15 000 RPS на Node.js и PostgreSQL. Снизил p99 задержку микросервисов с 450мс до 80мс через кэширование и тюнинг запросов.

В профиле подтверждён практический опыт работы со стеком: TypeScript, Node.js, PostgreSQL, Docker. В отношении требований к Kafka опираюсь на релевантный смежный фундамент (Redis, RabbitMQ) и готов к быстрому освоению специфики инфраструктуры.

Буду рад обсудить цели роли и приоритеты бизнеса на коротком звонке. Резюме во вложении.`,
  },
  linkedInNote: 'Здравствуйте! Заинтересовала роль Lead Backend Engineer в FinTech Cloud Platform. Мой опыт: спроектировал и запустил платежный шлюз на 15 000 RPS. Буду рад обсудить задачи команды и добавить вас в сеть контактов!',
  atsCoverLetter: `Кому: Нанимающей команде компании FinTech Cloud Platform
Позиция: Lead Backend Engineer
Кандидат: Алексей Денисов

Уважаемая команда FinTech Cloud Platform!

Здравствуйте! Заинтересовала позиция Lead Backend Engineer в компании FinTech Cloud Platform. В управлении процессами опираюсь на системный подход, масштабирование команд и достижение измеримых бизнес-результатов.

Ключевые подтверждённые результаты:
В подтверждённом опыте опираюсь на измеримые результаты: Спроектировал и запустил платежный шлюз с обработкой 15 000 RPS на Node.js и PostgreSQL. Снизил p99 задержку микросервисов с 450мс до 80мс через кэширование и тюнинг запросов.

Соответствие требованиям роли:
В профиле подтверждён практический опыт работы со стеком: TypeScript, Node.js, PostgreSQL, Docker. В отношении требований к Kafka опираюсь на релевантный смежный фундамент (Redis, RabbitMQ) и готов к быстрому освоению специфики инфраструктуры.

Буду рад обсудить цели роли и приоритеты бизнеса на коротком звонке. Резюме во вложении.

С уважением,
Алексей Денисов`,
  usedEvidenceIds: ['mem-001', 'mem-002', 'mem-003'],
  generatedAt: '2026-09-17T00:00:00.000Z',
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
    summary: 'Высокое совпадение по стеку бэкенда и измеримым результатам',
    calculatedAt: '2026-09-17T00:00:00.000Z',
  },
};

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
  <title>OpenQareer Pitch Verification</title>
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

function renderModalHtmls() {
  const board = renderToStaticMarkup(
    <VacancyBoard
      pool={{
        matched: [sampleMatchedItem],
        total: 1,
        poolTotal: 1,
        loading: false,
        failed: false,
        complete: true,
      }}
      applications={[]}
    />,
  );
  const email = renderToStaticMarkup(
    <VacancyPitchModal
      isOpen={true}
      onClose={() => {}}
      vacancy={sampleVacancy}
      initialPitch={samplePitch}
      initialTab="email"
    />,
  );
  const linkedIn = renderToStaticMarkup(
    <VacancyPitchModal
      isOpen={true}
      onClose={() => {}}
      vacancy={sampleVacancy}
      initialPitch={samplePitch}
      initialTab="linkedin"
    />,
  );
  const ats = renderToStaticMarkup(
    <VacancyPitchModal
      isOpen={true}
      onClose={() => {}}
      vacancy={sampleVacancy}
      initialPitch={samplePitch}
      initialTab="ats"
    />,
  );
  return { board, email, linkedIn, ats };
}

function createTestCases(appCss: string, shellCss: string): TestCase[] {
  const { board, email, linkedIn, ats } = renderModalHtmls();
  return [
    {
      name: 'desktop-1440-vacancy-board',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(board, appCss, shellCss),
      description: 'Десктоп: витрина вакансий с кнопкой «Подготовить отклик»',
    },
    {
      name: 'desktop-1440-pitch-modal-email',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: email }),
      description: 'Десктоп (1440×900): модальное окно, вкладка Email-сопроводительное',
    },
    {
      name: 'desktop-1440-pitch-modal-linkedin',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: linkedIn }),
      description: 'Десктоп (1440×900): вкладка LinkedIn Note со счетчиком символов (/ 300)',
    },
    {
      name: 'desktop-1440-pitch-modal-ats',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: ats }),
      description: 'Десктоп (1440×900): вкладка ATS Cover Letter с кнопками копирования и скачивания',
    },
    {
      name: 'mobile-390-pitch-modal-email',
      viewport: { width: 390, height: 844 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: email }),
      description: 'Мобайл (390×844): адаптивное модальное окно на всю ширину',
    },
    {
      name: 'mobile-390-pitch-modal-linkedin',
      viewport: { width: 390, height: 844 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: linkedIn }),
      description: 'Мобайл (390×844): вкладка LinkedIn Note с адаптивным счетчиком',
    },
    {
      name: 'mobile-320-pitch-modal-narrow',
      viewport: { width: 320, height: 568 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: email }),
      description: 'Узкий экран (320×568): проверка отсутствия горизонтального скролла (overflow: 0px)',
    },
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
  const modalEl = page.locator('.career-pitch-modal');
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

  console.log('--- VISUAL QA MEASUREMENT REPORT ---');
  console.log(JSON.stringify(results, null, 2));
}

runVisualVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});

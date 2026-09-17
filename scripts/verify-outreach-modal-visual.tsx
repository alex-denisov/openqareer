import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopOutreachModal } from '../src/features/outreach/DesktopOutreachModal';
import { VacancyBoard } from '../src/features/vacancies/VacancyBoard';
import {
  clearOutreachStore,
  recordOutreachInvite,
  updateOutreachStatus,
} from '../src/features/outreach/outreachTrackingStore';
import type { MatchedVacancyItem } from '../src/features/coach/cabinetTypes';

const ARTIFACT_DIRS = [
  '/Users/alexeydenisov/.gemini/antigravity/brain/54b1177c-3eb9-45df-8668-b831493636b3',
  '/Users/alexeydenisov/.gemini/antigravity/brain/3bf213f1-f1ff-4b85-adab-3f1924ac8179',
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
  <title>OpenQareer Outreach Verification</title>
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

function setupOutreachHistory() {
  clearOutreachStore();
  const rec1 = recordOutreachInvite({
    vacancyId: sampleVacancy.id,
    company: sampleVacancy.company,
    contactName: 'Анна Воронова',
    contactProfileUrl: 'https://linkedin.com/in/anna-v',
    connectionNote: 'Здравствуйте, Анна! Заинтересовала вакансия Lead Backend Engineer.',
    status: 'invite_sent',
  });
  updateOutreachStatus(rec1.id, 'connected');

  const rec2 = recordOutreachInvite({
    vacancyId: sampleVacancy.id,
    company: sampleVacancy.company,
    contactName: 'Михаил Соколов',
    contactProfileUrl: 'https://linkedin.com/in/mikhail-s',
    connectionNote: 'Михаил, добрый день! Рад знакомству. Ознакомился со стеком проекта.',
    status: 'dialogue_started',
  });

  const rec3 = recordOutreachInvite({
    vacancyId: sampleVacancy.id,
    company: sampleVacancy.company,
    contactName: 'Дмитрий Мельников',
    contactProfileUrl: 'https://linkedin.com/in/dmitry-m',
    connectionNote: 'Здравствуйте, Дмитрий! Буду рад обсудить архитектурные вызовы.',
    status: 'invite_sent',
  });

  return [rec1, rec2, rec3];
}

function renderModalHtmls() {
  setupOutreachHistory();

  const board = renderToStaticMarkup(
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
    }),
  );

  // Desktop mode HTML
  (globalThis as unknown as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
  const modalDesktop = renderToStaticMarkup(
    React.createElement(DesktopOutreachModal, {
      isOpen: true,
      onClose: () => {},
      vacancy: sampleVacancy,
      initialNote:
        'Здравствуйте, Анна! Заинтересовала позиция Lead Backend Engineer в компании FinTech Cloud Platform. В подтвержденном опыте — запуск шлюза на 15 000 RPS. Буду рад добавить вас в сеть контактов!',
    }),
  );

  // Web mode HTML
  delete (globalThis as unknown as { window?: unknown }).window;
  const modalWeb = renderToStaticMarkup(
    React.createElement(DesktopOutreachModal, {
      isOpen: true,
      onClose: () => {},
      vacancy: sampleVacancy,
      initialNote:
        'Здравствуйте, Анна! Заинтересовала позиция Lead Backend Engineer в компании FinTech Cloud Platform. В подтвержденном опыте — запуск шлюза на 15 000 RPS. Буду рад добавить вас в сеть контактов!',
    }),
  );

  return { board, modalDesktop, modalWeb };
}

function createTestCases(appCss: string, shellCss: string): TestCase[] {
  const { board, modalDesktop, modalWeb } = renderModalHtmls();
  return [
    {
      name: 'desktop-1440-outreach-modal-desktop',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: modalDesktop }),
      description:
        'Десктоп (1440×900): локальная сессия, карточки лиц, принимающих решения, блок лимитов 15 инвайтов, чекбокс подтверждения, история воронки',
    },
    {
      name: 'desktop-1440-outreach-modal-web',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: modalWeb }),
      description:
        'Десктоп (1440×900): веб-режим, дисклеймер ADR-009 без передачи cookies, кнопка копирования текста питча',
    },
    {
      name: 'mobile-390-outreach-modal-desktop',
      viewport: { width: 390, height: 844 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: modalDesktop }),
      description:
        'Мобайл (390×844): адаптивные карточки контактов, перенос тегов лимитов, читаемая форма отправки',
    },
    {
      name: 'mobile-390-outreach-modal-web',
      viewport: { width: 390, height: 844 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: modalWeb }),
      description:
        'Мобайл (390×844): веб-режим, читаемый блок ADR-009 и адаптивная кнопка копирования',
    },
    {
      name: 'mobile-320-outreach-modal-narrow',
      viewport: { width: 320, height: 568 },
      html: buildHtml(board, appCss, shellCss, { showModal: true, modalHtml: modalDesktop }),
      description:
        'Узкий экран (320×568): проверка отсутствия горизонтального скролла (overflow: 0px)',
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
  const modalEl = page.locator('.career-outreach-modal');
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

  console.log('--- VISUAL QA MEASUREMENT REPORT FOR OUTREACH MODAL ---');
  console.log(JSON.stringify(results, null, 2));
}

runVisualVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});

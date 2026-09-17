import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RecruiterContact } from '../shared/recruiterContact';
import type { MatchedVacancyItem } from '../src/features/coach/cabinetTypes';
import { RecruiterContactsBlock } from '../src/features/vacancies/RecruiterContactsBlock';
import { VacancyBoard } from '../src/features/vacancies/VacancyBoard';

const ARTIFACT_DIRS = [
  '/Users/alexeydenisov/.gemini/antigravity/brain/54b1177c-3eb9-45df-8668-b831493636b3',
  '/Users/alexeydenisov/.gemini/antigravity/brain/d377e3a0-ccac-4046-be10-595627671fa7',
];

const sampleContactVerified: RecruiterContact = {
  id: 'rc-01',
  vacancyId: 'vac-prod-01',
  companyName: 'FinTech Cloud Platform',
  fullName: 'Елена Смирнова',
  roleTitle: 'Technical Recruiter',
  email: 'elena.smirnova@fintechcloud.io',
  emailStatus: 'verified',
  phone: '+7 999 123-45-67',
  telegram: '@elena_recruiter',
  whatsapp: 'https://wa.me/79991234567',
  linkedinUrl: 'https://www.linkedin.com/in/elena-smirnova',
  githubUrl: null,
  twitterUrl: null,
  sourceType: 'osint_discovery',
  confidence: 0.95,
  createdAt: '2026-09-17T10:00:00.000Z',
  updatedAt: '2026-09-17T10:00:00.000Z',
};

const sampleContactHypothesis: RecruiterContact = {
  id: 'rc-02',
  vacancyId: 'vac-prod-01',
  companyName: 'FinTech Cloud Platform',
  fullName: 'Михаил Ковалев',
  roleTitle: 'Engineering Manager',
  email: 'mikhail.kovalev@fintechcloud.io',
  emailStatus: 'hypothesis',
  phone: null,
  telegram: null,
  whatsapp: null,
  linkedinUrl: 'https://www.linkedin.com/in/mikhail-kovalev',
  githubUrl: 'https://github.com/mkovalev',
  twitterUrl: 'https://x.com/mkovalev_tech',
  sourceType: 'domain_pattern',
  confidence: 0.7,
  createdAt: '2026-09-17T10:00:00.000Z',
  updatedAt: '2026-09-17T10:00:00.000Z',
};

const sampleContactUnverified: RecruiterContact = {
  id: 'rc-03',
  vacancyId: 'vac-prod-01',
  companyName: 'FinTech Cloud Platform',
  fullName: 'Алина Воронова',
  roleTitle: 'HR Generalist',
  email: null,
  emailStatus: 'unverified',
  phone: '+7 495 555-01-23',
  telegram: '@alina_hr',
  whatsapp: null,
  linkedinUrl: null,
  githubUrl: null,
  twitterUrl: null,
  sourceType: 'public_metadata',
  confidence: 0.5,
  createdAt: '2026-09-17T10:00:00.000Z',
  updatedAt: '2026-09-17T10:00:00.000Z',
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
  cardsCount: number;
  actionLinksCount: number;
  hasBadges: boolean;
  description: string;
}

function buildHtml(contentHtml: string, appCss: string, shellCss: string) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenQareer Recruiter Contacts Verification</title>
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
  <div class="career-shell" style="grid-template-columns: 1fr; height: auto; min-height: 100vh;">
    <main class="career-shell-main" style="grid-column: 1 / -1; padding: 20px; max-width: 1200px; margin: 0 auto; width: 100%; box-sizing: border-box;">
      ${contentHtml}
    </main>
  </div>
</body>
</html>`;
}

function renderBoardWithContacts(): string {
  return renderToStaticMarkup(
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
      initialContactsByVacancyId={{
        'vac-prod-01': [sampleContactVerified, sampleContactHypothesis],
      }}
    />,
  );
}

function renderBoardInitialState(): string {
  return renderToStaticMarkup(
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
}

function renderStandaloneContacts(): string {
  return renderToStaticMarkup(
    <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Recruiter Intelligence Contacts</h3>
      <RecruiterContactsBlock
        vacancyId="vac-prod-01"
        initialContacts={[sampleContactVerified, sampleContactHypothesis, sampleContactUnverified]}
      />
    </div>,
  );
}

function createTestCases(appCss: string, shellCss: string): TestCase[] {
  const boardExpanded = renderBoardWithContacts();
  const boardInitial = renderBoardInitialState();
  const standalone = renderStandaloneContacts();

  return [
    {
      name: 'desktop-1440-board-recruiter-contacts',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(boardExpanded, appCss, shellCss),
      description: 'Десктоп (1440×900): витрина вакансий с развернутыми контактами рекрутеров (проверен + гипотеза)',
    },
    {
      name: 'desktop-1440-board-initial-button',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(boardInitial, appCss, shellCss),
      description: 'Десктоп (1440×900): начальное состояние со встроенной кнопкой «Найти прямые контакты»',
    },
    {
      name: 'mobile-390-board-recruiter-contacts',
      viewport: { width: 390, height: 844 },
      html: buildHtml(boardExpanded, appCss, shellCss),
      description: 'Мобайл (390×844): адаптивные плашки контактов в строке вакансии, кнопки в границах экрана',
    },
    {
      name: 'mobile-320-narrow-contacts-overflow',
      viewport: { width: 320, height: 600 },
      html: buildHtml(boardExpanded, appCss, shellCss),
      description: 'Узкий экран (320px): проверка полного отсутствия горизонтального скролла (overflow === 0)',
    },
    {
      name: 'desktop-1440-standalone-recruiter-cards',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(standalone, appCss, shellCss),
      description: 'Десктоп (1440×900): карточки контактов во всех трёх статусах (Verified, Hypothesis, Unverified)',
    },
    {
      name: 'mobile-390-standalone-recruiter-cards',
      viewport: { width: 390, height: 844 },
      html: buildHtml(standalone, appCss, shellCss),
      description: 'Мобайл (390×844): адаптивная раскладка карточек контактов со всеми каналами связи',
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

  const cardsCount = await page.locator('.career-recruiter-card').count();
  const actionLinksCount = await page.locator('.career-recruiter-link').count();
  const badgesCount = await page.locator('.career-recruiter-badge').count();

  await saveScreenshots(page, tc.name);
  await page.close();

  return {
    name: tc.name,
    viewport: `${tc.viewport.width}×${tc.viewport.height}`,
    overflow,
    cardsCount,
    actionLinksCount,
    hasBadges: badgesCount > 0,
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

  console.log('=== RECRUITER INTELLIGENCE VISUAL QA REPORT ===');
  console.log(JSON.stringify(results, null, 2));
}

runVisualVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});

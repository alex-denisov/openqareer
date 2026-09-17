import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CandidateReputationAudit } from '../shared/candidateReputation';
import { CandidateReputationAuditView } from '../src/features/reputation/CandidateReputationAuditView';

const ARTIFACT_DIRS = [
  '/Users/alexeydenisov/.gemini/antigravity/brain/54b1177c-3eb9-45df-8668-b831493636b3',
  '/Users/alexeydenisov/.gemini/antigravity/brain/14029e4a-7cb7-4f8a-88ba-31ed8e02c479',
];

const sampleCompletedAudit: CandidateReputationAudit = {
  id: 'audit-rep-01',
  candidateId: 'cand-verify-01',
  status: 'completed',
  overallStatus: 'critical_risk',
  score: 55,
  consistencyDiscrepancies: [
    {
      id: 'd-01',
      field: 'Должность и грейд: VK',
      candidateValue: 'Lead Software Engineer',
      externalValue: 'Junior Software Engineer',
      externalSource: 'LinkedIn',
      severity: 'critical',
      suggestion: 'Уточнить формулировку должности и грейда в профиле LinkedIn',
    },
    {
      id: 'd-02',
      field: 'Дата окончания: Яндекс',
      candidateValue: '2023-08',
      externalValue: '2022-11',
      externalSource: 'hh.ru',
      severity: 'warning',
      suggestion: 'Синхронизировать дату окончания работы в hh.ru с основным резюме',
    },
    {
      id: 'd-03',
      field: 'Разрыв в стаже: Сбер -> Ozon',
      candidateValue: '2021-02 - 2021-10',
      externalValue: 'Перерыв более 6 месяцев',
      externalSource: 'История опыта',
      severity: 'warning',
      suggestion: 'Добавить пояснение о перерыве в работе (саббатикал, пет-проекты)',
    },
  ],
  reputationRisks: [
    {
      id: 'r-01',
      sourcePlatform: 'Хабр',
      sourceUrl: 'https://habr.com/post/example-1',
      publishedAt: '2023-04-10',
      excerpt: 'Бывшее руководство — кидалы и самодуры, никому не советую эту шарашкину контору',
      category: 'toxic_workplace',
      severity: 'high',
      remediation: 'Удалить или скрыть эмоциональную публикацию о бывшем работодателе',
    },
    {
      id: 'r-02',
      sourcePlatform: 'Telegram',
      publishedAt: '2023-07-22',
      excerpt: 'Вот слив метрик и скриншоты внутренних финансовых дашбордов под NDA компании',
      category: 'nda_leak',
      severity: 'high',
      remediation: 'Немедленно удалить конфиденциальные корпоративные данные и скриншоты',
    },
    {
      id: 'r-03',
      sourcePlatform: 'Twitter / X',
      publishedAt: '2023-02-14',
      excerpt: 'Вы все идиоты и уроды, чтобы вы все сдохли в своих нищих офисах',
      category: 'polarizing_argument',
      severity: 'medium',
      remediation: 'Удалить агрессивные и токсичные высказывания',
    },
  ],
  consentAction: 'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
  startedAt: '2026-09-17T10:15:00.000Z',
  completedAt: '2026-09-17T10:15:04.000Z',
};

const sampleSafeAudit: CandidateReputationAudit = {
  id: 'audit-rep-02',
  candidateId: 'cand-verify-02',
  status: 'completed',
  overallStatus: 'safe',
  score: 100,
  consistencyDiscrepancies: [],
  reputationRisks: [],
  consentAction: 'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
  startedAt: '2026-09-17T10:20:00.000Z',
  completedAt: '2026-09-17T10:20:02.000Z',
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
  hasBanner: boolean;
  score: string;
  discrepanciesCount: number;
  risksCount: number;
  description: string;
}

function buildHtml(contentHtml: string, appCss: string, shellCss: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenQareer Candidate Reputation Verification</title>
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
    <main class="career-shell-main" style="grid-column: 1 / -1; padding: 24px; max-width: 1000px; margin: 0 auto; width: 100%; box-sizing: border-box;">
      ${contentHtml}
    </main>
  </div>
</body>
</html>`;
}

function getDesktopCases(appCss: string, shellCss: string): TestCase[] {
  const unstartedHtml = renderToStaticMarkup(<CandidateReputationAuditView initialAudit={null} />);
  const completedHtml = renderToStaticMarkup(<CandidateReputationAuditView initialAudit={sampleCompletedAudit} />);
  const safeHtml = renderToStaticMarkup(<CandidateReputationAuditView initialAudit={sampleSafeAudit} />);

  return [
    {
      name: 'desktop-1440-reputation-unstarted',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(unstartedHtml, appCss, shellCss),
      description: 'Десктоп (1440×900): экран до запуска с кнопкой и 152-ФЗ / GDPR',
    },
    {
      name: 'desktop-1440-reputation-report',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(completedHtml, appCss, shellCss),
      description: 'Десктоп (1440×900): отчет (55/100, критический статус, риски)',
    },
    {
      name: 'desktop-1440-reputation-safe',
      viewport: { width: 1440, height: 900 },
      html: buildHtml(safeHtml, appCss, shellCss),
      description: 'Десктоп (1440×900): безопасный статус (100/100, чистая история)',
    },
  ];
}

function getMobileCases(appCss: string, shellCss: string): TestCase[] {
  const unstartedHtml = renderToStaticMarkup(<CandidateReputationAuditView initialAudit={null} />);
  const completedHtml = renderToStaticMarkup(<CandidateReputationAuditView initialAudit={sampleCompletedAudit} />);

  return [
    {
      name: 'mobile-390-reputation-unstarted',
      viewport: { width: 390, height: 844 },
      html: buildHtml(unstartedHtml, appCss, shellCss),
      description: 'Мобайл (390×844): адаптивная карточка запуска и дисклеймер',
    },
    {
      name: 'mobile-390-reputation-report',
      viewport: { width: 390, height: 844 },
      html: buildHtml(completedHtml, appCss, shellCss),
      description: 'Мобайл (390×844): адаптивный баннер, риски и рекомендации',
    },
    {
      name: 'mobile-320-narrow-reputation-overflow',
      viewport: { width: 320, height: 600 },
      html: buildHtml(completedHtml, appCss, shellCss),
      description: 'Узкий экран (320px): отсутствие скролла для отчета',
    },
    {
      name: 'mobile-320-narrow-unstarted-overflow',
      viewport: { width: 320, height: 600 },
      html: buildHtml(unstartedHtml, appCss, shellCss),
      description: 'Узкий экран (320px): отсутствие скролла для карточки запуска',
    },
  ];
}

async function saveScreenshots(page: Page, name: string): Promise<void> {
  const filename = `${name}.png`;
  for (const dir of ARTIFACT_DIRS) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, filename), fullPage: false });
  }
}

async function executeSingleTestCase(browser: Browser, tc: TestCase): Promise<TestResult> {
  const page = await browser.newPage({ viewport: tc.viewport, deviceScaleFactor: 2 });
  await page.setContent(tc.html, { waitUntil: 'domcontentloaded' });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  const hasBanner = await page.locator('.career-reputation-score-banner').count().then((c) => c > 0);
  const score = hasBanner
    ? await page.locator('.career-reputation-score-value').textContent().catch(() => 'N/A')
    : 'N/A';
  const discrepanciesCount = await page.locator('.career-reputation-discrepancy-grid').count();
  const risksCount = await page.locator('.career-reputation-excerpt').count();

  await saveScreenshots(page, tc.name);
  await page.close();

  return {
    name: tc.name,
    viewport: `${tc.viewport.width}×${tc.viewport.height}`,
    overflow,
    hasBanner,
    score: score ?? 'N/A',
    discrepanciesCount,
    risksCount,
    description: tc.description,
  };
}

async function runVisualVerification(): Promise<void> {
  const appCss = fs.readFileSync(path.resolve('src/App.css'), 'utf8');
  const shellCss = fs.readFileSync(path.resolve('src/features/shell/career-shell.css'), 'utf8');
  const testCases = [...getDesktopCases(appCss, shellCss), ...getMobileCases(appCss, shellCss)];

  const browser = await chromium.launch({ headless: true });
  const results: TestResult[] = [];

  for (const tc of testCases) {
    results.push(await executeSingleTestCase(browser, tc));
  }
  await browser.close();

  console.log('=== CANDIDATE REPUTATION VISUAL QA REPORT ===');
  console.log(JSON.stringify(results, null, 2));
}

runVisualVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});

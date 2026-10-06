import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildTargetedResumeSlice } from '../server/domain/resumeStudio';
import { formatTargetedResumeAsAtsText } from '../src/features/resume/resumeExport';
import { estimateResumePages } from '../src/features/resume/targetedResumeVolume';
import type {
  ResumeAssertion,
  ResumeDocument,
  ResumeExperience,
} from '../src/features/resume/resumeTypes';

function fact<Value extends string | boolean = string>(
  value: Value,
  memoryId: string,
): ResumeAssertion<Value> {
  return { value, memoryId, sourceMessageIds: [`message-${memoryId}`], reviewFlags: [] };
}

function experience(
  id: string,
  year: string,
  title: string,
  bullets: readonly string[],
): ResumeExperience {
  return {
    id,
    title: fact(title, `${id}-title`),
    employer: fact(`${id} employer`, `${id}-employer`),
    location: null,
    startDate: fact(year, `${id}-start`),
    endDate: null,
    current: fact(false, `${id}-current`),
    bullets: bullets.map((bullet, index) => fact(bullet, `${id}-bullet-${index}`)),
  };
}

function masterDocument(experienceItems: readonly ResumeExperience[]): ResumeDocument {
  return {
    kind: 'master',
    targetRole: 'Инженер платформы',
    contact: {
      fullName: 'Анна Пример',
      email: 'anna@example.test',
      phone: null,
      location: 'Москва',
      links: [],
    },
    about: 'Инженер платформы с опытом разработки сервисов.',
    experience: experienceItems,
    education: [],
    languages: [],
    projects: [],
    skills: [],
    courses: [],
    tests: [],
    recommendations: [],
    additional: {},
    unknowns: [],
    conventions: {
      country: null,
      packVersion: null,
      reverseChronological: true,
      maxPages: null,
      recommendedBulletsPerRole: null,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    },
    length: { lines: 10, pages: 1, linesPerPage: 45 },
  };
}

function targetedResume(experienceItems: readonly ResumeExperience[]) {
  return estimateResumePages(
    buildTargetedResumeSlice(masterDocument(experienceItems), {
      title: 'Инженер платформы',
      requirements: ['Kubernetes'],
    }),
  );
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function printTargetedResume(page: Page, text: string): Promise<Buffer> {
  const appCss = readFileSync('src/App.css', 'utf8');
  const shellCss = readFileSync('src/features/shell/career-shell.css', 'utf8');
  await page.setContent(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${appCss}</style><style>${shellCss}</style></head><body data-resume-print-target="targeted"><div class="career-shell"><article class="career-resume-print career-resume-print-targeted" aria-hidden="true"><pre class="career-resume-ats-pre"><code>${escapeHtml(text)}</code></pre></article></div></body></html>`,
    { waitUntil: 'load' },
  );
  await page.emulateMedia({ media: 'print' });
  return page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
}

async function pdfPageCount(pdf: Buffer): Promise<number> {
  const loadingTask = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    return document.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

test('targeted resume page estimate matches rendered PDF for long and short samples', async ({
  page,
}, testInfo) => {
  const long = targetedResume([
    experience('oldest', '2010', 'Менеджер по продажам', ['Вела переговоры с партнёрами.']),
    experience('platform', '2023', 'Инженер платформы', [
      'Поддерживала Kubernetes в производственных сервисах.',
      ...Array.from(
        { length: 100 },
        () => 'Сопровождала внутренние процессы и готовила недельные отчёты.',
      ),
    ]),
    experience('newer', '2018', 'Менеджер процессов', [
      'Планировала административную работу команды.',
    ]),
  ]);
  const short = targetedResume([
    experience('platform', '2023', 'Инженер платформы', [
      'Поддерживала Kubernetes в производственных сервисах.',
    ]),
  ]);

  expect(long.pages).toBeLessThanOrEqual(2);
  expect(short.trimmed).toEqual([]);
  const longPdf = await printTargetedResume(page, formatTargetedResumeAsAtsText(long));
  const shortPdf = await printTargetedResume(page, formatTargetedResumeAsAtsText(short));
  expect(await pdfPageCount(longPdf)).toBe(long.pages);
  expect(await pdfPageCount(shortPdf)).toBe(short.pages);

  if (testInfo.project.name === 'desktop-1440') {
    mkdirSync('output/B418', { recursive: true });
    writeFileSync('output/B418/sample.pdf', longPdf);
  }
});

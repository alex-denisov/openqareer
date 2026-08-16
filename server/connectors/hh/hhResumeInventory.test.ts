import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasResumeId, readHhResumeInventory } from './hhResumeInventory';

const ownerResumeId = '260801e7ff10eeac690039ed1f4f655a417a35';

describe('hh.ru resume inventory', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30_000);

  it('keeps hh.ru wording and separates a counter label from its number', async () => {
    await page.setContent(`
      <div data-qa="resume" data-qa-id="284077161" data-qa-title="Менеджер по продукту">
        <a data-qa="resume-card-link-${ownerResumeId}" href="/resume/${ownerResumeId}?hhtmFrom=resume_list">
          <div data-qa="resume-title"><h3>Менеджер по продукту</h3></div>
          <div data-qa="title-description">Обновлено <span>9&nbsp;августа&nbsp;2026&nbsp;в&nbsp;16:09</span></div>
        </a>
        <div data-qa="search-shows"><div>Показы</div><div>1&nbsp;204</div></div>
        <a data-qa="count-new-views" href="/applicant/resumeview/history"><div>Просмотры</div><div>0</div></a>
      </div>
    `);

    expect(await readHhResumeInventory(page)).toEqual([
      {
        id: ownerResumeId,
        title: 'Менеджер по продукту',
        updatedLabel: 'Обновлено 9 августа 2026 в 16:09',
        url: `https://hh.ru/resume/${ownerResumeId}`,
        searchShows: { label: 'Показы', count: 1_204 },
        newViews: { label: 'Просмотры', count: 0 },
      },
    ]);
  });

  it('falls back to the card title attribute and reports an absent counter as null', async () => {
    await page.setContent(`
      <div data-qa="resume" data-qa-title="Аналитик данных">
        <a data-qa="resume-card-link-${ownerResumeId}" href="/resume/${ownerResumeId}"></a>
        <div data-qa="search-shows">Показы недоступны</div>
      </div>
    `);

    expect(await readHhResumeInventory(page)).toEqual([
      {
        id: ownerResumeId,
        title: 'Аналитик данных',
        updatedLabel: null,
        url: `https://hh.ru/resume/${ownerResumeId}`,
        searchShows: { label: 'Показы недоступны', count: null },
        newViews: null,
      },
    ]);
  });

  it('skips a card whose public id or title cannot be read instead of guessing', async () => {
    await page.setContent(`
      <div data-qa="resume"><a data-qa="resume-card-link-x" href="/vacancy/1">Не резюме</a></div>
      <div data-qa="resume"><a data-qa="resume-card-link-y">Ссылка без адреса</a></div>
      <div data-qa="resume">
        <a data-qa="resume-card-link-${ownerResumeId}" href="/resume/${ownerResumeId}"></a>
      </div>
    `);

    expect(await readHhResumeInventory(page)).toEqual([]);
  });

  it('accepts the declared resume id only as an exact member of the list', async () => {
    const resumes = [
      {
        id: ownerResumeId,
        title: 'Менеджер по продукту',
        updatedLabel: null,
        url: `https://hh.ru/resume/${ownerResumeId}`,
        searchShows: null,
        newViews: null,
      },
    ];

    expect(hasResumeId(resumes, ` ${ownerResumeId.toUpperCase()} `)).toBe(true);
    expect(hasResumeId(resumes, ownerResumeId.slice(0, -1))).toBe(false);
    expect(hasResumeId(resumes, 'not-a-resume-id')).toBe(false);
    expect(hasResumeId([], ownerResumeId)).toBe(false);
  });
});

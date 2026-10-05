import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { candidate } from './fixtures/readabilityWorkspace';

/**
 * B393 — Дебрифинг после интервью и черновик напоминания, если компания не ответила в срок (US-07.4).
 * Критерии приёмки:
 * - Экспресс-форма после интервью (ощущение, трудные вопросы, обещанный срок ответа) в карточке отклика;
 * - По наступлению срока в «Сегодня» предлагается черновик напоминания компании (строго термин «напоминание компании», а не «follow-up», B344);
 * - Без автоотправки;
 * - Unit на расчёт срока;
 * - e2e (форма → срок → предложение) на 1440 и 390.
 */

function makeApplication(overrides: Record<string, unknown>) {
  return {
    id: overrides.id,
    candidateId: candidate.candidateId,
    clusterId: null,
    stage: 'interview',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: null,
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-01T10:00:00.000Z',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: true, resume: true },
    nearestInterview: {
      id: 'iv-101',
      round: 1,
      scheduledAt: '2026-10-02T12:00:00.000Z',
      prepStatus: 'ready',
    },
    archiveStaleDays: 30,
    ...overrides,
  };
}

const INITIAL_APPLICATIONS = [
  makeApplication({
    id: 'app-interview-101',
    stage: 'interview',
    vacancy: {
      title: 'Senior Backend Architect',
      company: 'Яндекс Cloud',
      url: 'https://hh.ru/vacancy/201',
      source: 'hh',
    },
  }),
];

function makeTodaySnapshot(hasReminderDue: boolean) {
  return {
    digest: {
      waitingForYou: hasReminderDue ? 1 : 0,
      newVacancies: 0,
      followUpsDueToday: hasReminderDue ? 1 : 0,
      followUpsOverdue: 0,
      closedVacancies: 0,
      interviewsAhead: 1,
      nextInterview: {
        company: 'Яндекс Cloud',
        title: 'Senior Backend Architect',
        round: 1,
        at: '2026-10-02T12:00:00.000Z',
      },
      newVacanciesCaption: null,
      followUpCaptions: hasReminderDue ? ['Яндекс Cloud — 3 дня тишины'] : [],
      applicationsWaitingOver7Days: 0,
    },
    queue: hasReminderDue
      ? [
          {
            kind: 'follow_up' as const,
            applicationId: 'app-interview-101',
            title: 'Senior Backend Architect',
            company: 'Яндекс Cloud',
            eyebrow: 'Напоминание компании · срок ответа истёк',
            dueAt: '2026-10-06T00:00:00.000Z',
            fit: null,
          },
        ]
      : [],
    followUps: hasReminderDue
      ? [
          {
            applicationId: 'app-interview-101',
            company: 'Яндекс Cloud',
            title: 'Senior Backend Architect',
            status: 'today' as const,
          },
        ]
      : [],
    sinceLastVisit: {
      since: '2026-10-01T00:00:00.000Z',
      items: [],
      newVacanciesCount: 0,
      applicationsWaitingOver7Days: 0,
      nearestInterview: null,
    },
    vacanciesPending: false,
  };
}

test.describe('B393 interview debrief and company reminder draft', () => {
  test.beforeEach(async () => {
    await mkdir('output/playwright/B393', { recursive: true });
  });

  test('completes debriefing, computes deadline and proposes polite company reminder draft on today screen', async ({
    page,
  }, testInfo) => {
    let reminderActive = false;

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockSignedInCabinet(page);

    // Mock applications list
    await page.route('**/api/v1/candidate/applications*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/candidate/applications') {
        const apps = INITIAL_APPLICATIONS.map((app) => ({
          ...app,
          ...(reminderActive
            ? {
                followUpDueAt: '2026-10-06T00:00:00.000Z',
                followUp: {
                  dueAt: '2026-10-06T00:00:00.000Z',
                  urgency: 'due' as const,
                  source: 'company_deadline' as const,
                  daysSinceContact: 3,
                },
              }
            : {}),
        }));
        return route.fulfill({ json: { data: apps } });
      }
      return route.fallback();
    });

    // Mock patch interview debrief endpoint
    await page.route('**/api/v1/candidate/applications/*/interviews/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        reminderActive = true;
        return route.fulfill({
          json: {
            data: {
              id: 'iv-101',
              applicationId: 'app-interview-101',
              round: 1,
              scheduledAt: '2026-10-02T12:00:00.000Z',
              prepStatus: 'ready',
            },
          },
        });
      }
      return route.fallback();
    });

    // Mock today endpoint
    await page.route('**/api/v1/candidate/today*', async (route) => {
      return route.fulfill({ json: { data: makeTodaySnapshot(reminderActive) } });
    });

    // Mock mark follow up sent
    await page.route('**/api/v1/candidate/applications/*/events*', async (route) => {
      if (route.request().method() === 'POST') {
        reminderActive = false;
        return route.fulfill({
          json: {
            data: {
              ...INITIAL_APPLICATIONS[0],
              followUp: {
                dueAt: '2026-10-06T00:00:00.000Z',
                urgency: 'sent',
                source: 'company_deadline',
                daysSinceContact: 0,
              },
            },
          },
        });
      }
      return route.fallback();
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    // 1. Открываем раздел «Отклики»
    const rail = page.locator('aside#career-rail nav');
    const mobile = page.locator('nav.career-mobile-nav');
    const nav = (await rail.isVisible()) ? rail : mobile;
    await nav.getByRole('button', { name: 'Отклики', exact: true }).click();

    // 2. Находим карточку отклика на этапе «Интервью»
    await expect(page.locator('.career-responses-board-wrap')).toBeVisible();
    const interviewCard = page
      .locator('.career-responses-card')
      .filter({ hasText: 'Яндекс Cloud' });
    await expect(interviewCard).toBeVisible();

    // 3. На карточке видна кнопка «Дебрифинг» рядом с «Подготовиться»
    const debriefBtn = interviewCard.getByRole('button', { name: 'Дебрифинг' });
    await expect(debriefBtn).toBeVisible();
    await debriefBtn.click();

    // 4. Открывается модальное окно «Итоги интервью»
    const debriefModal = page.locator('div[role="dialog"]').filter({ hasText: 'Итоги интервью' });
    await expect(debriefModal).toBeVisible();
    await expect(debriefModal).toContainText('Яндекс Cloud');

    // 5. Заполняем экспресс-форму
    // Ощущение
    await debriefModal.getByText('Хорошее', { exact: true }).click();

    // Трудные вопросы
    const questionsTextarea = debriefModal.locator('textarea');
    await questionsTextarea.fill(
      'Distributed consensus & Raft protocol в высоконагруженных очередях',
    );

    // Обещанный срок ответа: кликаем пресет «3 рабочих дня»
    await debriefModal.getByRole('button', { name: '3 рабочих дня' }).click();
    const dateInput = debriefModal.locator('input[type="date"]');
    await expect(dateInput).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

    // Скриншот модального окна дебрифинга
    if (testInfo.project.name === 'desktop-1440') {
      await page.screenshot({
        path: 'output/playwright/B393/interview-debrief-1440.png',
        fullPage: false,
      });
    } else if (testInfo.project.name === 'mobile-390') {
      await page.screenshot({
        path: 'output/playwright/B393/interview-debrief-390.png',
        fullPage: false,
      });
    }

    // Сохраняем дебрифинг
    await debriefModal.getByRole('button', { name: 'Сохранить дебрифинг' }).click();
    await expect(debriefModal).not.toBeVisible();

    // 6. Переходим на экран «Сегодня»
    await nav.getByRole('button', { name: 'Сегодня', exact: true }).click();
    await expect(page.locator('.career-today')).toBeVisible();

    // 7. Проверяем появление напоминания компании в очереди
    const queueItem = page.locator('.career-today-item').filter({ hasText: 'Яндекс Cloud' });
    await expect(queueItem).toBeVisible();
    await expect(queueItem).toContainText('Напоминание компании');

    // Кнопка «Черновик напоминания»
    const draftBtn = queueItem.getByRole('button', { name: 'Черновик напоминания' });
    await expect(draftBtn).toBeVisible();

    // 8. Открываем модальное окно черновика напоминания компании
    await draftBtn.click();
    const reminderModal = page
      .locator('div[role="dialog"]')
      .filter({ hasText: 'Напоминание компании' });
    await expect(reminderModal).toBeVisible();

    // Проверяем черновик: вежливое напоминание, упоминание компании и позиции
    const reminderTextarea = reminderModal.locator('textarea');
    await expect(reminderTextarea).toBeVisible();
    const draftContent = await reminderTextarea.inputValue();
    expect(draftContent).toContain('Яндекс Cloud');
    expect(draftContent).toContain('Senior Backend Architect');
    expect(draftContent).toContain('уточнить статус');
    expect(draftContent.toLowerCase()).not.toContain('follow-up');

    // Проверяем пояснение об отсутствии автоотправки
    await expect(reminderModal).toContainText(
      'OpenQareer не отправляет сообщения без вашего ведома',
    );

    // Проверяем кнопку копирования
    const copyBtn = reminderModal.getByRole('button', { name: 'Скопировать черновик' });
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(reminderModal.getByText('Скопировано')).toBeVisible();

    // Скриншот черновика напоминания компании
    if (testInfo.project.name === 'desktop-1440') {
      await page.screenshot({
        path: 'output/playwright/B393/reminder-draft-1440.png',
        fullPage: false,
      });
    } else if (testInfo.project.name === 'mobile-390') {
      // Проверяем отсутствие горизонтального переполнения на 390
      const isOverflowing = await page.evaluate(() => {
        const docEl = document.documentElement;
        return docEl.scrollWidth > docEl.clientWidth;
      });
      expect(isOverflowing).toBe(false);

      await page.screenshot({
        path: 'output/playwright/B393/reminder-draft-390.png',
        fullPage: false,
      });
    }

    // 9. Нажимаем «Отметить отправленным»
    await reminderModal.getByRole('button', { name: 'Отметить отправленным' }).click();
    await expect(reminderModal).not.toBeVisible();
  });
});

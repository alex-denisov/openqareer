import { expect, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { mockAdaptation } from './adaptationFixture';

const RESPONSES = [
  {
    id: 'a1',
    clusterId: 'cl-bank',
    stage: 'applied',
    createdAt: '2026-11-12T09:00:00.000Z',
    appliedAt: '2026-11-12T09:00:00.000Z',
    offer: null,
    vacancy: { title: 'Руководитель разработки', company: 'Вектор Банк', url: '', source: 'hh' },
  },
  {
    id: 'a2',
    clusterId: 'cl-tel',
    stage: 'applied',
    createdAt: '2026-11-05T09:00:00.000Z',
    appliedAt: '2026-11-05T09:00:00.000Z',
    offer: null,
    vacancy: { title: 'Технический директор', company: 'Вектор Телеком', url: '', source: 'hh' },
  },
];
export const DUTIES = [
  'Руководить командой разработки из 25 человек: найм, рост, оценка.',
  'Выстроить поставку: релиз раз в две недели.',
];

export const STEPS = [
  {
    title: 'Познакомиться с командой один на один',
    description: 'Встречи с каждым из 25 человек.',
    stage: 'days_1_30',
    category: 'people',
    basis: DUTIES[0],
  },
  {
    title: 'Разобрать, где теряется время поставки',
    description: 'Путь задачи от идеи до релиза.',
    stage: 'days_31_60',
    category: 'delivery',
    basis: DUTIES[1],
  },
  {
    title: 'Выпустить первый релиз по двухнедельному циклу',
    description: 'Релиз в срок.',
    stage: 'days_61_90',
    category: 'delivery',
    basis: DUTIES[1],
  },
];

export interface StartCalls {
  readonly created: unknown[];
  readonly plans: unknown[];
}

/** d01g: места работы нет; отклики, текст вакансии и шаги плана из обязанностей. */
export async function openStart(page: Page): Promise<StartCalls> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await mockAdaptation(page);
  const created: unknown[] = [];
  const plans: unknown[] = [];
  await page.route('**/api/v1/candidate/career-diary', (route) =>
    route.fulfill({ json: { data: { asOf: '2026-11-19', primaryWorkplace: null, summary: {} } } }),
  );
  await page.route('**/api/v1/candidate/career-diary/workplaces', (route) => {
    created.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: { data: { id: 'w9', ...(route.request().postDataJSON() as object) } },
    });
  });
  await page.route('**/api/v1/candidate/career-diary/workplaces/w9/adaptation-steps', (route) =>
    route.fulfill({ json: { data: { steps: STEPS } } }),
  );
  await page.route('**/api/v1/candidate/career-diary/workplaces/w9', (route) => {
    plans.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: { id: 'w9' } } });
  });
  await page.route('**/api/v1/candidate/applications?**', (route) =>
    route.fulfill({ json: { data: RESPONSES, meta: { total: 2, offset: 0, limit: 100 } } }),
  );
  await page.route('**/api/v1/candidate/vacancies/cl-bank/detail', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 'cl-bank',
          description: '',
          truncated: false,
          skills: [],
          responsibilities: DUTIES,
        },
      },
    }),
  );
  await page.goto('/app/diary/adaptation', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.b640 .page.gb-page[data-b640-node="d01"]')).toBeVisible({
    timeout: 15_000,
  });
  return { created, plans };
}

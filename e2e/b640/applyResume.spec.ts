import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { mockResponses } from './responsesFixture';

const claim = (value: string | boolean) => ({
  value,
  memoryId: 'm',
  sourceMessageIds: [],
  reviewFlags: [],
});

function place(
  id: string,
  employer: string,
  title: string,
  start: string,
  end: string | null,
  bullets: string[],
) {
  return {
    id,
    title: claim(title),
    employer: claim(employer),
    location: claim('Москва'),
    startDate: claim(start),
    endDate: end ? claim(end) : null,
    current: claim(!end),
    description: null,
    bullets: bullets.map(claim),
  };
}

/** Те же данные, что в макете o03. */
const DOCUMENT = {
  kind: 'master',
  targetRole: 'Head of Engineering',
  contact: {
    fullName: 'Марина Соколова',
    email: 'm.sokolova@mail.ru',
    phone: '+7 916 245-18-07',
    location: 'Москва',
    links: ['https://linkedin.com/in/msokolova'],
  },
  about: null as string | null,
  experience: [
    place('1', 'Финтех Лаб', 'Руководитель группы разработки', '2021', null, [
      'Команда из 9 человек, 6 из них наняла сама',
      'Релиз раз в 3 дня вместо 2 недель',
      'Перевела платформу на Kubernetes без остановки сервиса, 2024',
      'Вела бэкенд и релизный процесс платформы',
      'Стек команды: Go, Kotlin, PostgreSQL',
    ]),
    place('2', 'Сфера Платежи', 'Руководитель группы бэкенда', '2018', '2021', [
      'Вела бэкенд платёжного шлюза для интернет-магазинов',
      'Отвечала за надёжность шлюза и дежурства группы',
      'Подключала новые способы оплаты по запросам магазинов',
    ]),
    place('3', 'Городские сервисы', 'Ведущий разработчик', '2016', '2018', [
      'Сервис оплаты парковок: от прототипа до 40 тыс. платежей в день',
      'Команда из 4 разработчиков',
    ]),
    place('4', 'Ритейл Тех', 'Разработчик', '2015', '2016', [
      'Мобильный бэкенд программы лояльности',
      'Интеграция с кассами магазинов сети',
    ]),
    place('5', 'Студия Код', 'Младший разработчик', '2014', '2015', [
      'Сайты и интеграции для клиентов студии',
    ]),
  ],
  education: [
    {
      id: 'd',
      institution: claim('МГТУ им. Баумана'),
      qualification: claim('Информатика и системы управления'),
      startDate: null,
      endDate: claim('2014'),
    },
  ],
  skills: ['Kubernetes', 'Go', 'PostgreSQL', 'Kotlin', 'найм и развитие команды'].map((name) => ({
    id: name,
    name,
  })),
  languages: [] as object[],
  unknowns: [],
};

const FULL = {
  ...DOCUMENT,
  about: 'Руковожу платформой 8 лет',
  languages: [{ id: 'l', name: claim('Английский'), cefr: claim('C1') }],
};

async function open(page: Page, document: object) {
  await mockResponses(page);
  await page.route('**/api/v1/candidate/vacancies/*/letter-approvals/latest', (route) =>
    route.fulfill({ json: { data: { approval: null } } }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/letter-resume', (route) =>
    route.fulfill({ json: { data: { ready: true, versionId: 'v-1' } } }),
  );
  await page.route('**/api/v1/candidate/resume/versions/v-1', (route) =>
    route.fulfill({
      json: {
        data: {
          version: { id: 'v-1', title: 'Head of Engineering', revision: 1, snapshot: { document } },
          currentMasterRevision: 'r',
        },
      },
    }),
  );
  await page.goto('/app/responses/a-draft/letter?step=resume', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('article', { name: 'Резюме' })).toBeVisible({ timeout: 15_000 });
}

test.describe('B785: шаг «Резюме» по макету o03', () => {
  test('лист, шаблон и скачивание PDF и DOCX', async ({ page }) => {
    const sent: Array<{ format: string; template: string; resume: Record<string, unknown> }> = [];
    await open(page, FULL);
    await page.route('**/api/v1/candidate/resume-builder/export', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ body: 'file', contentType: 'application/octet-stream' });
    });
    const sheet = page.getByRole('article', { name: 'Резюме' });
    await expect(sheet).toContainText('Руковожу платформой 8 лет');
    await expect(sheet).toContainText('Английский (C1)');
    await expect(sheet).toContainText('2021 — сейчас');
    await expectGates(page);
    await page.getByLabel('Шаблон резюме').selectOption('modern');
    await expect(sheet).toHaveClass(/cv-modern/u);
    for (const name of ['PDF', 'DOCX']) {
      await page.getByRole('button', { name: 'Скачать' }).click();
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name }).click();
      expect((await download).suggestedFilename()).toBe(`Марина Соколова.${name.toLowerCase()}`);
      await expect(page.getByRole('button', { name: 'Скачать' })).toBeEnabled();
    }
    expect(sent.map((item) => [item.format, item.template])).toEqual([
      ['pdf', 'modern'],
      ['docx', 'modern'],
    ]);
    expect(sent[0]?.resume).toMatchObject({ about: FULL.about, languages: 'Английский (C1)' });
  });

  test('меню закрывается по Esc, ошибка файла видна', async ({ page }) => {
    await open(page, FULL);
    await page.route('**/api/v1/candidate/resume-builder/export', (route) =>
      route.fulfill({ status: 500, json: { error: { message: 'Сборщик файла занят.' } } }),
    );
    const button = page.getByRole('button', { name: 'Скачать' });
    await button.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'PDF' })).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    await expect(page.getByText('Сборщик файла занят.')).toBeVisible();
  });
});

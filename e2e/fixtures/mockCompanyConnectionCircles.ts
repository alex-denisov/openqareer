import type { Page } from '@playwright/test';
import type {
  ConnectionCirclePath,
  ConnectionCirclePerson,
  ConnectionCircleResult,
  VacancyConnectionCircles,
} from '../../src/features/vacancies/vacancyLetterApi';

function person(
  id: string,
  fullName: string,
  roleTitle: string | null,
  companyName: string,
): ConnectionCirclePerson {
  return { id, fullName, roleTitle, companyName };
}

function path(
  id: string,
  circle: ConnectionCirclePath['circle'],
  recipient: ConnectionCirclePerson,
  contacts: readonly ConnectionCirclePerson[],
  evidence: readonly string[],
  strength: ConnectionCirclePath['strength'],
  nextStep: ConnectionCirclePath['nextStep'],
): ConnectionCirclePath {
  return {
    id,
    circle,
    recipient,
    path: contacts,
    evidence,
    strength,
    source: circle === 3 ? 'cold' : 'linkedin_import',
    nextStep,
  };
}

function circle(
  number: ConnectionCircleResult['circle'],
  message: string,
  paths: readonly ConnectionCirclePath[],
): ConnectionCircleResult {
  return { circle: number, state: paths.length ? 'available' : 'unknown', message, paths };
}

export function companyConnectionCircles(vacancyId: string): VacancyConnectionCircles {
  const company = 'Вектор Банк';
  const direct = path(
    'direct-maria',
    1,
    person('maria', 'Мария Орлова', 'Рекрутер', company),
    [],
    ['Писала вам 28.09'],
    'direct',
    'write_known_contact',
  );
  const introduction = path(
    'introduction-sergey',
    2,
    person('sergey', 'Сергей В.', 'Руководитель платежей', company),
    [person('dmitry', 'Дмитрий Козлов', 'Ведущий инженер', company)],
    ['Знаком с вашим контактом Игорем Н.'],
    'strong',
    'ask_for_introduction',
  );
  const cold = path(
    'cold-team',
    3,
    person('hiring-team', 'Команда найма', null, company),
    [],
    [],
    'unknown',
    'cold_application',
  );
  return {
    vacancyId,
    companyKey: 'synthetic-company-0',
    companyName: company,
    vacancyTitle: 'Head of Platform',
    circles: [
      circle(1, 'Можно написать знакомому напрямую.', [direct]),
      circle(2, 'Можно попросить представить через знакомого.', [introduction]),
      circle(3, 'Можно подготовить холодный отклик.', [cold]),
    ],
    linkedinImport: { state: 'imported', importedAt: '2026-10-08', importedCount: 412 },
  };
}

function vacancyDetail(vacancyId: string) {
  return {
    id: vacancyId,
    description: 'Факты и обязанности вакансии.',
    truncated: false,
    skills: [],
    responsibilities: [],
  };
}

function vacancyPitch(vacancyId: string) {
  return {
    vacancyId,
    emailPitch: { subject: 'Отклик', body: 'Текст для знакомства.' },
    linkedInNote: 'Текст для знакомства.',
    contactMessage: 'Текст для знакомства.',
    atsCoverLetter: 'Текст письма.',
    usedEvidenceIds: [],
    language: 'ru',
    generatedAt: '2026-10-14T12:00:00.000Z',
  };
}

function routeVacancyId(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split('/').at(-2) ?? '');
}

export async function mockCompanyConnectionCircles(page: Page): Promise<void> {
  await page.route('**/api/v1/candidate/vacancies/*/connection-circles', async (route) => {
    const vacancyId = routeVacancyId(route.request().url());
    await route.fulfill({ json: { data: companyConnectionCircles(vacancyId) } });
  });
  await page.route('**/api/v1/candidate/vacancies/*/detail', async (route) => {
    const vacancyId = routeVacancyId(route.request().url());
    await route.fulfill({ json: { data: vacancyDetail(vacancyId) } });
  });
  await page.route('**/api/v1/candidate/vacancies/*/pitch', async (route) => {
    const vacancyId = route.request().url().split('/').at(-2) ?? '';
    await route.fulfill({ json: { data: vacancyPitch(vacancyId) } });
  });
}

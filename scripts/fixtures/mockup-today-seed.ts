import type { CandidateStore } from '../../server/data/candidateStore';
import type { SqliteCandidateDraftRepository } from '../../server/candidate/sqliteCandidateDraftRepository';
import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';

/**
 * Local acceptance data that reproduces the approved «Сегодня» mockup (1-segodnya.html):
 * funnel 18 favorites / 7 delivered / 3 answers / 2 interviews / 0 offers, a cover-letter
 * draft for «Гринкод» and a LinkedIn post waiting for approval. Synthetic, loopback only:
 * no provider receipts are real, nothing is sent anywhere.
 */
type MockupSeedStore = Pick<
  CandidateStore,
  | 'createApplication'
  | 'patchApplication'
  | 'createApplicationInterview'
  | 'listApplications'
  | 'saveDocumentAndLinkApplicationMaterial'
>;

const FAVORITES = [
  'Сбер',
  'Т-Банк',
  'Озон',
  'Авито',
  'Яндекс',
  'Лаборатория Касперского',
  'Контур',
  'Тинькофф Бизнес',
  'Альфа-Банк',
  'ВТБ',
  'МТС',
  'Самокат',
  'Купер',
  'Додо',
  'Циан',
  'Хэдхантер',
];
const DELIVERED = [
  'Норд Софт',
  'Платформа Ру',
  'Сфера Платежи',
  'Нордлайн Финтех',
  'Бета Лабс',
  'Финтех Груп',
  'Стрела',
];

function vacancy(company: string, title = 'Head of Engineering'): VacancyApplicationSnapshot {
  const slug = encodeURIComponent(company.toLowerCase().replace(/\s+/gu, '-'));
  return { title, company, source: 'other', url: `https://example.test/jobs/${slug}` };
}

function daysAgo(now: Date, days: number, hourUtc = 9): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

function seedFavorites(store: MockupSeedStore, candidateId: string, now: Date): void {
  FAVORITES.forEach((company, index) => {
    store.createApplication(candidateId, {
      clusterId: `mockup-favorite-${index}`,
      manualVacancy: vacancy(company, 'CTO'),
      stage: 'saved',
      occurredAt: daysAgo(now, 2 + index),
    });
  });
}

function seedDelivered(store: MockupSeedStore, candidateId: string, now: Date): void {
  DELIVERED.forEach((company, index) => {
    const created = store.createApplication(candidateId, {
      clusterId: `mockup-delivered-${index}`,
      manualVacancy: vacancy(company),
      stage: 'saved',
      occurredAt: daysAgo(now, 20 - index),
    });
    let current = store.patchApplication(candidateId, created.id, {
      expectedVersion: created.version,
      stage: 'applied',
      occurredAt: daysAgo(now, 18 - index),
      deliveryReceipt: {
        kind: 'confirmation_url',
        value: `https://example.test/receipts/${index}`,
      },
    });
    if (index === 0) {
      current = store.patchApplication(candidateId, current.id, {
        expectedVersion: current.version,
        stage: 'interview',
        occurredAt: daysAgo(now, 12),
      });
      for (const [round, ago] of [
        [1, 10],
        [2, 5],
      ] as const) {
        store.createApplicationInterview(candidateId, current.id, {
          round,
          scheduledAt: daysAgo(now, ago, 11),
          format: 'video',
        });
      }
    }
    if (index === 1) {
      current = store.patchApplication(candidateId, current.id, {
        expectedVersion: current.version,
        stage: 'responded',
        occurredAt: daysAgo(now, 7),
      });
    }
    // В макете просрочено одно напоминание («Вектор Банк»); у остальных срок ещё впереди.
    store.patchApplication(candidateId, current.id, {
      expectedVersion: current.version,
      followUpDueAt: daysAgo(now, -5 - index),
    });
  });
}

function seedGreencodeLetter(store: MockupSeedStore, candidateId: string): void {
  const greencode = store
    .listApplications(candidateId)
    .find((application) => application.vacancy?.company === 'Гринкод');
  if (!greencode) return;
  const text = 'Черновик сопроводительного письма в «Гринкод». Не отправлен.';
  store.saveDocumentAndLinkApplicationMaterial(candidateId, greencode.id, 'cover_letter', {
    kind: 'cover_letter',
    source: 'generated',
    fileName: 'greencode-letter.txt',
    mimeType: 'text/plain',
    contentBase64: Buffer.from(text, 'utf8').toString('base64'),
    extractedText: text,
    parseStatus: 'not_applicable',
  });
}

export function seedMockupToday(
  store: MockupSeedStore,
  drafts: Pick<SqliteCandidateDraftRepository, 'create'>,
  candidateId: string,
  now = new Date(),
): void {
  seedFavorites(store, candidateId, now);
  seedDelivered(store, candidateId, now);
  seedGreencodeLetter(store, candidateId);
  drafts.create({
    candidateId,
    kind: 'post',
    topic: 'о миграции платформы',
    text: 'Как мы перенесли платёжную платформу без простоя: три решения и одна ошибка.',
    localDate: now.toISOString().slice(0, 10),
  });
}

/**
 * «Профиль готов на 73 %: 3 действия» (8 из 11 блоков): рекомендация и достижение есть,
 * контактов, курсов и сертификатов нет. Даты «Маркет Софт» остаются, как в макете «Профиля».
 */
export function mockupResumeDraft<T extends object>(draft: T): T {
  return {
    ...draft,
    recommendations: [
      {
        id: 'mockup-recommendation',
        author: 'Ирина Котова',
        position: 'CTO, Финтех Лаб',
        text: 'Собрал платформенную команду и вывел релизы на еженедельный цикл.',
      },
    ],
    achievements: [
      {
        id: 'mockup-achievement',
        kind: 'publication',
        title: 'Доклад «Платёжная платформа без простоя», HighLoad++',
      },
    ],
  };
}

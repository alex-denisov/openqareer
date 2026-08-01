import { z } from 'zod';

export const germanyMarketSubmissionSchema = z.object({
  workAuthorization: z.enum([
    'eu-eea-swiss',
    'german-permit',
    'none',
    'unknown',
  ]),
  jobOffer: z.enum(['yes', 'no', 'in-progress']),
  grossAnnualSalaryEur: z.number().int().min(0).max(2_000_000).nullable(),
  offerDurationMonths: z.number().int().min(1).max(120).nullable(),
  qualification: z.enum([
    'recognized-comparable',
    'state-recognized-origin',
    'none',
    'unknown',
  ]),
  professionRegulation: z.enum([
    'regulated-authorized',
    'regulated-unresolved',
    'non-regulated',
    'unknown',
  ]),
  blueCardBand: z.enum(['general', 'reduced', 'unknown']),
  fundsMonthlyEur: z.number().int().min(0).max(100_000).nullable(),
  languageEvidence: z.enum([
    'german-a1-plus',
    'english-b2-plus',
    'both',
    'below',
    'unknown',
  ]),
  relocationReadiness: z.enum(['ready', 'exploring', 'not-ready']),
  dependants: z.enum(['none', 'partner', 'children', 'partner-and-children']),
  targetWorkMode: z.enum(['onsite', 'hybrid', 'remote-from-germany']),
});

export type GermanyMarketSubmission = z.infer<
  typeof germanyMarketSubmissionSchema
>;

export type GermanyRouteId =
  | 'existing-work-authorisation'
  | 'eu-blue-card'
  | 'opportunity-card'
  | 'qualification-recognition';

type RouteStatus =
  | 'strong-signal'
  | 'possible-needs-check'
  | 'blocked'
  | 'not-applicable';

interface OfficialSource {
  title: string;
  url: string;
  publisher: string;
  reviewedAt: '2026-08-01';
}

interface GermanyRoute {
  id: GermanyRouteId;
  status: RouteStatus;
  title: string;
  summary: string;
  evidence: string[];
  missingEvidence: string[];
  threshold: {
    amountEur: number;
    cadence: 'annual' | 'monthly';
    validForYear: 2026;
  } | null;
  sourceIds: string[];
}

export interface GermanyMarketResult {
  country: 'DE';
  packVersion: 'DE-2026.1';
  packStatus: 'current' | 'stale';
  reviewedAt: '2026-08-01';
  recommendedRouteId: GermanyRouteId | null;
  routes: GermanyRoute[];
  globalMissingEvidence: string[];
  constraints: string[];
  sources: Record<string, OfficialSource>;
  caveat: string;
}

const SOURCES: Record<string, OfficialSource> = {
  blueCard: {
    title: 'EU Blue Card',
    url: 'https://www.make-it-in-germany.com/de/visum-aufenthalt/arten/blaue-karte-eu',
    publisher: 'Federal Government of Germany',
    reviewedAt: '2026-08-01',
  },
  opportunityCard: {
    title: 'Opportunity Card questions and answers',
    url: 'https://www.make-it-in-germany.com/en/visa-residence/opportunity-card/questions-answers',
    publisher: 'Federal Government of Germany',
    reviewedAt: '2026-08-01',
  },
  recognition: {
    title: 'Who needs recognition?',
    url: 'https://www.make-it-in-germany.com/en/working-in-germany/recognition/who-needs/print',
    publisher: 'Federal Government of Germany',
    reviewedAt: '2026-08-01',
  },
  visaPortal: {
    title: 'Visas for Germany',
    url: 'https://www.auswaertiges-amt.de/en/visa-service/215870-215870',
    publisher: 'German Federal Foreign Office',
    reviewedAt: '2026-08-01',
  },
  jobListings: {
    title: 'Official job listings',
    url: 'https://www.make-it-in-germany.com/en/working-in-germany/job-listings',
    publisher: 'Federal Government of Germany',
    reviewedAt: '2026-08-01',
  },
};

export function evaluateGermanyMarket(
  input: GermanyMarketSubmission,
  asOf: Date = new Date(),
): GermanyMarketResult {
  if (asOf.getUTCFullYear() !== 2026) {
    return staleResult();
  }
  const routes = [
    existingAuthorisationRoute(input),
    blueCardRoute(input),
    opportunityCardRoute(input),
    recognitionRoute(input),
  ];
  const strong = routes.find((route) => route.status === 'strong-signal');
  const opportunity = routes.find(
    (route) =>
      route.id === 'opportunity-card' &&
      route.status === 'possible-needs-check' &&
      route.missingEvidence.length === 0,
  );
  return {
    country: 'DE',
    packVersion: 'DE-2026.1',
    packStatus: 'current',
    reviewedAt: '2026-08-01',
    recommendedRouteId: strong?.id ?? opportunity?.id ?? null,
    routes: rankRoutes(routes),
    globalMissingEvidence: globalUnknowns(input),
    constraints: candidateConstraints(input),
    sources: SOURCES,
    caveat:
      'Это навигация по официальным правилам, а не юридическое решение, гарантия визы или обещание работодателя о sponsorship.',
  };
}

function existingAuthorisationRoute(
  input: GermanyMarketSubmission,
): GermanyRoute {
  const confirmed =
    input.workAuthorization === 'eu-eea-swiss' ||
    input.workAuthorization === 'german-permit';
  return route({
    id: 'existing-work-authorisation',
    title: 'Уже есть право на работу',
    status: confirmed
      ? 'strong-signal'
      : input.workAuthorization === 'unknown'
        ? 'possible-needs-check'
        : 'not-applicable',
    summary: confirmed
      ? 'Можно искать вакансии без отдельного маршрута въезда для этой работы; условия текущего документа всё равно нужно сверить.'
      : 'Маршрут появляется только при подтверждённом праве на работу в Германии.',
    evidence: confirmed ? ['Право на работу отмечено кандидатом'] : [],
    missingEvidence:
      input.workAuthorization === 'unknown'
        ? ['Подтвердить гражданство или действующий вид на жительство']
        : [],
    sourceIds: ['visaPortal'],
  });
}

function blueCardRoute(input: GermanyMarketSubmission): GermanyRoute {
  if (input.jobOffer === 'no') {
    return route({
      id: 'eu-blue-card',
      title: 'EU Blue Card',
      status: 'not-applicable',
      summary: 'Для проверки Blue Card сначала нужно конкретное предложение квалифицированной работы.',
      missingEvidence: ['Получить конкретное предложение работы'],
      sourceIds: ['blueCard'],
    });
  }
  const threshold = input.blueCardBand === 'reduced' ? 45_934.2 : 50_700;
  const missing = blueCardMissingEvidence(input, threshold);
  const evidence = [
    ...(input.grossAnnualSalaryEur === null
      ? []
      : [`Предложение: €${formatEur(input.grossAnnualSalaryEur)} брутто в год`]),
    ...(input.offerDurationMonths === null
      ? []
      : [`Срок предложения: ${input.offerDurationMonths} мес.`]),
    ...(input.qualification === 'recognized-comparable'
      ? ['Сопоставимость квалификации отмечена кандидатом']
      : []),
  ];
  return route({
    id: 'eu-blue-card',
    title: 'EU Blue Card',
    status: missing.length === 0 ? 'strong-signal' : 'possible-needs-check',
    summary: 'Маршрут для квалифицированной работы с предложением, подходящей квалификацией и годовым порогом зарплаты.',
    evidence,
    missingEvidence: missing,
    threshold: { amountEur: threshold, cadence: 'annual', validForYear: 2026 },
    sourceIds: ['blueCard', 'recognition', 'visaPortal'],
  });
}

function blueCardMissingEvidence(
  input: GermanyMarketSubmission,
  threshold: number,
): string[] {
  return [
    ...(input.jobOffer !== 'yes' ? ['Подписанное предложение работы'] : []),
    ...(input.grossAnnualSalaryEur === null
      ? ['Годовая зарплата брутто']
      : input.grossAnnualSalaryEur < threshold
        ? [`Зарплата ниже проверяемого порога €${formatEur(threshold)}`]
        : []),
    ...(input.offerDurationMonths === null || input.offerDurationMonths < 6
      ? ['Срок предложения не менее 6 месяцев']
      : []),
    ...(input.qualification !== 'recognized-comparable'
      ? ['Сопоставимость квалификации или отдельная проверка IT-исключения']
      : []),
    ...(input.professionRegulation === 'regulated-unresolved' ||
    input.professionRegulation === 'unknown'
      ? ['Статус регулирования профессии и необходимая лицензия']
      : []),
    ...(input.blueCardBand === 'unknown'
      ? ['Подтвердить общий или сниженный зарплатный порог']
      : []),
  ];
}

function opportunityCardRoute(input: GermanyMarketSubmission): GermanyRoute {
  if (input.jobOffer !== 'no') {
    return route({
      id: 'opportunity-card',
      title: 'Opportunity Card',
      status: 'not-applicable',
      summary: 'Этот сценарий предназначен прежде всего для поиска без полноценного предложения работы.',
      sourceIds: ['opportunityCard'],
    });
  }
  const missing = [
    ...(input.qualification === 'none' || input.qualification === 'unknown'
      ? ['Подтверждение квалификации для skilled-worker или points route']
      : []),
    ...(input.fundsMonthlyEur === null
      ? ['Подтверждение средств на проживание']
      : input.fundsMonthlyEur < 1_091
        ? ['Средства ниже ориентира €1 091 в месяц']
        : []),
    ...(input.qualification !== 'recognized-comparable' &&
    (input.languageEvidence === 'below' || input.languageEvidence === 'unknown')
      ? ['Языковое подтверждение для points route']
      : []),
  ];
  return route({
    id: 'opportunity-card',
    title: 'Opportunity Card',
    status: missing.length === 0 ? 'possible-needs-check' : 'blocked',
    summary: 'Маршрут для ограниченного по времени поиска работы в Германии без готового предложения.',
    evidence:
      input.fundsMonthlyEur === null
        ? []
        : [`Доступно на проживание: €${formatEur(input.fundsMonthlyEur)} в месяц`],
    missingEvidence: missing,
    threshold: { amountEur: 1_091, cadence: 'monthly', validForYear: 2026 },
    sourceIds: ['opportunityCard', 'visaPortal'],
  });
}

function recognitionRoute(input: GermanyMarketSubmission): GermanyRoute {
  const unresolved = input.professionRegulation === 'regulated-unresolved';
  const unknown = input.professionRegulation === 'unknown';
  return route({
    id: 'qualification-recognition',
    title: 'Проверка признания квалификации',
    status: unresolved ? 'blocked' : unknown ? 'possible-needs-check' : 'not-applicable',
    summary: 'Для регулируемых профессий признание и разрешение на практику обычно являются отдельным обязательным шагом.',
    missingEvidence: unresolved || unknown
      ? ['Проверить профессию и компетентный орган в Recognition Finder']
      : [],
    sourceIds: ['recognition'],
  });
}

function route(input: {
  id: GermanyRouteId;
  title: string;
  status: RouteStatus;
  summary: string;
  evidence?: string[];
  missingEvidence?: string[];
  threshold?: GermanyRoute['threshold'];
  sourceIds: string[];
}): GermanyRoute {
  return {
    ...input,
    evidence: input.evidence ?? [],
    missingEvidence: input.missingEvidence ?? [],
    threshold: input.threshold ?? null,
  };
}

function rankRoutes(routes: GermanyRoute[]): GermanyRoute[] {
  const priority: Record<RouteStatus, number> = {
    'strong-signal': 0,
    'possible-needs-check': 1,
    blocked: 2,
    'not-applicable': 3,
  };
  return [...routes].sort((left, right) => priority[left.status] - priority[right.status]);
}

function globalUnknowns(input: GermanyMarketSubmission): string[] {
  return [
    ...(input.workAuthorization === 'unknown' ? ['Текущее право на работу'] : []),
    ...(input.relocationReadiness === 'exploring' ? ['Срок готовности к переезду'] : []),
    ...(input.relocationReadiness === 'not-ready' ? ['Условия, при которых переезд станет возможен'] : []),
  ];
}

function candidateConstraints(input: GermanyMarketSubmission): string[] {
  return [
    `Формат: ${input.targetWorkMode}`,
    `Переезд: ${input.relocationReadiness}`,
    ...(input.dependants === 'none' ? [] : [`Семейный контур: ${input.dependants}`]),
  ];
}

function staleResult(): GermanyMarketResult {
  return {
    country: 'DE',
    packVersion: 'DE-2026.1',
    packStatus: 'stale',
    reviewedAt: '2026-08-01',
    recommendedRouteId: null,
    routes: [],
    globalMissingEvidence: ['Обновить официальный rule pack для текущего года'],
    constraints: [],
    sources: SOURCES,
    caveat: 'Правила устарели: сервис не делает вывод до повторной проверки официальных источников.',
  };
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

import type { RoleMarketMap } from '../career-map/roleMarketMap';
import type {
  CareerDiagnostic,
  DiagnosticDimension,
} from '../diagnostic/careerDiagnostic';

const CAREER_ACTION_POLICY_REVISION =
  'career-action-policy-v1-2026-08-07' as const;

export interface ReasonedCareerAction {
  revision: typeof CAREER_ACTION_POLICY_REVISION;
  type: 'question' | 'review' | 'research' | 'decision' | 'execute';
  destination: 'coach' | 'profile' | 'evidence' | 'career' | 'search';
  headline: string;
  label: string;
  rationale: string;
  expectedChange: string;
  findingIds: string[];
  roleIds: string[];
  marketIds: string[];
  alternatives: Array<{
    id: string;
    label: string;
    destination: 'coach' | 'profile' | 'evidence' | 'career' | 'search';
  }>;
  approvalBoundary: string;
}

export function buildReasonedCareerAction(input: {
  diagnostic: CareerDiagnostic;
  roleMarketMap: RoleMarketMap | null;
  constraints?: string;
}): ReasonedCareerAction {
  const { diagnostic, roleMarketMap } = input;
  const finding = diagnostic.findings.find(
    (item) => item.id === diagnostic.nextAction.findingIds[0],
  );
  const coldOutreachIsUncomfortable =
    /не\s+(?:хочу|могу|готов).{0,24}(?:холод|незнаком)|стесня|cold outreach/iu.test(
      input.constraints ?? '',
    );
  const alternatives = [
    ...(coldOutreachIsUncomfortable
      ? [
          {
            id: 'referral-first',
            label: 'Выбрать реферальный или тёплый маршрут',
            destination: 'career' as const,
          },
        ]
      : []),
    {
      id: 'correct-premise',
      label: 'Исправить исходные данные',
      destination: 'profile' as const,
    },
    {
      id: 'discuss-first',
      label: 'Сначала обсудить с экспертом',
      destination: 'coach' as const,
    },
  ];

  if (
    diagnostic.nextAction.type === 'question' &&
    (diagnostic.coverage.sourceKinds.includes('conversation') || !finding)
  ) {
    return action({
      type: 'question',
      destination: 'coach',
      headline: 'Определим, что вы ищете',
      label: 'Ответить на один вопрос',
      rationale: diagnostic.nextAction.reason,
      expectedChange:
        'Ответ задаст рабочее направление, не превращая его в окончательное решение.',
      alternatives,
    });
  }

  if (finding) {
    const dimension = finding.dimension;
    return action({
      type: diagnostic.nextAction.type,
      destination: destinationFor(dimension),
      headline: headlineFor(dimension),
      label: labelFor(dimension),
      rationale: diagnostic.nextAction.reason,
      expectedChange: expectedChangeFor(dimension),
      findingIds: [finding.id],
      roleIds: roleMarketMap?.roles.map((role) => role.id) ?? [],
      marketIds: roleMarketMap?.markets.map((market) => market.id) ?? [],
      alternatives,
    });
  }

  if (roleMarketMap && roleMarketMap.roles.length > 1) {
    return action({
      type: 'decision',
      destination: 'career',
      headline: 'Выберем рабочую карьерную гипотезу',
      label: 'Сравнить роли',
      rationale:
        'Несколько ролей опираются на доступные факты; нужен обратимый выбор перед поисковой кампанией.',
      expectedChange:
        'Одна роль станет основной для проверки рынка, остальные сохранятся как альтернативы.',
      roleIds: roleMarketMap.roles.map((role) => role.id),
      marketIds: roleMarketMap.markets.map((market) => market.id),
      alternatives,
    });
  }

  return action({
    type: 'execute',
    destination: 'search',
    headline: 'Проверим маршрут на одной вакансии',
    label: 'Добавить вакансию',
    rationale:
      'Данных достаточно для небольшого проверяемого шага, но ещё не для массовой кампании.',
    expectedChange:
      'Реальная вакансия покажет совпадения, пробелы и лучший канал контакта.',
    roleIds: roleMarketMap?.roles.map((role) => role.id) ?? [],
    marketIds: roleMarketMap?.markets.map((market) => market.id) ?? [],
    alternatives,
    approvalBoundary:
      'openqareer подготовит действие, но отправка во внешний сервис требует отдельного согласия кандидата.',
  });
}

function action(
  value: Omit<
    ReasonedCareerAction,
    | 'revision'
    | 'approvalBoundary'
    | 'findingIds'
    | 'roleIds'
    | 'marketIds'
  > &
    Partial<
      Pick<ReasonedCareerAction, 'findingIds' | 'roleIds' | 'marketIds'>
    > & {
    approvalBoundary?: string;
  },
): ReasonedCareerAction {
  return {
    revision: CAREER_ACTION_POLICY_REVISION,
    findingIds: [],
    roleIds: [],
    marketIds: [],
    approvalBoundary:
      'Профиль, карьерная гипотеза или внешний шаг меняются только после согласования кандидата.',
    ...value,
  };
}

function destinationFor(
  dimension: DiagnosticDimension,
): ReasonedCareerAction['destination'] {
  return ({
    readability: 'profile',
    ats: 'profile',
    evidence: 'evidence',
    freshness: 'profile',
    contradictions: 'evidence',
    market: 'career',
  } satisfies Record<DiagnosticDimension, ReasonedCareerAction['destination']>)[
    dimension
  ];
}

function headlineFor(dimension: DiagnosticDimension): string {
  return {
    readability: 'Добавим полный источник',
    ats: 'Проверим оформление резюме',
    evidence: 'Подтвердим сильный результат',
    freshness: 'Обновим карьерную историю',
    contradictions: 'Сверим источники',
    market: 'Проверим роль на рынке',
  }[dimension];
}

function labelFor(dimension: DiagnosticDimension): string {
  return {
    readability: 'Дополнить профиль',
    ats: 'Проверить документ',
    evidence: 'Проверить факты',
    freshness: 'Обновить профиль',
    contradictions: 'Сверить факты',
    market: 'Открыть карьерную карту',
  }[dimension];
}

function expectedChangeFor(dimension: DiagnosticDimension): string {
  return {
    readability: 'Полный источник откроет недостающие даты, задачи и результаты.',
    ats: 'Проверка покажет, сохраняется ли порядок чтения исходного документа.',
    evidence: 'Подтверждённый результат усилит или изменит гипотезы ролей.',
    freshness: 'Свежая история отделит актуальный опыт от устаревших формулировок.',
    contradictions: 'Сверка отделит ошибку источника от реального изменения карьеры.',
    market: 'Датированная выборка покажет спрос, уровень и ограничения каждого маршрута.',
  }[dimension];
}

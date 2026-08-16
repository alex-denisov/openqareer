import type {
  ConnectorAction,
  ConnectorExecutor,
  ConnectorReceipt,
  ConnectorRequest,
} from './connectorHarness';

export type JobPlatformId =
  | 'linkedin'
  | 'hh'
  | 'indeed'
  | 'glassdoor'
  | 'company_site';

export type PlatformCapabilityAction =
  | 'import_profile'
  | 'discover_jobs'
  | 'update_profile'
  | ConnectorAction;

export type PlatformCapabilityReadiness =
  | 'available_without_account'
  | 'credentials_required'
  | 'ready_for_test'
  | 'partner_access_required'
  | 'native_handoff';

type Environment = Record<string, string | undefined>;

interface CapabilityDefinition {
  platform: JobPlatformId;
  label: string;
  action: PlatformCapabilityAction;
  route:
    | 'candidate_export'
    | 'official_api'
    | 'public_http_parser'
    | 'browser_session'
    | 'native_handoff';
  credentialKeys: string[];
  baseReadiness: Exclude<
    PlatformCapabilityReadiness,
    'credentials_required' | 'ready_for_test'
  > | 'test_account';
  sourceUrl: string;
  note: string;
}

export interface PlatformCapability
  extends Omit<CapabilityDefinition, 'credentialKeys' | 'baseReadiness'> {
  readiness: PlatformCapabilityReadiness;
  configured: boolean;
  requiredCredentialKeys: string[];
}

const LINKEDIN_TEST_KEYS = [
  'OPENQAREER_LINKEDIN_TEST_USERNAME',
  'OPENQAREER_LINKEDIN_TEST_PASSWORD',
];
const HH_TEST_KEYS = [
  'OPENQAREER_HH_TEST_USERNAME',
  'OPENQAREER_HH_TEST_PASSWORD',
];

const DEFINITIONS: CapabilityDefinition[] = [
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    action: 'import_profile',
    route: 'candidate_export',
    credentialKeys: [],
    baseReadiness: 'available_without_account',
    sourceUrl:
      'https://www.linkedin.com/help/linkedin/answer/a1339364/downloading-your-account-data',
    note: 'Импорт собственного архива или PDF без передачи пароля.',
  },
  ...(['application', 'message', 'connection', 'referral_request'] as const).map(
    (action): CapabilityDefinition => ({
      platform: 'linkedin',
      label: 'LinkedIn',
      action,
      route: 'browser_session',
      credentialKeys: LINKEDIN_TEST_KEYS,
      baseReadiness: 'test_account',
      sourceUrl:
        'https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview',
      note:
        'Кандидатский маршрут не покрывается открытым partner API; только тестовая браузерная сессия с подтверждением результата.',
    }),
  ),
  {
    platform: 'hh',
    label: 'hh.ru',
    action: 'discover_jobs',
    route: 'official_api',
    credentialKeys: [],
    baseReadiness: 'available_without_account',
    sourceUrl: 'https://api.hh.ru/openapi/redoc',
    note: 'Публичный поиск вакансий через документированный API.',
  },
  ...(['import_profile', 'update_profile', 'application', 'message'] as const).map(
    (action): CapabilityDefinition => ({
      platform: 'hh',
      label: 'hh.ru',
      action,
      route: 'browser_session',
      credentialKeys: HH_TEST_KEYS,
      baseReadiness: 'test_account',
      sourceUrl: 'https://api.hh.ru/openapi/redoc',
      note:
        'Кандидатская browser-сессия проверяется по identity; действие разрешается только для точной цели и подтверждается receipt. Публичный OpenAPI остаётся read-only контуром вакансий.',
    }),
  ),
  {
    platform: 'indeed',
    label: 'Indeed',
    action: 'discover_jobs',
    route: 'native_handoff',
    credentialKeys: [],
    baseReadiness: 'partner_access_required',
    sourceUrl:
      'https://developer.indeed.com/public/pdf/indeed-apply/integration-review-checklist.pdf',
    note: 'Публичная интеграция построена вокруг партнёрского ATS-фида и ревью.',
  },
  {
    platform: 'indeed',
    label: 'Indeed',
    action: 'application',
    route: 'native_handoff',
    credentialKeys: [],
    baseReadiness: 'native_handoff',
    sourceUrl:
      'https://developer.indeed.com/public/pdf/indeed-apply/integration-review-checklist.pdf',
    note: 'До партнёрского доступа — подготовка материалов и подтверждаемый переход на native apply.',
  },
  {
    platform: 'glassdoor',
    label: 'Glassdoor',
    action: 'discover_jobs',
    route: 'native_handoff',
    credentialKeys: [],
    baseReadiness: 'native_handoff',
    sourceUrl: 'https://help.glassdoor.com/',
    note: 'Источник оценивается в рыночной выборке; кандидатское действие остаётся native handoff.',
  },
  {
    platform: 'company_site',
    label: 'Сайт работодателя',
    action: 'discover_jobs',
    route: 'public_http_parser',
    credentialKeys: [],
    baseReadiness: 'available_without_account',
    sourceUrl: 'https://developers.google.com/search/docs/appearance/structured-data/job-posting',
    note: 'Публичные career pages и JobPosting-разметка с фиксацией источника и даты.',
  },
  {
    platform: 'company_site',
    label: 'Сайт работодателя',
    action: 'application',
    route: 'browser_session',
    credentialKeys: [],
    baseReadiness: 'native_handoff',
    sourceUrl: 'https://developers.google.com/search/docs/appearance/structured-data/job-posting',
    note: 'Безопасный переход или отдельный проверенный адаптер под конкретную ATS-форму.',
  },
];

export function getPlatformCapabilityMatrix(
  environment: Environment = {},
): PlatformCapability[] {
  return DEFINITIONS.map((definition) => {
    const configured =
      definition.credentialKeys.length > 0 &&
      definition.credentialKeys.every(
        (key) => (environment[key] ?? '').trim().length > 0,
      );
    const readiness =
      definition.baseReadiness === 'test_account'
        ? configured
          ? 'ready_for_test'
          : 'credentials_required'
        : definition.baseReadiness;
    return {
      platform: definition.platform,
      label: definition.label,
      action: definition.action,
      route: definition.route,
      sourceUrl: definition.sourceUrl,
      note: definition.note,
      readiness,
      configured,
      requiredCredentialKeys: [...definition.credentialKeys],
    };
  });
}

export class DryRunPlatformConnector implements ConnectorExecutor {
  readonly transport = 'native_handoff' as const;
  readonly connectorId: string;

  constructor(readonly platform: JobPlatformId) {
    this.connectorId = `${platform}-dry-run`;
  }

  async execute(request: ConnectorRequest): Promise<ConnectorReceipt> {
    return Promise.resolve({
      connectorId: this.connectorId,
      transport: this.transport,
      action: request.action,
      status: 'native_handoff',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      evidence: null,
      diagnostic: {
        reason: 'dry_run_only',
      },
    });
  }
}

import type { LinkedinAccountPool } from './linkedinAccountPool';

export interface Adr009ActionRequest {
  readonly actionType: string;
  readonly targetPlatform: string;
  readonly isClientSession: boolean;
  readonly accountPool?: LinkedinAccountPool;
  readonly confirmRisk?: boolean;
}

export interface Adr009Decision {
  readonly allowed: boolean;
  readonly mode:
    | 'server_test_pool'
    | 'soft_safeguard_warning'
    | 'soft_safeguard_confirmed'
    | 'rejected';
  readonly riskLevel?: 'low' | 'medium' | 'high';
  readonly warnings: readonly string[];
  readonly mitigations: readonly string[];
  readonly mitigationsApplied: readonly string[];
  readonly requiresCandidateConsent: boolean;
}

const DEFAULT_STEALTH_MITIGATIONS: readonly string[] = [
  'random_human_jitter_8_to_35s',
  'obscura_stealth_fingerprint',
  'human_sleep_schedules',
  'rate_ceiling_10_actions_per_hour',
];

export function evaluateActionUnderAdr009(request: Adr009ActionRequest): Adr009Decision {
  // 1. Server-side public scraping under dedicated test account pool (ADR-009 rev. 2026-09-06)
  if (!request.isClientSession) {
    return {
      allowed: true,
      mode: 'server_test_pool',
      riskLevel: 'low',
      warnings: [],
      mitigations: [
        'obscura_stealth_flags',
        'account_pool_rotation',
        'cooldown_jitter',
      ],
      mitigationsApplied: [
        'obscura_stealth_flags',
        'account_pool_rotation',
        'cooldown_jitter',
      ],
      requiresCandidateConsent: false,
    };
  }

  // 2. Client account session on server (Soft Safeguard)
  const warnings: string[] = [
    `Платформа ${request.targetPlatform} детектирует автоматизацию серверных сессий и может запросить телефонный чекпоинт или ограничить доступ.`,
    'Рекомендуется выполнять отклики через локальное десктопное приложение OpenQareer.',
  ];

  if (!request.confirmRisk) {
    return {
      allowed: false,
      mode: 'soft_safeguard_warning',
      riskLevel: 'high',
      warnings,
      mitigations: DEFAULT_STEALTH_MITIGATIONS,
      mitigationsApplied: [],
      requiresCandidateConsent: true,
    };
  }

  // User/Owner confirmed risk: execute without hard blocks
  return {
    allowed: true,
    mode: 'soft_safeguard_confirmed',
    riskLevel: 'high',
    warnings,
    mitigations: DEFAULT_STEALTH_MITIGATIONS,
    mitigationsApplied: DEFAULT_STEALTH_MITIGATIONS,
    requiresCandidateConsent: true,
  };
}

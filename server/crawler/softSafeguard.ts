export interface Adr009ActionRequest {
  readonly actionType: string;
  readonly targetPlatform: string;
  readonly isClientSession: boolean;
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

export function evaluateActionUnderAdr009(request: Adr009ActionRequest): Adr009Decision {
  void request;
  const warnings: string[] = [
    'provider_permission_required: владелец проекта или подтверждение риска не заменяют разрешённый канал LinkedIn.',
    'Ручной вход и проверка сессии выполняются только в desktop controlled window.',
  ];
  return {
    allowed: false,
    mode: 'rejected',
    riskLevel: 'high',
    warnings,
    mitigations: [],
    mitigationsApplied: [],
    requiresCandidateConsent: false,
  };
}

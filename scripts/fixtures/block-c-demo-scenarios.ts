/** B510: state switches for the loopback-only block C demo; changed without a restart. */
export const BLOCK_C_SCENARIOS = [
  'default',
  'empty',
  'error',
  'slow',
  'no-saved',
  'few-data',
  'no-contacts',
] as const;

export type BlockCScenario = (typeof BLOCK_C_SCENARIOS)[number];
export type BlockCProfileKey = 'main' | 'empty' | 'noSaved' | 'fewData' | 'noContacts';
export type BlockCPoolDisposition = 'continue' | 'fail' | 'delay';

export const BLOCK_C_SLOW_MS = 5_000;

const PROFILE_BY_SCENARIO: Record<BlockCScenario, BlockCProfileKey> = {
  default: 'main',
  empty: 'empty',
  error: 'main',
  slow: 'main',
  'no-saved': 'noSaved',
  'few-data': 'fewData',
  'no-contacts': 'noContacts',
};

export type BlockCScenarioParseResult =
  | { readonly ok: true; readonly scenario: BlockCScenario }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function parseBlockCDemoScenarioCommand(raw: unknown): BlockCScenarioParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_block_c_scenario', message: 'Передайте объект сценария.' };
  }
  const command = raw as Record<string, unknown>;
  if (Object.keys(command).some((key) => key !== 'scenario')) {
    return {
      ok: false,
      code: 'invalid_block_c_scenario',
      message: 'Сценарий содержит неизвестное поле.',
    };
  }
  const scenario = BLOCK_C_SCENARIOS.find((name) => name === command.scenario);
  if (!scenario) {
    return {
      ok: false,
      code: 'invalid_block_c_scenario',
      message: `Сценарий должен быть одним из: ${BLOCK_C_SCENARIOS.join(', ')}.`,
    };
  }
  return { ok: true, scenario };
}

export class BlockCDemoScenarioController<P> {
  private scenario: BlockCScenario = 'default';

  constructor(private readonly profiles: Record<BlockCProfileKey, P>) {}

  get activeProfile(): P {
    return this.profiles[PROFILE_BY_SCENARIO[this.scenario]];
  }

  get state(): { readonly scenario: BlockCScenario; readonly profile: BlockCProfileKey } {
    return { scenario: this.scenario, profile: PROFILE_BY_SCENARIO[this.scenario] };
  }

  select(scenario: BlockCScenario): void {
    this.scenario = scenario;
  }

  /** What happens to a read of the candidate's matched pool under the active scenario. */
  poolDisposition(): BlockCPoolDisposition {
    if (this.scenario === 'error') return 'fail';
    if (this.scenario === 'slow') return 'delay';
    return 'continue';
  }
}

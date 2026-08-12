import type { CoachProvider } from '../providers/coachProvider';
import type { CareerRoleAgent } from './careerOrchestrator';

export interface CoachProviderRoleAgentOptions {
  provider: CoachProvider;
}

export class CoachProviderRoleAgent implements CareerRoleAgent {
  private readonly provider: CoachProvider;

  constructor(options: CoachProviderRoleAgentOptions) {
    this.provider = options.provider;
  }

  run(input: Parameters<CareerRoleAgent['run']>[0]) {
    return this.provider.createTurn(
      {
        ...input.input,
        activeRole: input.role,
        priorRoleContributions: input.priorContributions.map((item) => ({
          role: item.role,
          summary: item.summary,
          evidenceRefs: item.evidenceRefs,
          unknowns: item.unknowns,
        })),
      },
      input.idempotencyKey,
    );
  }
}

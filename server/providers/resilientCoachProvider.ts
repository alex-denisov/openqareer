import type { CoachTurnInput } from '../domain/coach';
import {
  CoachProviderError,
  type CoachProvider,
  type CoachProviderResult,
} from './coachProvider';
import type { ProviderId } from './modelRegistry';

interface ProviderRoute {
  id: ProviderId;
  provider: CoachProvider;
}

export interface ResilientCoachProviderOptions {
  routes: ProviderRoute[];
  maxAttempts?: number;
  cooldownMs?: number;
  now?: () => number;
}

type RoutingAttempt = NonNullable<CoachProviderResult['routing']>['attempts'][number];

export class ResilientCoachProvider implements CoachProvider {
  private readonly routes: ProviderRoute[];
  private readonly maxAttempts: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly coolingUntil = new Map<ProviderId, number>();

  constructor(options: ResilientCoachProviderOptions) {
    if (options.routes.length === 0) {
      throw new Error('at least one coach provider route is required');
    }
    this.routes = options.routes;
    this.maxAttempts = Math.min(
      Math.max(options.maxAttempts ?? options.routes.length, 1),
      options.routes.length,
    );
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<CoachProviderResult> {
    const attempts: RoutingAttempt[] = [];
    let executed = 0;
    let lastError: CoachProviderError | undefined;

    for (const route of this.routes) {
      const coolingUntil = this.coolingUntil.get(route.id) ?? 0;
      if (coolingUntil > this.now()) {
        attempts.push({
          provider: route.id,
          status: 'skipped',
          code: 'provider_cooldown',
        });
        continue;
      }
      if (executed >= this.maxAttempts) break;
      executed += 1;

      try {
        const output = await route.provider.createTurn(input, idempotencyKey);
        attempts.push({ provider: route.id, status: 'succeeded' });
        return {
          ...output,
          routing: {
            fallbackUsed: attempts.some(
              (attempt) => attempt.status !== 'succeeded',
            ),
            attempts,
          },
        };
      } catch (error) {
        if (!(error instanceof CoachProviderError)) throw error;
        lastError = error;
        attempts.push({
          provider: route.id,
          status: 'failed',
          code: error.code,
        });
        // Неповторяемый отказ раньше обрывал всю цепочку. На проде это стоило
        // хода коуча: провайдер отвергал наш контракт вывода (`400`), а
        // следующий маршрут, который ответил бы, даже не пробовали (B183). Пул
        // существует ровно для этого случая, поэтому идём дальше и поднимаем
        // ошибку только когда отказали все.
        this.coolingUntil.set(route.id, this.now() + this.cooldownMs);
      }
    }

    throw (
      lastError ??
      new CoachProviderError('provider_unavailable', 503, true)
    );
  }
}

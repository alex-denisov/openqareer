import type { CoachTurnInput } from '../domain/coach';
import {
  CoachProviderError,
  type CoachProvider,
  type CoachProviderResult,
  type CoachTurnOptions,
} from './coachProvider';
import type { ProviderId } from './modelRegistry';

interface ProviderRoute {
  id: ProviderId;
  /** Модель ступени: две ступени одного провайдера остывают независимо. */
  model?: string;
  provider: CoachProvider;
}

function routeKey(route: ProviderRoute): string {
  return `${route.id}:${route.model ?? ''}`;
}

/** Ступень в провенансе называет и провайдера, и модель: их две за одним. */
function attemptOf(
  route: ProviderRoute,
  status: 'succeeded' | 'failed' | 'skipped',
  code?: RoutingAttempt['code'],
): RoutingAttempt {
  return {
    provider: route.id,
    ...(route.model ? { model: route.model } : {}),
    status,
    ...(code ? { code } : {}),
  };
}

type RoutingAttempt = NonNullable<CoachProviderResult['routing']>['attempts'][number];

/** Попытка вместе с её временем — для журнала, не для сохранённого хода (28.10). */
export type TimedRoutingAttempt = RoutingAttempt & { readonly elapsedMs: number };

export interface ResilientCoachProviderOptions {
  routes: ProviderRoute[];
  maxAttempts?: number;
  cooldownMs?: number;
  now?: () => number;
  /** Сколько заняла каждая ступень: без этого время хода не раскладывалось по ступеням. */
  onAttempts?: (attempts: readonly TimedRoutingAttempt[]) => void;
}

export class ResilientCoachProvider implements CoachProvider {
  private readonly routes: ProviderRoute[];
  private readonly maxAttempts: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onAttempts: ResilientCoachProviderOptions['onAttempts'];
  private readonly coolingUntil = new Map<string, number>();

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
    this.onAttempts = options.onAttempts;
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
    options: CoachTurnOptions = {},
  ): Promise<CoachProviderResult> {
    const trace = new AttemptTrace(this.now);
    let executed = 0;
    let lastError: CoachProviderError | undefined;

    for (const route of this.routes) {
      if (this.isCooling(route)) {
        trace.add(attemptOf(route, 'skipped', 'provider_cooldown'));
        continue;
      }
      if (executed >= this.maxAttempts) break;
      const budgetMs = remainingBudget(options.deadlineAt, this.now());
      if (budgetMs !== undefined && budgetMs < MIN_STAGE_BUDGET_MS)
        return this.fail(trace, turnDeadlineError());
      executed += 1;
      const startedAt = this.now();

      try {
        const output = await withinBudget(
          route.provider.createTurn(input, idempotencyKey),
          budgetMs,
        );
        if (options.accept && !options.accept(output.result)) {
          // The route works; only this step cannot use its answer, so it is not cooled.
          lastError = new CoachProviderError('provider_output_invalid', 502, true);
          trace.add(attemptOf(route, 'failed', 'provider_output_invalid'), startedAt);
          continue;
        }
        trace.add(attemptOf(route, 'succeeded'), startedAt);
        this.onAttempts?.(trace.timed());
        return {
          ...output,
          routing: {
            fallbackUsed: trace.attempts.some((attempt) => attempt.status !== 'succeeded'),
            attempts: trace.attempts,
          },
        };
      } catch (error) {
        if (!(error instanceof CoachProviderError)) throw error;
        lastError = error;
        trace.add(attemptOf(route, 'failed', error.code), startedAt);
        // Ход исчерпал своё время — ступень тут ни при чём, её не остужаем.
        if (error.diagnostic === TURN_DEADLINE) continue;
        // Неповторяемый отказ раньше обрывал всю цепочку. На проде это стоило
        // хода коуча: провайдер отвергал наш контракт вывода (`400`), а
        // следующий маршрут, который ответил бы, даже не пробовали (B183). Пул
        // существует ровно для этого случая, поэтому идём дальше и поднимаем
        // ошибку только когда отказали все.
        this.coolingUntil.set(routeKey(route), this.now() + this.cooldownMs);
      }
    }

    return this.fail(trace, lastError);
  }

  private isCooling(route: ProviderRoute): boolean {
    return (this.coolingUntil.get(routeKey(route)) ?? 0) > this.now();
  }

  private fail(trace: AttemptTrace, lastError: CoachProviderError | undefined): never {
    this.onAttempts?.(trace.timed());
    throw allRoutesFailed(lastError, trace.attempts);
  }
}

/** Попытки хода и время каждой: время уходит в журнал, попытки — в провенанс. */
class AttemptTrace {
  readonly attempts: RoutingAttempt[] = [];
  private readonly elapsed: number[] = [];

  constructor(private readonly now: () => number) {}

  add(attempt: RoutingAttempt, startedAt?: number): void {
    this.attempts.push(attempt);
    this.elapsed.push(startedAt === undefined ? 0 : this.now() - startedAt);
  }

  timed(): TimedRoutingAttempt[] {
    return this.attempts.map((attempt, index) => ({
      ...attempt,
      elapsedMs: this.elapsed[index] ?? 0,
    }));
  }
}

function allRoutesFailed(
  lastError: CoachProviderError | undefined,
  attempts: RoutingAttempt[],
): CoachProviderError {
  const failure = lastError ?? new CoachProviderError('provider_unavailable', 503, true);
  return new CoachProviderError(
    failure.code,
    failure.statusCode,
    failure.retryable,
    failure.diagnostic,
    failure.role,
    attempts,
  );
}

/**
 * Дедлайн хода (28.10): сводка прошлой беседы и три роли идут подряд, а клиент
 * ждёт ответ 240 с. Ступень получает не больше остатка хода, а с остатком
 * меньше минимума не начинается — ход завершается понятной ошибкой вовремя.
 */
const TURN_DEADLINE = 'turn_deadline' as const;
const MIN_STAGE_BUDGET_MS = 10_000;

function remainingBudget(deadlineAt: number | undefined, now: number): number | undefined {
  return deadlineAt === undefined ? undefined : deadlineAt - now;
}

function turnDeadlineError(): CoachProviderError {
  return new CoachProviderError('provider_timeout', 504, true, TURN_DEADLINE);
}

function withinBudget<T>(work: Promise<T>, budgetMs: number | undefined): Promise<T> {
  if (budgetMs === undefined) return work;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(turnDeadlineError()), budgetMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

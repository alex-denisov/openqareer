/**
 * B510: one start-up run of the maintenance passes production runs on a timer —
 * title semantics, catalog totals, market salary estimates — and the vacancy
 * mechanics worker for the top rows. Everything writes through the product's
 * own stores on the demo database; no request leaves the host.
 */
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { VacancyMechanicsRuntime } from '../../server/domain/vacancyMechanicsRuntime';
import type { MultiSourceVacancyEngine } from '../../server/vacancies/multiSourceVacancyEngine';
import { extractVacancyRequirementsWithFallback } from '../../server/domain/vacancyRequirements';
import type { SqliteVacancyPoolStore } from '../../server/vacancies/sqliteVacancyPoolStore';
import { IncrementalClusterBuilder } from '../../server/vacancies/vacancyDeduplicator';
import { freshnessWindow } from '../../server/vacancies/vacancyPoolQuery';
import { SemanticBackfill } from '../../server/vacancies/titleParse/semanticBackfill';
import {
  computeMarketSalaryEstimates,
  writeMarketSalaryEstimates,
} from '../../server/vacancies/marketSalary/marketSalaryEstimateJob';

const BACKFILL_CHUNK = 2_000;
const MAX_BACKFILL_STEPS = 50;
const MAX_WORKER_STEPS = 200;

export function runBlockCMaintenancePasses(
  databasePath: string,
  engine: MultiSourceVacancyEngine,
  pool: Pick<SqliteVacancyPoolStore, 'saveClusters' | 'loadVacancies'>,
  now: Date,
): { semanticKeys: number; salaryKeys: number } {
  // Pool consolidation persists clusters on production; catalog totals count that table.
  // Same builder the engine uses, over the live (non-expired, fresh) rows of the pool.
  const builder = new IncrementalClusterBuilder([]);
  builder.addVacancies(pool.loadVacancies(freshnessWindow()));
  pool.saveClusters(builder.getClusters());
  const database = new DatabaseSync(databasePath);
  try {
    const backfill = new SemanticBackfill(database);
    for (let step = 0; step < MAX_BACKFILL_STEPS; step += 1) {
      if (backfill.step(BACKFILL_CHUNK).passFinished) break;
    }
    engine.refreshCatalogTotals(now.toISOString());
    const estimates = computeMarketSalaryEstimates(database);
    writeMarketSalaryEstimates(database, estimates, now);
    return { semanticKeys: backfill.countKeys(), salaryKeys: estimates.size };
  } finally {
    database.close();
  }
}

interface FitPrompt {
  readonly prefix: string;
  readonly input: string;
}

/**
 * Stands in for the model inside the worker: a requirement is «matched» only
 * when a candidate fact states it word for word, otherwise «unknown». It never
 * invents a fact, and it answers only the vacancy-fit task.
 */
export function literalFitClient(): {
  complete(prompt: FitPrompt): Promise<{ content: string }>;
} {
  return {
    async complete(prompt) {
      const factsLine = prompt.prefix.split('\n').at(-1) ?? '[]';
      const facts = JSON.parse(factsLine) as { id: string; statement: string }[];
      const { requirements } = JSON.parse(prompt.input) as {
        requirements: { id: string; text: string }[];
      };
      const assessments = requirements.map((requirement) => {
        const fact = facts.find(
          (candidate) =>
            candidate.statement.trim().toLowerCase() === requirement.text.trim().toLowerCase(),
        );
        return fact
          ? {
              requirementId: requirement.id,
              status: 'matched',
              evidence: [{ factId: fact.id, quote: fact.statement }],
            }
          : { requirementId: requirement.id, status: 'unknown', evidence: [] };
      });
      return { content: JSON.stringify({ assessments }) };
    },
  };
}

/** Asks for the fit the way the screen does (POST), then drains the worker queue. */
export async function runBlockCFitWorker(
  app: FastifyInstance,
  mechanics: VacancyMechanicsRuntime,
  token: string,
  origin: string,
  clusterIds: readonly string[],
): Promise<void> {
  for (const id of clusterIds) {
    await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/vacancies/${encodeURIComponent(id)}/fit`,
      headers: { authorization: `Bearer ${token}`, origin },
    });
  }
  // Requirements first, as the worker would have done earlier: a fit job that finds
  // none yet is deferred for a minute.
  for (let step = 0; step < MAX_WORKER_STEPS; step += 1) {
    const extracted = await mechanics.requirements.runNext('block-c-demo', (input) =>
      extractVacancyRequirementsWithFallback(input),
    );
    if (!extracted) break;
  }
  const client = literalFitClient() as unknown as Parameters<VacancyMechanicsRuntime['runNext']>[0];
  for (let step = 0; step < MAX_WORKER_STEPS; step += 1) {
    if (!(await mechanics.runNext(client, 'block-c-demo'))) break;
  }
}

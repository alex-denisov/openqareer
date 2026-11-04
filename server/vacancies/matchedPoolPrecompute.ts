import type { CandidateStore } from '../data/candidateStore';
import { matchGeographyOf } from './matchGeography';
import type { MatchedVacancyItem, MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { readCampaign } from '../routes/campaignContext';
import { readTargetLevel } from '../routes/vacancyRoleContext';
import {
  invalidateMatchedVacancies,
  readMatchedSnapshot,
  readMatchProfile,
  setMatchedSnapshotFailureLog,
} from './matchedPoolContext';
import { VacancyMatchUnavailable } from './vacancyMatchReader';

const RECENT_VISIT_MS = 14 * 24 * 60 * 60 * 1_000;
const DEFAULT_PAUSE_MS = 50;

type Logger = {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};
/** Queues fits for a prepared selection (02.11): set by the app once its route deps exist. */
export type PrecomputedFitRequester = (
  candidateId: string,
  snapshot: readonly MatchedVacancyItem[],
) => Promise<void>;

/** Rebuilds a candidate's auto roles when the rules changed (03.11); skips an up-to-date list. */
export type CampaignRoleRefresher = (
  candidateId: string,
  log: (fields: Record<string, unknown>, message: string) => void,
) => Promise<void>;

export interface MatchedPoolPrecomputeOptions {
  readonly candidateStore: CandidateStore;
  readonly engine: MultiSourceVacancyEngine;
  readonly log?: Logger;
  readonly pauseMs?: number;
  readonly now?: () => number;
}

/**
 * Считает подбор заранее, но SQL остаётся в изолированном VacancyMatchReader.
 * Между кандидатами процесс возвращает event loop, поэтому /health не ждёт
 * холодного диска и не зависит от длины очереди.
 */
export class MatchedPoolPrecompute {
  private readonly priority: string[] = [];
  private active: Promise<void> | undefined;
  private log: Logger | undefined;
  private requestFit: PrecomputedFitRequester | undefined;
  private refreshRoles: CampaignRoleRefresher | undefined;
  /** Each candidate is checked once per process: new facts rebuild roles on their own routes. */
  private readonly rolesChecked = new Set<string>();
  private readonly pauseMs: number;
  private readonly now: () => number;

  constructor(private readonly options: MatchedPoolPrecomputeOptions) {
    this.log = options.log;
    setMatchedSnapshotFailureLog(options.engine, (error) =>
      this.log?.error(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          ...(error instanceof VacancyMatchUnavailable
            ? { reason: error.message, waitedMs: error.waitedMs, pendingReads: error.pendingReads }
            : {}),
        },
        'matched-snapshot-rebuild-failed',
      ),
    );
    this.pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
    this.now = options.now ?? Date.now;
  }

  prioritizeCampaign(candidateId: string): void {
    invalidateMatchedVacancies(this.options.engine, candidateId);
    const index = this.priority.indexOf(candidateId);
    if (index >= 0) this.priority.splice(index, 1);
    this.priority.unshift(candidateId);
  }

  setLogger(log: Logger): void {
    this.log = log;
  }

  setFitRequester(requestFit: PrecomputedFitRequester): void {
    this.requestFit = requestFit;
  }

  setCampaignRoleRefresher(refreshRoles: CampaignRoleRefresher): void {
    this.refreshRoles = refreshRoles;
  }

  run(): Promise<void> {
    if (!this.active)
      this.active = this.runOnce().finally(() => {
        this.active = undefined;
      });
    return this.active;
  }

  private async runOnce(): Promise<void> {
    const startedAt = this.now();
    const candidates = this.nextCandidates();
    const durationsMs: number[] = [];
    let errors = 0;
    for (const candidateId of candidates) {
      const candidateStartedAt = this.now();
      try {
        await this.precompute(candidateId);
      } catch (error) {
        errors += 1;
        this.log?.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'matched-precompute-candidate-failed',
        );
      }
      durationsMs.push(this.now() - candidateStartedAt);
      if (this.pauseMs > 0) await pause(this.pauseMs);
    }
    this.log?.info(
      { candidates: candidates.length, durationsMs, errors, elapsedMs: this.now() - startedAt },
      'matched-precompute',
    );
  }

  private nextCandidates(): string[] {
    const since = new Date(this.now() - RECENT_VISIT_MS).toISOString();
    const recent = this.options.candidateStore.listRecentCampaignCandidateIds?.(since) ?? [];
    const queued = this.priority.splice(0);
    return [...new Set([...queued, ...recent])];
  }

  private async precompute(candidateId: string): Promise<void> {
    // Existing candidates got new auto roles only on an import or a campaign edit; the pass walks
    // them one at a time with a pause, so the rebuild writes one workspace row per step.
    if (this.refreshRoles && !this.rolesChecked.has(candidateId)) {
      this.rolesChecked.add(candidateId);
      const log = (fields: Record<string, unknown>, message: string) =>
        this.log?.info({ candidateId, ...fields }, message);
      await this.refreshRoles(candidateId, log).catch((error: unknown) => {
        this.log?.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'campaign-roles-refresh-failed',
        );
      });
    }
    const { confirmedSkills } = readMatchProfile(this.options.candidateStore, candidateId);
    const campaign = readCampaign(this.options.candidateStore, candidateId);
    const targetRoles = [...campaign.roles.value];
    if (confirmedSkills.length === 0 && targetRoles.length === 0) return;
    const targetLevel = readTargetLevel(this.options.candidateStore, candidateId, targetRoles);
    const snapshot = await readMatchedSnapshot(
      this.options.engine,
      candidateId,
      confirmedSkills,
      targetRoles,
      targetLevel,
      matchGeographyOf(campaign.careerGeography),
      { awaitRebuild: true },
    );
    // The sweep runs in chunks on its own: the next candidate's snapshot does not wait for it.
    void this.requestFit?.(candidateId, snapshot).catch((error: unknown) => {
      this.log?.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'matched-precompute-fit-failed',
      );
    });
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

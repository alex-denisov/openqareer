import path from 'node:path';

export type AccountStatus = 'active' | 'cooling_down' | 'checkpoint_required' | 'banned';

export interface PoolAccount {
  readonly id: string;
  readonly storagePath: string;
  status: AccountStatus;
  lastUsedAt?: string;
  cooldownUntil?: number;
  consecutiveErrors: number;
  challengeReason?: string;
}

export interface PoolSummary {
  readonly total: number;
  readonly active: number;
  readonly coolingDown: number;
  readonly checkpointRequired: number;
  readonly banned: number;
}

export interface LinkedinAccountPoolOptions {
  readonly accountIds: readonly string[];
  readonly storageRoot: string;
  readonly cooldownMinutes?: number;
}

export class LinkedinAccountPool {
  private readonly accounts: Map<string, PoolAccount> = new Map();
  private readonly defaultCooldownMs: number;

  constructor(options: LinkedinAccountPoolOptions) {
    this.defaultCooldownMs = (options.cooldownMinutes ?? 15) * 60 * 1000;
    for (const id of options.accountIds) {
      this.accounts.set(id, {
        id,
        storagePath: path.join(options.storageRoot, id),
        status: 'active',
        consecutiveErrors: 0,
      });
    }
  }

  /**
   * Returns the next available active account, rotating by least recently used.
   * Also recovers accounts whose cooldown has elapsed back to active.
   */
  public getAvailableAccount(now: number = Date.now()): PoolAccount | undefined {
    this.refreshCooldowns(now);

    const candidates = Array.from(this.accounts.values()).filter(
      (account) => account.status === 'active',
    );

    if (candidates.length === 0) {
      return undefined;
    }

    candidates.sort((left, right) => {
      const leftTime = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0;
      const rightTime = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0;
      return leftTime - rightTime;
    });

    const chosen = candidates[0];
    if (chosen) {
      chosen.lastUsedAt = new Date(now).toISOString();
    }
    return chosen;
  }

  public recordSuccess(accountId: string, now: number = Date.now()): void {
    const account = this.accounts.get(accountId);
    if (!account) return;
    account.status = 'active';
    account.consecutiveErrors = 0;
    account.lastUsedAt = new Date(now).toISOString();
    account.cooldownUntil = undefined;
    account.challengeReason = undefined;
  }

  public recordRateLimit(
    accountId: string,
    cooldownMs?: number,
    now: number = Date.now(),
  ): void {
    const account = this.accounts.get(accountId);
    if (!account) return;
    const duration = cooldownMs ?? this.defaultCooldownMs;
    account.status = 'cooling_down';
    account.cooldownUntil = now + duration;
    account.consecutiveErrors += 1;
  }

  public recordChallenge(
    accountId: string,
    reason: string,
    now: number = Date.now(),
  ): void {
    const account = this.accounts.get(accountId);
    if (!account) return;
    account.status = 'checkpoint_required';
    account.challengeReason = reason;
    account.lastUsedAt = new Date(now).toISOString();
  }

  public recordBan(accountId: string, reason: string): void {
    const account = this.accounts.get(accountId);
    if (!account) return;
    account.status = 'banned';
    account.challengeReason = reason;
  }

  public getPoolSummary(now: number = Date.now()): PoolSummary {
    this.refreshCooldowns(now);
    let active = 0;
    let coolingDown = 0;
    let checkpointRequired = 0;
    let banned = 0;

    for (const account of this.accounts.values()) {
      switch (account.status) {
        case 'active':
          active += 1;
          break;
        case 'cooling_down':
          coolingDown += 1;
          break;
        case 'checkpoint_required':
          checkpointRequired += 1;
          break;
        case 'banned':
          banned += 1;
          break;
      }
    }

    return {
      total: this.accounts.size,
      active,
      coolingDown,
      checkpointRequired,
      banned,
    };
  }

  public getMinWaitTimeMs(now: number = Date.now()): number {
    this.refreshCooldowns(now);
    if (this.hasActiveAccount()) return 0;

    const cooldowns = Array.from(this.accounts.values())
      .filter((acc) => acc.status === 'cooling_down' && acc.cooldownUntil)
      .map((acc) => Math.max(0, (acc.cooldownUntil ?? now) - now));

    if (cooldowns.length === 0) return 0;
    return Math.min(...cooldowns);
  }

  private hasActiveAccount(): boolean {
    for (const account of this.accounts.values()) {
      if (account.status === 'active') return true;
    }
    return false;
  }

  private refreshCooldowns(now: number): void {
    for (const account of this.accounts.values()) {
      if (
        account.status === 'cooling_down' &&
        account.cooldownUntil &&
        account.cooldownUntil <= now
      ) {
        account.status = 'active';
        account.cooldownUntil = undefined;
      }
    }
  }
}

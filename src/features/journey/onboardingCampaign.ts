export interface CampaignReadiness {
  readonly roles: { readonly origin: string };
  readonly autoRoles?: readonly unknown[];
}

export type ModelCampaignResult<T> =
  { readonly status: 'model'; readonly campaign: T } | { readonly status: 'timeout' };

export interface ModelCampaignWaitOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface ModelCampaignStart<T extends CampaignReadiness> {
  readonly persistProfile: () => Promise<unknown>;
  readonly requestRebuild: () => Promise<unknown>;
  readonly readCampaign: () => Promise<T>;
  readonly waitOptions?: ModelCampaignWaitOptions;
}

const DEFAULT_WAIT_MS = 90_000;
const DEFAULT_POLL_MS = 1_000;

/** Reads the candidate campaign until the server exposes model-origin roles or the wait expires. */
export async function waitForModelCampaign<T extends CampaignReadiness>(
  readCampaign: () => Promise<T>,
  options: ModelCampaignWaitOptions = {},
): Promise<ModelCampaignResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const startedAt = now();

  while (true) {
    try {
      const campaign = await readCampaign();
      if (campaign.roles.origin === 'model' && (campaign.autoRoles?.length ?? 0) > 0) {
        return { status: 'model', campaign };
      }
    } catch {
      // The next bounded read is still useful; timeout becomes the honest fallback state.
    }

    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs <= 0) return { status: 'timeout' };
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

export async function rebuildAndWaitForModelCampaign<T extends CampaignReadiness>(
  input: ModelCampaignStart<T>,
): Promise<ModelCampaignResult<T>> {
  await input.persistProfile();
  await input.requestRebuild();
  return waitForModelCampaign(input.readCampaign, input.waitOptions);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

import type { FootprintRemovalResult } from '../../shared/footprintRemoval';
import type { FootprintFinding } from './adapters/footprintAdapter';
import { searchExaPages } from './adapters/exaAdapter';
import { getCuratedMaigretSite } from './adapters/maigretSiteCatalogue';
import type { FootprintRequestGate } from './adapters/requestScheduler';
import { createUsernamePresenceAdapter } from './adapters/usernamePresenceAdapter';
import { recheckFindingUrl } from './findingRecheck';

/**
 * B382 (тикет: «Перепроверить запускает адаптер»): находку проверяет её же источник, где он умеет
 * проверить одну находку. Профиль по нику — правило площадки (страница «нет такого пользователя»
 * часто отвечает 200, обычный запрос назвал бы её «на месте»). Упоминание — тот же запрос Exa:
 * адрес ещё в выдаче — на месте; нет в выдаче — решает сама страница. Остальное и сбой источника —
 * обычный запрос адреса. Exa платный: проверка идёт только по нажатию кандидата.
 */
export interface FindingRecheckDeps {
  readonly exaApiKey?: string;
  readonly fetch?: typeof fetch;
  readonly requestGate?: FootprintRequestGate;
  readonly getUrl?: (url: string) => Promise<FootprintRemovalResult>;
}

export interface FindingRecheckOutcome {
  readonly result: FootprintRemovalResult;
  /** `source` — решил источник находки, `address` — запрос самого адреса. */
  readonly via: 'source' | 'address';
}

type RecheckedFinding = Pick<FootprintFinding, 'adapter' | 'url' | 'receipt'>;

const USERNAME_QUERY = /^username=(.+)$/u;

function sameAddress(left: string, right: string): boolean {
  const key = (raw: string) => {
    try {
      const url = new URL(raw);
      return `${url.hostname.replace(/^www\./u, '')}${url.pathname.replace(/\/$/u, '')}${url.search}`.toLowerCase();
    } catch {
      return raw.trim().toLowerCase();
    }
  };
  return key(left) === key(right);
}

/** Профиль по нику: есть — на месте, нет — удалено; `undefined` — площадка не ответила ясно. */
async function profileStillThere(
  finding: RecheckedFinding,
  deps: FindingRecheckDeps,
  signal: AbortSignal,
): Promise<FootprintRemovalResult | undefined> {
  const id = finding.adapter;
  const site = getCuratedMaigretSite(finding.receipt.source);
  const username = USERNAME_QUERY.exec(finding.receipt.query)?.[1];
  if ((id !== 'sherlock' && id !== 'maigret') || site?.adapterId !== id || !username)
    return undefined;
  const adapter = createUsernamePresenceAdapter(id, {
    site,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
  });
  try {
    return (await adapter.run({ username }, signal)).length > 0 ? 'still_there' : 'removed';
  } catch {
    return undefined;
  }
}

/** Упоминание: адрес ещё в выдаче того же запроса — на месте; иначе `undefined`, решает адрес. */
async function mentionStillIndexed(
  finding: RecheckedFinding,
  url: string,
  deps: FindingRecheckDeps,
  signal: AbortSignal,
): Promise<FootprintRemovalResult | undefined> {
  if (finding.adapter !== 'exa' || !deps.exaApiKey || !finding.receipt.query.trim())
    return undefined;
  try {
    const hits = await searchExaPages(finding.receipt.query, deps.exaApiKey, signal, {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
    });
    return hits.some((hit) => sameAddress(hit.url, url)) ? 'still_there' : undefined;
  } catch {
    return undefined;
  }
}

/** Итог проверки одной находки; `null` — у находки нет адреса. */
export async function recheckFinding(
  finding: RecheckedFinding,
  deps: FindingRecheckDeps,
  signal: AbortSignal,
): Promise<FindingRecheckOutcome | null> {
  const url = finding.url;
  if (!url) return null;
  const bySource =
    (await profileStillThere(finding, deps, signal)) ??
    (await mentionStillIndexed(finding, url, deps, signal));
  if (bySource) return { result: bySource, via: 'source' };
  const getUrl = deps.getUrl ?? ((address: string) => recheckFindingUrl(address));
  return { result: await getUrl(url), via: 'address' };
}

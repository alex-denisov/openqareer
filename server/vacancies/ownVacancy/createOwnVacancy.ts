import { OWN_VACANCY_MAX, OWN_VACANCY_TEXT_MAX, OWN_VACANCY_TITLE_MAX, type OwnVacancyCreateResult } from '../../../shared/b640OwnVacancy';
import type { NewOwnVacancy, SqliteOwnVacancyStore } from '../../data/sqliteOwnVacancyStore';
import { poolIdFromVacancyLink } from '../../resumeBuilder/vacancyLink';
import type { RouteDeps } from '../../routes/deps';
import { resolvePoolVacancyCluster } from '../poolVacancyCluster';
import { extractVacancyPage } from './extractVacancyPage';
import { isClosedSite } from './closedSites';
import { takeLinkReadSlot } from './linkReadLimit';
import { readVacancyPage } from './pageReader';
import { ownVacancySummary, startOwnVacancyComparison } from './ownVacancyComparison';

/** B676: своя вакансия по ссылке (одно чтение одной страницы) или по вставленному тексту. */
/** Чтение страницы сейчас нельзя: у кандидата уже идёт чтение или их слишком много подряд. */
export class OwnVacancyReadBusy extends Error {}

export type OwnVacancySource = { readonly link: string } | { readonly text: string };

function normalizeText(text: string): string {
  return text.replace(/\r\n?/gu, '\n').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function fromText(text: string): NewOwnVacancy {
  const clean = normalizeText(text);
  const title = clean.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  return { title: title.slice(0, OWN_VACANCY_TITLE_MAX), company: null, location: null, workFormat: null, url: null, text: clean };
}

type LinkOutcome = { readonly vacancy: NewOwnVacancy } | { readonly result: OwnVacancyCreateResult };

function hostOf(link: string): URL | null {
  try {
    return new URL(link);
  } catch {
    return null;
  }
}

async function fromLink(deps: RouteDeps, candidateId: string, link: string): Promise<LinkOutcome> {
  const poolId = poolIdFromVacancyLink(link);
  if (poolId) {
    const cluster = resolvePoolVacancyCluster(deps.multiSourceEngine, poolId);
    return { result: cluster ? { outcome: 'in_pool', clusterId: cluster.id } : { outcome: 'unreadable', reason: 'site_closed' } };
  }
  const url = hostOf(link);
  if (url && isClosedSite(url)) return { result: { outcome: 'unreadable', reason: 'site_closed' } };
  const slot = takeLinkReadSlot(candidateId);
  if (!slot.ok) throw new OwnVacancyReadBusy();
  const page = await readVacancyPage(link).finally(slot.release);
  if (!page.ok) return { result: { outcome: 'unreadable', reason: page.reason } };
  const extracted = extractVacancyPage(page.html);
  if (extracted.botWall) return { result: { outcome: 'unreadable', reason: 'failed' } };
  if (extracted.thin) return { result: { outcome: 'unreadable', reason: 'thin' } };
  const text = normalizeText(extracted.text).slice(0, OWN_VACANCY_TEXT_MAX);
  const title = extracted.title ?? text.split('\n').find(Boolean)?.slice(0, OWN_VACANCY_TITLE_MAX) ?? '';
  return { vacancy: { title, company: extracted.company, location: extracted.location, workFormat: extracted.workFormat, url: link, text } };
}

export async function createOwnVacancy(
  deps: RouteDeps,
  store: SqliteOwnVacancyStore,
  candidateId: string,
  source: OwnVacancySource,
): Promise<OwnVacancyCreateResult> {
  if (store.count(candidateId) >= OWN_VACANCY_MAX) return { outcome: 'limit' };
  const outcome: LinkOutcome = 'text' in source ? { vacancy: fromText(source.text) } : await fromLink(deps, candidateId, source.link);
  if ('result' in outcome) return outcome.result;
  const record = store.create(candidateId, outcome.vacancy);
  startOwnVacancyComparison(deps, candidateId, record);
  return { outcome: 'created', vacancy: ownVacancySummary(deps, candidateId, record) };
}

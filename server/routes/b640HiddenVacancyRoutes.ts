import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { B640HiddenInfo } from '../../shared/b640Vacancies';
import type { StoredVacancySkip } from '../data/sqliteVacancySkipRepository';
import { maskPrivateEmployers } from '../vacancies/privateEmployerMask';
import { readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import { trim } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import {
  invalidQuery,
  nextOffsetOf,
  pagingSchema,
  profileIsEmpty,
  readB640ListContext,
  sessionCandidate,
} from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { withShownPageFitViews } from './matchedVacancyFit';
import { withMarketSalary } from './matchedVacancyRoutes';
import { withDeps } from './helpers';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';

const querySchema = z.object(pagingSchema);

interface HiddenRow {
  readonly item: MatchedVacancyItem;
  readonly skip: StoredVacancySkip;
}

/** Скрытые вакансии из снимка подборки, в порядке скрытия (новые первыми); исчезнувшие из пула пропускаются. */
function hiddenRows(
  snapshot: readonly MatchedVacancyItem[],
  skips: readonly StoredVacancySkip[],
): HiddenRow[] {
  const byCluster = new Map(snapshot.map((item) => [item.cluster.id, item]));
  // Новые первыми; при одинаковом времени — по id, чтобы порции не зависели от порядка выборки.
  const ordered = [...skips].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.clusterId.localeCompare(b.clusterId),
  );
  return ordered.flatMap((skip) => {
    const item = byCluster.get(skip.clusterId);
    return item ? [{ item, skip }] : [];
  });
}

async function hiddenPage(
  deps: RouteDeps,
  candidateId: string,
  rows: readonly HiddenRow[],
  targetLevel: ReturnType<typeof readB640ListContext>['targetLevel'],
) {
  const hiddenOf = new Map<string, B640HiddenInfo>(
    rows.map(({ item, skip }) => [item.cluster.id, { reasonId: skip.reasonId, at: skip.createdAt }]),
  );
  const shaped = maskPrivateEmployers(rows.map(({ item }) => trim(item)));
  const levels = addStoredVacancyLevels(shaped, targetLevel, (key) => deps.titleParseStore.getByKey(key));
  const withFit = await withShownPageFitViews(deps, candidateId, levels);
  return withMarketSalary(deps, withFit).map((item) => ({
    ...item,
    hidden: hiddenOf.get(item.cluster.id) as B640HiddenInfo,
  }));
}

const getHiddenVacancies = async (
  routeDeps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> => {
  const principal = requireCabinetB640(request, reply, routeDeps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const query = querySchema.safeParse(request.query);
  if (!query.success) return invalidQuery(request, reply);
  const { offset, limit } = query.data;
  const deps = withRequestScopedCandidateReads(routeDeps);
  const skips = deps.candidateStore.listVacancySkips(candidate.id);
  const context = readB640ListContext(deps, candidate.id);
  const snapshot =
    skips.length === 0 || profileIsEmpty(context)
      ? []
      : await readMatchedSnapshot(
          deps.multiSourceEngine,
          candidate.id,
          context.confirmedSkills,
          context.targetRoles,
          context.targetLevel,
          context.geography,
        );
  const rows = hiddenRows(snapshot, skips);
  const page = rows.slice(offset, offset + limit);
  const data = await hiddenPage(deps, candidate.id, page, context.targetLevel);
  return {
    data,
    meta: {
      requestId: request.id,
      total: rows.length,
      offset,
      limit,
      nextOffset: nextOffsetOf(offset, page.length, rows.length),
    },
  };
};

/** B674: скрытые вакансии кандидата для кабинета B640; только чтение. */
export function registerB640HiddenVacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/b640/hidden-vacancies', withDeps(deps, getHiddenVacancies));
}

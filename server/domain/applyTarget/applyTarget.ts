import type { ApplyTarget, ApplyTargetOrigin } from '../../../shared/applyTarget';
import type { UnifiedVacancy } from '../unifiedVacancy';
import { parseAtsBoardSourceId } from '../../vacancies/atsBoardAdapters';
import {
  applyAddress,
  atsAddress,
  greenhouseAddress,
  isEmployerChannel,
  isTrackerUrl,
  parseHttpUrl,
  type ApplyAddress,
} from './applyAddress';
import { isSameVacancy } from './sameVacancy';
import { atsInText, emailInText, mailtoOf, telegramInText } from './textTarget';

const JOB_ID = /^\d{1,20}$/u;
const BOARD = /^[\w-]{1,100}$/u;

export interface ApplyTargetInput {
  /** Запись вакансии, под которую идёт отклик. */
  readonly vacancy: UnifiedVacancy;
  /** Записи других источников кластера: чужие отсеиваются здесь. */
  readonly members?: readonly UnifiedVacancy[];
  /** Куда трекер уже привёл; `undefined` — переход не выполняли или он не удался. */
  readonly redirected?: (url: string) => string | undefined;
}

const target = (
  { channel, url, formUrl, email }: ApplyAddress,
  origin: ApplyTargetOrigin,
): ApplyTarget => ({
  channel,
  url,
  formUrl,
  origin,
  ...(email ? { email } : {}),
});

/** Доска ATS встроена в сайт работодателя: номер в адресе, доска — только в источнике. */
function embeddedAddress(vacancy: UnifiedVacancy): ApplyAddress | null {
  const url = parseHttpUrl(vacancy.url);
  const ref = parseAtsBoardSourceId(vacancy.provenance.sourceId);
  const greenhouseId = url?.searchParams.get('gh_jid') ?? '';
  if (JOB_ID.test(greenhouseId)) {
    const board = ref?.provider === 'greenhouse' ? ref.board : '';
    if (BOARD.test(board)) return greenhouseAddress(board, greenhouseId);
    return { channel: 'greenhouse', url: url!.href, formUrl: url!.href };
  }
  const jobId = vacancy.provenance.externalId ?? '';
  const greenhouseBoard =
    ref?.provider === 'greenhouse' && BOARD.test(ref.board) && JOB_ID.test(jobId);
  if (greenhouseBoard) return greenhouseAddress(ref.board, jobId);
  const ashbyId = url?.searchParams.get('ashby_jid');
  if (!ashbyId || ref?.provider !== 'ashby') return null;
  return atsAddress(`https://jobs.ashbyhq.com/${encodeURIComponent(ref.board)}/${ashbyId}`);
}

function recordAddress(vacancy: UnifiedVacancy): ApplyAddress | null {
  return atsAddress(vacancy.url) ?? embeddedAddress(vacancy) ?? applyAddress(vacancy.url);
}

/** Одна вакансия Greenhouse бывает и страницей доски, и встроенной формой: различает её номер. */
const postingKey = ({ channel, url }: ApplyAddress) =>
  channel === 'greenhouse'
    ? `greenhouse:${/(?:token=|jobs\/|gh_jid=)(\d+)/u.exec(url)?.[1] ?? url}`
    : url;

/** Та же вакансия у работодателя: hh.ru первым (B678), затем единственная ATS. */
function clusterAddress(
  vacancy: UnifiedVacancy,
  members: readonly UnifiedVacancy[],
): ApplyAddress | null {
  const same = members
    .filter((member) => member.id !== vacancy.id && isSameVacancy(vacancy, member))
    .flatMap((member) => recordAddress(member) ?? []);
  const hh = same.find(({ channel }) => channel === 'hh');
  if (hh) return hh;
  const employers = new Map(
    same
      .filter(({ channel }) => isEmployerChannel(channel))
      .map((item) => [postingKey(item), item]),
  );
  return employers.size === 1 ? [...employers.values()][0]! : null;
}

function textAddress(vacancy: UnifiedVacancy, own: ApplyAddress): ApplyAddress | null {
  // Сборник вакансий называет адреса разных ролей.
  if (vacancy.postType === 'digest') return null;
  const text = vacancy.fullDescription?.trim() || vacancy.description;
  const ats = atsInText(text);
  if (ats) return ats;
  const email = emailInText(text);
  if (email) return { channel: 'email', url: own.url, formUrl: mailtoOf(email), email };
  const contact = own.channel === 'telegram' ? telegramInText(text) : null;
  return contact ? { channel: 'telegram', url: own.url, formUrl: contact } : null;
}

/** Конечная цель отклика на вакансию (B787). Сети нет: переход трекера приходит готовым. */
export function resolveApplyTarget({
  vacancy,
  members = [],
  redirected,
}: ApplyTargetInput): ApplyTarget | null {
  const own = recordAddress(vacancy);
  if (!own) return null;
  if (own.channel === 'hh' || isEmployerChannel(own.channel)) return target(own, 'url');
  const twin = clusterAddress(vacancy, members);
  if (twin) return target(twin, 'cluster');
  if (isTrackerUrl(own.url)) {
    const final = redirected?.(own.url);
    const reached = final && !isTrackerUrl(final) ? applyAddress(final) : null;
    if (reached) return target(reached, 'redirect');
    const bare = { ...target(own, 'url'), needsRedirect: true as const };
    return /(?:^|\.)grnh\.se$/u.test(new URL(own.url).hostname)
      ? { ...bare, channel: 'greenhouse' }
      : bare;
  }
  const named = own.channel === 'site' ? null : textAddress(vacancy, own);
  return named ? target(named, 'text') : target(own, 'url');
}

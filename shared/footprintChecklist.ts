/**
 * Макет 2, «Цифровой след», шаг 4 «Чек-лист санации» (B544): five items, each
 * counted from the stored audit and the candidate's own marks — never assumed.
 */
import type { CandidateFootprintAudit, CandidateFootprintFinding } from './candidateFootprint';

export type FootprintChecklistItemId =
  'review' | 'leaks' | 'metadata' | 'old_accounts' | 'artifacts';

export interface FootprintChecklistItem {
  readonly id: FootprintChecklistItemId;
  readonly title: string;
  readonly done: boolean;
  readonly remaining: number;
  readonly status: string;
  /** Findings the candidate still has to act on for this item. */
  readonly findingIds: readonly string[];
}

export interface FootprintChecklist {
  readonly items: readonly FootprintChecklistItem[];
  readonly done: number;
  readonly total: number;
}

/** Findings that read as the candidate's professional work: talks, code, publications. */
export const ARTIFACT_FINDING_KINDS: ReadonlySet<string> = new Set([
  'mention',
  'publication',
  'code',
  'talk',
]);

const TITLES: Readonly<Record<FootprintChecklistItemId, string>> = {
  review: 'Находки разобраны',
  leaks: 'Утечки закрыты',
  metadata: 'Метаданные файлов чисты',
  old_accounts: 'Старые аккаунты закрыты или обезличены',
  artifacts: 'Профессиональные артефакты в профиле',
};

const AWAITING_REVIEW = 'После разбора находок';

function item(
  id: FootprintChecklistItemId,
  pending: readonly CandidateFootprintFinding[],
  doneStatus: string,
): FootprintChecklistItem {
  const done = pending.length === 0;
  return {
    id,
    title: TITLES[id],
    done,
    remaining: pending.length,
    status: done ? doneStatus : `Осталось ${pending.length}`,
    findingIds: pending.map((finding) => finding.id),
  };
}

function notDone(id: FootprintChecklistItemId, status: string): FootprintChecklistItem {
  return { id, title: TITLES[id], done: false, remaining: 0, status, findingIds: [] };
}

function isUnanswered(finding: CandidateFootprintFinding): boolean {
  return finding.review === 'unreviewed' || finding.review === 'hidden';
}

function leaksItem(audit: CandidateFootprintAudit): FootprintChecklistItem {
  const leaks = audit.findings.filter(
    (finding) => finding.kind === 'breach' && finding.review !== 'not_self',
  );
  const hibpChecked = audit.adapterStatuses.some(
    (status) => status.adapterId === 'hibp' && status.state === 'checked',
  );
  if (!leaks.length && !hibpChecked) return notDone('leaks', 'Утечки не проверялись');
  const pending = leaks.filter((finding) => finding.checklistMark !== 'password_changed');
  return item('leaks', pending, leaks.length ? 'Сделано' : 'Утечек не найдено');
}

/** No metadata check runs on uploaded files yet: the item never claims they are clean. */
function metadataItem(audit: CandidateFootprintAudit): FootprintChecklistItem {
  const found = audit.findings.filter((finding) => finding.kind === 'metadata');
  if (!found.length) return notDone('metadata', 'Файлы не проверялись');
  return { ...notDone('metadata', `Осталось ${found.length}`), remaining: found.length };
}

function confirmedItem(
  audit: CandidateFootprintAudit,
  id: 'old_accounts' | 'artifacts',
): FootprintChecklistItem {
  const matches = (finding: CandidateFootprintFinding) =>
    id === 'old_accounts'
      ? Boolean(finding.staleAccount)
      : ARTIFACT_FINDING_KINDS.has(finding.kind);
  const handled = (finding: CandidateFootprintFinding) =>
    id === 'old_accounts'
      ? finding.checklistMark === 'account_closed' || finding.checklistMark === 'account_kept'
      : finding.checklistMark === 'added_to_profile';
  const relevant = audit.findings.filter(
    (finding) => finding.review === 'confirmed_self' && matches(finding),
  );
  const pending = relevant.filter((finding) => !handled(finding));
  // Until every finding is answered an empty list proves nothing.
  if (!relevant.length && audit.findings.some(isUnanswered)) return notDone(id, AWAITING_REVIEW);
  const none = id === 'old_accounts' ? 'Старых аккаунтов нет' : 'Артефактов нет';
  return item(id, pending, relevant.length ? 'Сделано' : none);
}

export function buildFootprintChecklist(audit: CandidateFootprintAudit | null): FootprintChecklist {
  if (!audit || audit.state !== 'completed') {
    const items = (Object.keys(TITLES) as FootprintChecklistItemId[]).map((id) =>
      notDone(id, 'После проверки'),
    );
    return { items, done: 0, total: items.length };
  }
  const items = [
    item('review', audit.findings.filter(isUnanswered), 'Сделано'),
    leaksItem(audit),
    metadataItem(audit),
    confirmedItem(audit, 'old_accounts'),
    confirmedItem(audit, 'artifacts'),
  ];
  return { items, done: items.filter((entry) => entry.done).length, total: items.length };
}

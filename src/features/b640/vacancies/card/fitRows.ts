import type {
  VacancyFitRequirementAssessment,
  VacancyFitView,
} from '../../../../../shared/vacancyFit';
import { vacancyFitPercent } from '../../../../../shared/vacancyFitPercent';
import { vacancyFitSentence } from '../../../vacancies/vacancyFitModel';
import { pluralRu } from '../format';

export type FitStatus = VacancyFitRequirementAssessment['status'];

export interface FitRow {
  readonly id: string;
  readonly text: string;
  readonly status: FitStatus;
  /** Цитата из профиля или короткая пометка статуса. */
  readonly evidence: string;
  /** Есть смысл вести на проверку навыка. */
  readonly canCheck: boolean;
}

/** busy — считаем, err — не посчитано, none — нет профиля, few — считать не из чего, ready — есть процент. */
export type FitBlockState = 'busy' | 'err' | 'none' | 'few' | 'ready';

const BUSY_STATES: readonly VacancyFitView['state'][] = ['processing', 'retrying', 'refreshing'];

export function fitBlockState(
  view: VacancyFitView | undefined,
  readFailed: boolean,
): FitBlockState {
  if (vacancyFitPercent(view) !== null) return 'ready';
  if (!view) return readFailed ? 'err' : 'busy';
  if (BUSY_STATES.includes(view.state)) return 'busy';
  if (view.state === 'failed' || view.state === 'not_requested') return 'err';
  if (view.result?.reason === 'no_eligible_facts') return 'none';
  return 'few';
}

function evidenceText(status: FitStatus, quote: string | undefined): string {
  if (status === 'matched') return quote ?? '';
  if (status === 'partial') return quote ? `частично · ${quote}` : 'частично';
  return status === 'unknown' ? 'неизвестно' : 'нет в профиле';
}

/** Список требований-навыков с вердиктом по каждому; условия (язык, формат) в нём не идут. */
export function fitRows(view: VacancyFitView | undefined): readonly FitRow[] {
  if (!view) return [];
  const byId = new Map(view.result?.assessments.map((item) => [item.requirementId, item]) ?? []);
  return view.requirements
    .filter((requirement) => requirement.skill !== false)
    .map((requirement) => {
      const assessment = byId.get(requirement.id);
      const status = assessment?.status ?? 'unknown';
      return {
        id: requirement.id,
        text: requirement.label?.trim() || requirement.text,
        status,
        evidence: evidenceText(status, assessment?.evidence[0]?.quote),
        canCheck: status === 'partial' || status === 'unknown',
      };
    });
}

export function requirementsLabel(view: VacancyFitView | undefined): string {
  const count = fitRows(view).length;
  if (vacancyFitPercent(view) === null) return `Требования из текста вакансии · ${count}`;
  return `Требования: ${view!.result!.coverage.matched} из ${view!.result!.coverage.total} есть в профиле`;
}

function shortDate(iso: string | undefined): string {
  const date = iso ? new Date(iso) : undefined;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

/** «Требования — из текста вакансии, hh.ru, 11.11 · 7 требований». */
export function sourceLine(view: VacancyFitView | undefined, sourceName: string): string {
  const count = fitRows(view).length;
  const date = shortDate(view?.result?.calculatedAt);
  const head = ['из текста вакансии', sourceName, date].filter(Boolean).join(', ');
  return `Требования — ${head} · ${count} ${pluralRu(count, 'требование', 'требования', 'требований')}`;
}

/** «Вывод консультанта» на шаге «Отклик» (a02d): сколько требований есть в профиле и каких нет. */
export function coachVerdict(view: VacancyFitView | undefined): string | null {
  const sentence = vacancyFitSentence(view);
  if (sentence === null) return null;
  const missing = fitRows(view)
    .filter((row) => row.status === 'unmatched')
    .map((row) => row.text);
  return missing.length > 0 ? `${sentence} Нет в профиле: ${missing.join(', ')}.` : sentence;
}

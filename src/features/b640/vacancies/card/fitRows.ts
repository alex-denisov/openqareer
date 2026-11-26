import type {
  VacancyFitRequirementAssessment,
  VacancyFitView,
} from '../../../../../shared/vacancyFit';
import { vacancyFitPercent } from '../../../../../shared/vacancyFitPercent';
import {
  countedSkillRequirements,
  requirementVerdict,
  wishRequirements,
} from '../../../vacancies/vacancyRequirementChips';
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

function evidenceText(
  status: FitStatus,
  quote: string | undefined,
  impliedRole: string | undefined,
): string {
  if (status === 'matched') {
    return quote ?? (impliedRole ? `следует из опыта: ${impliedRole}` : '');
  }
  if (status === 'partial') return quote ? `частично · ${quote}` : 'частично';
  return status === 'unknown' ? 'неизвестно' : 'нет в профиле';
}

/**
 * Требования, по которым посчитан процент, с тем же вердиктом, что у предложения над списком
 * (навык, следующий из опыта, — «есть»); условия и обязанности в список не идут.
 */
export function fitRows(view: VacancyFitView | undefined): readonly FitRow[] {
  return countedSkillRequirements(view).map((requirement) => {
    const { status, evidence, impliedRole } = requirementVerdict(view, requirement.id);
    return {
      id: requirement.id,
      text: requirement.label?.trim() || requirement.text,
      status,
      evidence: evidenceText(status, evidence[0]?.quote, impliedRole),
      canCheck: status === 'partial' || status === 'unknown',
    };
  });
}

/** Строки карточки: посчитанные, за ними пожелания, которых профиль не показывает, — вне счёта. */
export function listedRows(view: VacancyFitView | undefined): readonly FitRow[] {
  const wishes = wishRequirements(view).map((requirement) => {
    const { status, evidence } = requirementVerdict(view, requirement.id);
    const partial = status === 'partial';
    return {
      id: requirement.id,
      text: requirement.label?.trim() || requirement.text,
      status: partial ? status : ('unknown' as const),
      evidence: partial ? evidenceText(status, evidence[0]?.quote, undefined) : 'желательно',
      canCheck: false,
    };
  });
  return [...fitRows(view), ...wishes];
}

/** «Требования: 6 из 7 есть в профиле»; без процента — «Требования из текста вакансии · 7». */
export function requirementsLabel(view: VacancyFitView | undefined): string {
  const coverage = view?.result?.coverage;
  if (vacancyFitPercent(view) === null || !coverage) {
    return `Требования из текста вакансии · ${fitRows(view).length}`;
  }
  return `Требования: ${coverage.matched} из ${coverage.total} есть в профиле`;
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

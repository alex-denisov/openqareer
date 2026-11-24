import {
  isHhSource,
  preferredApplySource,
  type VacancySourceRef,
} from '../../../../../shared/hhVacancySource';
import type { ApplicationView } from '../../../applications/applicationsApi';
import { platformOf, type Platform } from '../../responses/model/platform';
import type {
  ConnectionCircleNumber,
  ConnectionCircleResult,
} from '../../../vacancies/vacancyLetterApi';

/** Шаги единого экрана отклика. «Анкета» есть только у вакансий с прочитанной анкетой. */
export type ApplyStep = 'resume' | 'letter' | 'form' | 'send';

export const APPLY_STEPS: readonly { readonly id: ApplyStep; readonly label: string }[] = [
  { id: 'resume', label: 'Резюме' },
  { id: 'letter', label: 'Письмо' },
  { id: 'form', label: 'Анкета' },
  { id: 'send', label: 'Отправка' },
];

/** Шаги для вакансии: без анкеты вкладки «Анкета» нет. */
export function stepsFor(hasForm: boolean): typeof APPLY_STEPS {
  return hasForm ? APPLY_STEPS : APPLY_STEPS.filter((step) => step.id !== 'form');
}

/** Шаг из адреса (`?step=send`); по умолчанию — письмо. */
export function parseStep(search: string): ApplyStep {
  const value = new URLSearchParams(search).get('step');
  return APPLY_STEPS.some((step) => step.id === value) ? (value as ApplyStep) : 'letter';
}

export interface ApplyTarget {
  /** Вакансия, под которую идёт отклик. */
  readonly vacancyId: string;
  /** Карточка отклика, если она уже есть. */
  readonly application: ApplicationView | null;
}

/**
 * Адрес экрана несёт либо id отклика, либо id вакансии (из «Вакансий» приходят без карточки).
 * `null` — это отклик без вакансии из подбора: письмо под него собрать не из чего.
 */
export function resolveTarget(
  responseId: string,
  applications: readonly ApplicationView[],
): ApplyTarget | null {
  const byId = applications.find((application) => application.id === responseId);
  if (byId) return byId.clusterId ? { vacancyId: byId.clusterId, application: byId } : null;
  const byVacancy = applications.find((application) => application.clusterId === responseId);
  return { vacancyId: responseId, application: byVacancy ?? null };
}

export interface ApplyHead {
  readonly title: string;
  readonly company: string;
  readonly url: string | null;
  /** Площадка словами: «hh.ru», «сайт компании». */
  readonly source: string | null;
  readonly platform: Platform | null;
}

interface HeadSources {
  readonly application: ApplicationView | null;
  /** Название и компания, которые сервер знает по вакансии. */
  readonly known?: { readonly vacancyTitle: string; readonly companyName: string } | null;
  /** Запись подбора, если отклика ещё нет. */
  readonly cluster?: {
    readonly canonicalTitle: string;
    readonly canonicalCompany: string;
    readonly primaryUrl: string;
    readonly sources: readonly VacancySourceRef[];
  } | null;
}

function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//u.test(url) ? url : null;
}

function isHhSnapshot(snapshot: ApplicationView['vacancy']): boolean {
  return Boolean(
    snapshot &&
    isHhSource({
      sourceType: snapshot.source,
      sourceName: snapshot.source,
      sourceUrl: snapshot.url,
    }),
  );
}

/** Отклик не отправлен, а в его снимке не hh.ru: площадку сверяем с подборкой (B678). */
export function needsPoolRoute(application: ApplicationView | null): boolean {
  return !application || (application.stage === 'saved' && !isHhSnapshot(application.vacancy));
}

/**
 * Площадка отклика и её адрес (B678): hh.ru первым, как на карточке вакансии. Снимок отклика
 * главнее подборки; на hh.ru переходит только неотправленный со снимком другой площадки.
 */
export function applyRoute({
  application,
  cluster,
}: Pick<HeadSources, 'application' | 'cluster'>): {
  readonly source: string | undefined;
  readonly url: string | null;
} {
  const snapshot = application?.vacancy ?? null;
  const pool = cluster ? preferredApplySource(cluster) : null;
  if (pool?.hh && safeUrl(pool.url) && needsPoolRoute(application)) {
    return { source: pool.source, url: pool.url };
  }
  return {
    source: snapshot?.source || pool?.source,
    url: safeUrl(snapshot?.url) ?? safeUrl(pool?.url),
  };
}

/** Шапка отклика: что известно о вакансии из карточки отклика, сервера и подбора. */
export function buildHead({ application, known, cluster }: HeadSources): ApplyHead {
  const snapshot = application?.vacancy ?? null;
  const route = applyRoute({ application, cluster });
  const platform = route.source ? platformOf(route.source) : null;
  return {
    title: snapshot?.title || known?.vacancyTitle || cluster?.canonicalTitle || 'Вакансия',
    company:
      (snapshot?.companyHidden ? '' : snapshot?.company) ||
      known?.companyName ||
      cluster?.canonicalCompany ||
      '',
    url: route.url,
    source: platform?.label ?? null,
    platform,
  };
}

export interface RecipientOption {
  /** `cold` — работодателю напрямую; иначе id пути через знакомого. */
  readonly value: string;
  readonly label: string;
  readonly circle: ConnectionCircleNumber;
  readonly pathId: string | null;
}

export const COLD_RECIPIENT = 'cold';

/** «Кому»: работодателю напрямую и пути через знакомых, которые нашёл сервер. */
export function recipientOptions(
  circles: readonly ConnectionCircleResult[],
  source: string | null,
): readonly RecipientOption[] {
  const cold: RecipientOption = {
    value: COLD_RECIPIENT,
    label: source ? `Работодателю · через ${source}` : 'Работодателю',
    circle: 3,
    pathId: null,
  };
  const paths = circles
    .filter((result) => result.circle !== 3)
    .flatMap((result) => result.paths)
    .map((path): RecipientOption => {
      // Сервер ставит первым самого кандидата: посредник — следующий в цепочке.
      const via = path.path.slice(1).find((person) => person.id !== path.recipient.id);
      const direct = !via;
      return {
        value: path.id,
        label: direct
          ? `${path.recipient.fullName} · знакомый`
          : `${via.fullName} — попросить познакомить: ${path.recipient.fullName}`,
        circle: path.circle,
        pathId: path.id,
      };
    });
  return [cold, ...paths];
}

/** Текст абзацами: пустые строки убираются. */
export function paragraphs(text: string): readonly string[] {
  return text
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

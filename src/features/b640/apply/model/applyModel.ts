import { vacancySourceLabel } from '../../../../../shared/vacancySourceLabel';
import type { ApplicationView } from '../../../applications/applicationsApi';
import type {
  ConnectionCircleNumber,
  ConnectionCircleResult,
} from '../../../vacancies/vacancyLetterApi';

/** Шаги единого экрана отклика. «Анкета» появится вместе с механикой анкет (B641). */
export type ApplyStep = 'resume' | 'letter' | 'send';

export const APPLY_STEPS: readonly { readonly id: ApplyStep; readonly label: string }[] = [
  { id: 'resume', label: 'Резюме' },
  { id: 'letter', label: 'Письмо' },
  { id: 'send', label: 'Отправка' },
];

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
  /** Площадка словами: «hh.ru». */
  readonly source: string | null;
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
    readonly sources: readonly { readonly sourceName?: string }[];
  } | null;
}

function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//u.test(url) ? url : null;
}

/** Шапка отклика: что известно о вакансии из карточки отклика, сервера и подбора. */
export function buildHead({ application, known, cluster }: HeadSources): ApplyHead {
  const snapshot = application?.vacancy ?? null;
  const sourceType = snapshot?.source;
  const sourceName = cluster?.sources[0]?.sourceName;
  return {
    title: snapshot?.title || known?.vacancyTitle || cluster?.canonicalTitle || 'Вакансия',
    company:
      (snapshot?.companyHidden ? '' : snapshot?.company) ||
      known?.companyName ||
      cluster?.canonicalCompany ||
      '',
    url: safeUrl(snapshot?.url) ?? safeUrl(cluster?.primaryUrl),
    source: sourceType
      ? vacancySourceLabel({ sourceType })
      : sourceName
        ? vacancySourceLabel({ sourceType: sourceName, sourceName })
        : null,
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
      const via = path.path[0];
      const direct = !via || via.id === path.recipient.id;
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

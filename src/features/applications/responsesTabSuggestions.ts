import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantPage,
} from '../../../shared/candidateCompany';
import { pluralRu } from '../../../shared/pluralRu';
import type { ConsultantScreenSuggestion } from '../journey/consultantScreenSuggestion';
import type { ApplicationView } from './applicationsApi';
import { responseMockInterviewSuggestion } from './ResponseMockInterviewSuggestion';
import { formatDayMonth } from './responseCardFace';

/**
 * Макет 5, вкладки «Подготовка», «Хочу», «Офферы»: одно предложение консультанта по данным
 * вкладки. Числа и названия — только из данных кандидата; нечего предложить — `null`, и панель
 * показывает общие вопросы.
 */

const STAGES = ['responses', 'interviews'] as const;
const DISMISS = 'Не сейчас';

function suggestion(
  fields: Omit<ConsultantScreenSuggestion, 'stages' | 'dismissLabel'>,
): ConsultantScreenSuggestion {
  return { stages: STAGES, dismissLabel: DISMISS, ...fields };
}

function companyOf(application: ApplicationView): string | undefined {
  return application.vacancy?.companyHidden
    ? undefined
    : (application.vacancy?.company ?? undefined);
}

function targetOf(application: ApplicationView): string {
  const company = companyOf(application);
  if (company) return ` по ${company}`;
  return application.vacancy?.title ? `: ${application.vacancy.title}` : '';
}

function interviewTime(application: ApplicationView): number | null {
  const scheduledAt = application.nearestInterview?.scheduledAt;
  if (!scheduledAt) return null;
  const time = Date.parse(scheduledAt);
  return Number.isNaN(time) ? null : time;
}

export interface PreparationSuggestionInput {
  readonly applications: readonly ApplicationView[];
  /** `undefined` — истории ещё грузятся или не загрузились. */
  readonly storyCount: number | undefined;
  readonly actions: {
    readonly startMock: (applicationId: string) => void;
    readonly openDebrief: (applicationId: string) => void;
    readonly openStories: () => void;
  };
}

/** Ближайшее интервью → мок-интервью; все прошли → дебриф; интервью нет → STAR-истории. */
export function preparationTabSuggestion(
  { applications, storyCount, actions }: PreparationSuggestionInput,
  now: number = Date.now(),
): ConsultantScreenSuggestion | null {
  const interviews = applications.filter((application) => application.stage === 'interview');
  const upcoming = interviews
    .filter((application) => (interviewTime(application) ?? Infinity) >= now)
    .sort((a, b) => (interviewTime(a) ?? Infinity) - (interviewTime(b) ?? Infinity));
  const nearest = upcoming[0];
  if (nearest) {
    return responseMockInterviewSuggestion(nearest, () => actions.startMock(nearest.id), now);
  }
  const passed = [...interviews].sort((a, b) => (interviewTime(b) ?? 0) - (interviewTime(a) ?? 0));
  const latest = passed[0];
  if (latest) {
    const when = formatDayMonth(latest.nearestInterview?.scheduledAt);
    return suggestion({
      id: `debrief:${latest.id}`,
      title: `Дебриф${targetOf(latest)}`,
      detail: `Интервью ${when ?? ''} прошло. Запишите, что спросили и что не получилось: 5 минут.`,
      acceptLabel: 'Заполнить',
      onAccept: () => actions.openDebrief(latest.id),
    });
  }
  if (storyCount === undefined) return null;
  if (storyCount === 0) {
    return suggestion({
      id: 'prep:first-star',
      title: 'STAR-историй пока нет',
      detail: 'Соберём первую из фактов профиля: на STAR-историях строятся вопросы мок-интервью.',
      acceptLabel: 'Добавить историю',
      onAccept: actions.openStories,
    });
  }
  const ready = storyCount === 1 ? 'готова' : 'готовы';
  return suggestion({
    id: 'prep:no-interview',
    title: 'Интервью пока не назначено',
    detail: `${pluralRu(storyCount, ['STAR-история', 'STAR-истории', 'STAR-историй'])} ${ready}. Когда отклик дойдёт до интервью, проведём мок-интервью по нему.`,
    acceptLabel: 'Открыть истории',
    onAccept: actions.openStories,
  });
}

export interface WantSuggestionInput {
  readonly page: CandidateCompanyWantPage | undefined;
  readonly loading: boolean;
  readonly error: string;
  readonly actions: {
    readonly openAdd: () => void;
    readonly findPath: (company: CandidateCompanyOpportunity) => void;
  };
}

const VACANCY_FORMS: [string, string, string] = ['вакансия', 'вакансии', 'вакансий'];

function needsPath(company: CandidateCompanyOpportunity): boolean {
  return (
    !company.hasRecruiter &&
    company.recruiterSearchStatus !== 'queued' &&
    company.recruiterSearchStatus !== 'running'
  );
}

function byVacancies(a: CandidateCompanyOpportunity, b: CandidateCompanyOpportunity): number {
  return b.vacancyCount - a.vacancyCount;
}

/** Пусто → добавить компании; иначе компания с новыми вакансиями, затем самая большая без пути. */
export function wantTabSuggestion({
  page,
  loading,
  error,
  actions,
}: WantSuggestionInput): ConsultantScreenSuggestion | null {
  if (loading || error || !page) return null;
  if (page.counts.all === 0) {
    return suggestion({
      id: 'want:empty',
      title: 'В «Хочу» пока нет компаний',
      detail:
        'Добавьте компании, куда хотите попасть: найдём путь к рекрутеру и сообщим о новых вакансиях.',
      acceptLabel: 'Добавить',
      onAccept: actions.openAdd,
    });
  }
  const open = page.items.filter(needsPath);
  const fresh = open.filter((company) => company.hasNewVacancies).sort(byVacancies)[0];
  if (fresh) {
    return suggestion({
      id: `want:new:${fresh.key}`,
      title: `Новые вакансии в ${fresh.name}`,
      detail: `${pluralRu(fresh.vacancyCount, VACANCY_FORMS)}, есть новые за неделю. Пути к рекрутеру пока нет.`,
      acceptLabel: 'Найти путь',
      onAccept: () => actions.findPath(fresh),
    });
  }
  const wanted = open
    .filter((company) => company.wantStage === 'want' && company.vacancyCount > 0)
    .sort(byVacancies)[0];
  if (!wanted) return null;
  return suggestion({
    id: `want:path:${wanted.key}`,
    title: `Путь в ${wanted.name}`,
    detail: `${pluralRu(wanted.vacancyCount, VACANCY_FORMS)}, пути к рекрутеру пока нет.`,
    acceptLabel: 'Найти путь',
    onAccept: () => actions.findPath(wanted),
  });
}

export interface OffersSuggestionInput {
  readonly offers: readonly ApplicationView[];
  readonly loading: boolean;
  readonly error: string;
  readonly actions: {
    readonly compare: () => void;
    readonly edit: (applicationId: string) => void;
    readonly add: () => void;
  };
}

function offerCompany(application: ApplicationView): string {
  return companyOf(application) ?? application.vacancy?.title ?? 'без названия';
}

/** Части total comp, которых нет в условиях оффера (ноль — указанное значение). */
function missingParts(application: ApplicationView): readonly string[] {
  const terms = application.offer?.terms ?? {};
  const missing: string[] = [];
  if (terms.baseSalary === undefined) missing.push('оклад');
  if (terms.bonus === undefined) missing.push('бонус');
  if (!terms.equity?.trim()) missing.push('акции');
  if (!terms.benefits?.length) missing.push('льготы (ДМС, релокация)');
  return missing;
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`;
}

function nearestDeadline(offers: readonly ApplicationView[]): string {
  const dated = offers
    .map((application) => ({ application, time: Date.parse(application.offer?.respondBy ?? '') }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((a, b) => a.time - b.time)[0];
  if (!dated) return '';
  const when = formatDayMonth(dated.application.offer?.respondBy);
  return ` Ответить ${offerCompany(dated.application)} до ${when}.`;
}

/** ≥ 2 → сравнить; один → что уточнить по total comp; нет → что спросить. */
export function offersTabSuggestion({
  offers,
  loading,
  error,
  actions,
}: OffersSuggestionInput): ConsultantScreenSuggestion | null {
  if (loading || error) return null;
  if (offers.length >= 2) {
    return suggestion({
      id: `offers:compare:${offers.map((offer) => offer.id).join(',')}`,
      title: `Сравнить ${pluralRu(offers.length, ['оффер', 'оффера', 'офферов'])}`,
      detail: `${joinAnd(offers.map(offerCompany))}: оклад, бонус, акции и льготы рядом.${nearestDeadline(offers)}`,
      acceptLabel: 'Сравнить',
      onAccept: actions.compare,
    });
  }
  const only = offers[0];
  if (only) {
    const missing = missingParts(only);
    if (missing.length === 0) {
      return suggestion({
        id: `offers:complete:${only.id}`,
        title: `Оффер ${offerCompany(only)} заполнен`,
        detail: `Сравнение появится после второго оффера: добавьте его, когда придёт.${nearestDeadline(offers)}`,
        acceptLabel: 'Добавить оффер',
        onAccept: actions.add,
      });
    }
    return suggestion({
      id: `offers:missing:${only.id}`,
      title: `Что уточнить по офферу ${offerCompany(only)}`,
      detail: `Не ${missing.length === 1 ? 'указан' : 'указаны'} ${joinAnd(missing)}. Спросите о них до ответа: без них total comp неполный.`,
      acceptLabel: 'Изменить условия',
      onAccept: () => actions.edit(only.id),
    });
  }
  return suggestion({
    id: 'offers:empty',
    title: 'Что спросить о total comp',
    detail:
      'Офферов пока нет. На финальном этапе спросите про оклад, бонус, акции, ДМС и релокацию: из них соберём total comp.',
    acceptLabel: 'Добавить оффер',
    onAccept: actions.add,
  });
}

import { useLatestVacancyFitView } from './vacancyFitViewUpdates';
import type { VacancyFitView } from '../../../shared/vacancyFit';
const STATE_LABELS = {
  not_requested: 'Соответствие ещё не рассчитано',
  processing: 'Расчёт в очереди. Результат появится после обработки.',
  retrying: 'Не удалось рассчитать — повторим автоматически.',
  no_description: 'Нет описания вакансии для расчёта',
  no_requirements: 'В описании пока не найдены требования',
  failed: 'Расчёт недоступен. Попробуйте ещё раз.',
  ready: 'Недостаточно подтверждённых данных для расчёта',
};
const REASONS = {
  blocked_gate: 'Есть обязательное условие, которое не совпадает с профилем',
  unknown_gate: 'Не все обязательные условия подтверждены',
  no_requirements: 'Нет извлечённых требований для расчёта',
  no_eligible_facts: 'В профиле нет подтверждённых фактов для сравнения',
  assessment_unavailable: 'Не удалось сравнить с фактами профиля',
  too_few_skills: 'Мало требований к навыкам для расчёта',
  assessed: 'Недостаточно подтверждённых данных для расчёта',
};
/** Mirrors the server's MIN_SKILL_REQUIREMENTS (B510-r): fewer skills never make a percent (A1). */
const MIN_SKILL_REQUIREMENTS = 3;
export function fitHasNumber(view?: VacancyFitView) {
  return (
    view?.state === 'ready' &&
    view.result?.status === 'assessed' &&
    view.result.dataState !== 'unknown' &&
    typeof view.result.coveragePercent === 'number' &&
    Number.isFinite(view.result.coveragePercent) &&
    view.result.coveragePercent >= 0 &&
    view.result.coveragePercent <= 100 &&
    (view.result.coverage?.total ?? 0) >= MIN_SKILL_REQUIREMENTS
  );
}
function fitDate(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Дата расчёта неизвестна';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}
export function VacancyFitSummary({
  view: initialView,
  vacancyId,
  compact = false,
}: {
  readonly view?: VacancyFitView;
  readonly vacancyId?: string;
  readonly compact?: boolean;
}) {
  const view = useLatestVacancyFitView(vacancyId, initialView);
  const result = view?.result;
  const numeric = fitHasNumber(view);
  const reason =
    (view?.state === 'ready' && result
      ? REASONS[result.reason === 'assessed' && !numeric ? 'too_few_skills' : result.reason]
      : STATE_LABELS[view?.state ?? 'not_requested']) ?? STATE_LABELS.ready;
  return (
    <span
      className={`vacancy-fit-summary${compact ? ' is-compact' : ''}`}
      data-fit-state={view?.state ?? 'not_requested'}
    >
      <span className={compact ? 'career-sr-only' : 'vacancy-fit-label'}>
        Соответствие вашему профилю
      </span>
      {numeric && result && result.coveragePercent !== null ? (
        <>
          <strong className="vacancy-fit-percent">{result.coveragePercent}%</strong>
          <span>
            {result.coverage.matched} из {result.coverage.total} требований ·{' '}
            {fitDate(result.calculatedAt)}
          </span>
          <progress
            className="vacancy-fit-track"
            value={result.coveragePercent}
            max={100}
            aria-hidden="true"
          />
          {result.dataState === 'partial' ? <span>{partialNote(result)}</span> : null}
        </>
      ) : (
        <span>{compact ? `Соответствие: ${lowerFirst(reason)}` : reason}</span>
      )}
    </span>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The row shows only a calculated percent inside its subtitle line (V3); states live in the card. */
export function VacancyFitInline({
  view: initialView,
  vacancyId,
  short = false,
}: {
  readonly view?: VacancyFitView;
  readonly vacancyId?: string;
  /** B510: на 390 число стоит рядом с «Подходит», без слова «соответствие». */
  readonly short?: boolean;
}) {
  const view = useLatestVacancyFitView(vacancyId, initialView);
  if (!fitHasNumber(view)) return null;
  const percent = view!.result!.coveragePercent;
  if (short) {
    return (
      <span
        className="vacancy-fit-inline is-number is-short"
        data-fit-state={view!.state}
        aria-label={`соответствие ${percent} %`}
      >
        {percent}
        {'\u00a0%'}
      </span>
    );
  }
  return (
    <span className="vacancy-fit-inline is-number" data-fit-state={view!.state}>
      соответствие {percent}
      {'\u00a0%'}
    </span>
  );
}

const GATE_NAMES: Record<string, string> = {
  role: 'роль',
  level: 'уровень',
  region: 'регион',
  workAuthorization: 'право на работу',
  workFormat: 'формат работы',
};

/** Неподтверждённые условия называются прямо, а не прячутся в «совпадении». */
function partialNote(result: NonNullable<VacancyFitView['result']>): string {
  const unconfirmed = Object.entries(result.gates)
    .filter(([, gate]) => gate.status !== 'matched')
    .map(([name]) => GATE_NAMES[name] ?? name);
  return unconfirmed.length
    ? `Не подтверждено: ${unconfirmed.join(', ')}`
    : 'Часть требований пока не проверена';
}

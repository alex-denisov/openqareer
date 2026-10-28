import { vacancyFitPercent } from '../../../shared/vacancyFitPercent';
import { useLatestVacancyFitView } from './vacancyFitViewUpdates';
import type { VacancyFitView } from '../../../shared/vacancyFit';
const STATE_LABELS = {
  not_requested: 'Соответствие ещё не рассчитано',
  processing: 'Расчёт в очереди. Результат появится после обработки.',
  retrying: 'Не удалось рассчитать — повторим автоматически.',
  no_description: 'Нет описания вакансии для расчёта',
  no_requirements: 'В описании пока не найдены требования',
  failed: 'Расчёт не завершился',
  refreshing: 'Пересчитывается',
  ready: 'Недостаточно подтверждённых данных для расчёта',
};
/** B562-r: «не ответил» only when the model was unreachable; the card button is the action. */
const FAILURE_LABELS: Record<NonNullable<VacancyFitView['failure']>, string> = {
  model_unavailable: 'Расчёт не завершился: сервис сравнения не ответил',
  model_invalid: 'Расчёт не завершился: ответ сервиса сравнения не прошёл проверку',
  requirements: 'Расчёт не завершился: требования вакансии не разобраны',
  profile_changed: 'Профиль изменился во время расчёта',
  other: STATE_LABELS.failed,
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
/** One rule with the row, the block and the order (shared/vacancyFitPercent). */
export function fitHasNumber(view?: VacancyFitView) {
  return vacancyFitPercent(view) !== null;
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
      : view?.state === 'failed' && view.failure
        ? FAILURE_LABELS[view.failure]
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
          {view?.state === 'refreshing' ? <span>{STATE_LABELS.refreshing}</span> : null}
        </>
      ) : (
        <span>{compact ? `Соответствие: ${lowerFirst(reason)}` : reason}</span>
      )}
    </span>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

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

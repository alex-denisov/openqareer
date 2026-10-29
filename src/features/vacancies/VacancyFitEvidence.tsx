import { vacancyFitMark } from './vacancyFitModel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import { useState, useEffect, useRef } from 'react';
import { publishVacancyFitRead } from './vacancyFitViewUpdates';
import type { VacancyFitView, VacancyFitResult } from '../../../shared/vacancyFit';
import { VacancyFitSummary, fitHasNumber } from './VacancyFitSummary';
import { readVacancyFit, requestVacancyFit } from './vacancyFitApi';
const IMPORTANCE = {
  critical: 'Обязательное',
  high: 'Высокая',
  medium: 'Средняя',
  low: 'Желательно',
};
const ORIGIN = {
  explicit: 'Указано явно',
  structural: 'Из раздела требований',
  inferred: 'Требует уточнения',
};
const STATUS = { matched: 'Подтверждено', unmatched: 'Не подтверждено', unknown: 'Не проверено' };
const GATES = {
  role: 'Роль',
  level: 'Уровень',
  region: 'Регион',
  workAuthorization: 'Право на работу',
  workFormat: 'Формат работы',
};
function FitGates({ result }: { readonly result?: VacancyFitResult }) {
  if (!result) return null;
  return (
    <ul className="vacancy-fit-gates">
      {Object.entries(result.gates)
        .filter(([, gate]) => gate.status !== 'matched')
        .map(([name, gate]) => (
          <li key={name}>
            <strong>{GATES[name as keyof typeof GATES]}:</strong> {gate.reason}
          </li>
        ))}
    </ul>
  );
}
function FitEvidenceRow({
  requirement,
  assessment,
  onAddToProfile,
}: {
  readonly requirement: VacancyFitView['requirements'][number];
  readonly assessment?: VacancyFitResult['assessments'][number];
  readonly onAddToProfile?: (requirement: string) => void;
}) {
  return (
    <tr>
      <th scope="row">
        <span className="vacancy-fit-cell-label">Требование и источник</span>
        <span>{requirement.text}</span>
        <q>{requirement.sourceQuote}</q>
        <small>{ORIGIN[requirement.origin]}</small>
      </th>
      <td>
        <span className="vacancy-fit-cell-label">Важность</span>
        {IMPORTANCE[requirement.importance]}
        {requirement.stopFactor ? <small>Стоп-фактор</small> : null}
      </td>
      <td>
        <span className="vacancy-fit-cell-label">Факты профиля</span>
        <span>{STATUS[assessment?.status ?? 'unknown']}</span>
        {assessment?.status !== 'matched' && onAddToProfile ? (
          <button
            type="button"
            className="career-vacancy-action vacancies-req-action-btn"
            onClick={() => onAddToProfile(requirement.text)}
          >
            Добавить в профиль
          </button>
        ) : null}
        {assessment?.evidence.map((fact) => (
          <span className="vacancy-fit-fact" key={`${fact.factId}:${fact.quote}`}>
            <span>Из профиля</span>
            <q>{fact.quote}</q>
          </span>
        ))}
      </td>
    </tr>
  );
}
function FitEvidenceTable({
  view,
  onAddToProfile,
}: {
  readonly view: VacancyFitView;
  readonly onAddToProfile?: (requirement: string) => void;
}) {
  if (!view.requirements.length) return null;
  return (
    <table className="vacancy-fit-table">
      <caption>Требования и подтверждения</caption>
      <thead>
        <tr>
          <th scope="col">Требование и источник</th>
          <th scope="col">Важность</th>
          <th scope="col">Факты профиля</th>
        </tr>
      </thead>
      <tbody>
        {view.requirements.map((requirement) => (
          <FitEvidenceRow
            key={requirement.id}
            requirement={requirement}
            assessment={view.result?.assessments.find(
              (item) => item.requirementId === requirement.id,
            )}
            onAddToProfile={onAddToProfile}
          />
        ))}
      </tbody>
    </table>
  );
}
/** A 202 answer may carry only the state; keep what is already known about the requirements. */
function withRequirements(next: VacancyFitView, before: VacancyFitView): VacancyFitView {
  return { ...before, ...next, requirements: next.requirements ?? before.requirements };
}
/** How often an opened vacancy re-reads a percent that is still counting. */
const FIT_COUNTING_POLL_MS = 15_000;

function useFitRequest(vacancyId: string, initialView?: VacancyFitView) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [loaded, setLoaded] = useState<{ id: string; view: VacancyFitView }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const view =
    loaded?.id === vacancyId
      ? loaded.view
      : (initialView ?? { state: 'not_requested' as const, requirements: [] });
  async function load(enqueue: boolean) {
    setBusy(true);
    setError(undefined);
    const before = view;
    // G5 item 9: the click shows «в очереди» at once; the POST answer replaces it.
    if (enqueue) setLoaded({ id: vacancyId, view: { ...before, state: 'processing' } });
    try {
      const next = enqueue
        ? withRequirements(await requestVacancyFit(vacancyId), before)
        : await readVacancyFit(vacancyId);
      if (!mounted.current) return;
      setLoaded({ id: vacancyId, view: next });
      publishVacancyFitRead(vacancyId, next);
    } catch {
      if (!mounted.current) return;
      if (enqueue) setLoaded({ id: vacancyId, view: before });
      setError(
        enqueue
          ? 'Не удалось поставить расчёт в очередь. Проверьте соединение и повторите.'
          : 'Не удалось обновить соответствие. Проверьте соединение и повторите.',
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  // Список приносит только сводку; полный разбор подгружается при раскрытии.
  const needsDetail =
    (view.state === 'ready' || view.state === 'refreshing') && view.requirements.length === 0;
  useEffect(() => {
    if (needsDetail) void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened vacancy
  }, [vacancyId, needsDetail]);
  // B580: обход подборки на Free считает первые 300; остальные — когда кандидат открыл вакансию.
  const uncountedOnOpen = initialView?.state === 'not_requested';
  useEffect(() => {
    if (uncountedOnOpen) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened vacancy
  }, [vacancyId, uncountedOnOpen]);
  return { view, busy, error, load };
}
/** B446-g4: в карточке экрана пересчёт готового результата скрыт; кнопка — для
 *  первого расчёта, сбоя и чтения результата из очереди. */
function FitRequestControls({
  state,
  compact,
}: {
  readonly state: ReturnType<typeof useFitRequest>;
  readonly compact: boolean;
}) {
  const { view, busy, error, load } = state;
  // `refreshing` (B562-r) is queued too: the previous percent stays until the new one is read.
  const queued = view.state === 'processing' || view.state === 'refreshing';
  const requestable = compact ? ['not_requested', 'failed'] : ['not_requested', 'failed', 'ready'];
  const canRequest = requestable.includes(view.state);
  const canRefresh = queued || Boolean(error) || (!compact && view.state === 'ready');
  return (
    <>
      <div className="vacancy-fit-actions">
        {canRequest ? (
          <button
            type="button"
            className="career-vacancy-action vacancies-btn vacancies-btn-secondary"
            disabled={busy}
            onClick={(event) => {
              // The button lives inside an expandable row: the click is the fit request only.
              event.stopPropagation();
              void load(true);
            }}
          >
            {busy
              ? 'Отправляем запрос…'
              : view.state === 'ready'
                ? 'Пересчитать соответствие'
                : 'Рассчитать соответствие'}
          </button>
        ) : null}
        {canRefresh ? (
          <button
            type="button"
            className="career-vacancy-action vacancies-btn vacancies-btn-secondary"
            disabled={busy}
            onClick={() => void load(false)}
          >
            {busy ? 'Обновляем…' : 'Обновить результат'}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
export function VacancyFitEvidence({
  vacancyId,
  initialView,
  onAddToProfile,
  showTable = true,
  hideWhenNumber = false,
}: {
  readonly vacancyId: string;
  readonly initialView?: VacancyFitView;
  readonly onAddToProfile?: (requirement: string) => void;
  readonly showTable?: boolean;
  /** Mockup 4: the row already says «соответствие N %», so the card shows only states. */
  readonly hideWhenNumber?: boolean;
}) {
  const state = useFitRequest(vacancyId, initialView);
  // 28.10 mockup: the fit block above already says «считаем» while the percent is counting;
  // the worker answers within a minute, so the opened vacancy reads it again on its own.
  const counting = hideWhenNumber && vacancyFitMark(state.view).kind === 'pending';
  useEffect(() => {
    if (!counting) return undefined;
    const timer = window.setInterval(() => void state.load(false), FIT_COUNTING_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer while counting
  }, [vacancyId, counting]);
  if (hideWhenNumber && (fitHasNumber(state.view) || counting)) return null;
  const compact = !showTable;
  return (
    <section
      className={`vacancy-fit-evidence${compact ? ' is-compact' : ''}`}
      aria-label="Соответствие вашему профилю"
      aria-busy={state.busy}
    >
      <div role="status" aria-live="polite">
        <VacancyFitSummary view={state.view} compact={compact} />
      </div>
      {compact ? null : (
        <>
          <p className="vacancy-fit-note">
            Доля требований, подтверждённых фактами профиля. Вероятность найма не оценивается.
          </p>
          <FitGates result={state.view.result} />
          <FitEvidenceTable view={state.view} onAddToProfile={onAddToProfile} />
        </>
      )}
      <FitRequestControls state={state} compact={compact} />
    </section>
  );
}

export function VacancyFitEvidenceForItem({
  item,
  onAddToProfile,
  showTable,
  hideWhenNumber,
}: {
  readonly item: MatchedVacancyItem;
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
  readonly showTable?: boolean;
  readonly hideWhenNumber?: boolean;
}) {
  return (
    <VacancyFitEvidence
      key={item.cluster.id}
      showTable={showTable}
      hideWhenNumber={hideWhenNumber}
      vacancyId={item.cluster.id}
      initialView={item.explanation.fitView}
      onAddToProfile={
        onAddToProfile
          ? (requirement) =>
              onAddToProfile({
                requirement,
                vacancyId: item.cluster.id,
                vacancyTitle: item.cluster.canonicalTitle,
                vacancyCompany: item.cluster.canonicalCompany,
              })
          : undefined
      }
    />
  );
}

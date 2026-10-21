import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import { useState, useEffect, useRef } from 'react';
import { publishVacancyFitRead } from './vacancyFitViewUpdates';
import type { VacancyFitView, VacancyFitResult } from '../../../shared/vacancyFit';
import { VacancyFitSummary } from './VacancyFitSummary';
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
    try {
      if (enqueue) await requestVacancyFit(vacancyId);
      const next = await readVacancyFit(vacancyId);
      if (!mounted.current) return;
      setLoaded({ id: vacancyId, view: next });
      publishVacancyFitRead(vacancyId, next);
    } catch {
      if (mounted.current)
        setError('Не удалось обновить соответствие. Проверьте соединение и повторите.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  // Список приносит только сводку; полный разбор подгружается при раскрытии.
  const needsDetail = view.state === 'ready' && view.requirements.length === 0;
  useEffect(() => {
    if (needsDetail) void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened vacancy
  }, [vacancyId, needsDetail]);
  return { view, busy, error, load };
}
function FitRequestControls({ state }: { readonly state: ReturnType<typeof useFitRequest> }) {
  const { view, busy, error, load } = state;
  const queued = view.state === 'processing';
  const canRequest = ['not_requested', 'failed', 'ready'].includes(view.state);
  return (
    <>
      <div className="vacancy-fit-actions">
        {canRequest ? (
          <button
            type="button"
            className="career-vacancy-action vacancies-btn vacancies-btn-secondary"
            disabled={busy}
            onClick={() => void load(true)}
          >
            {busy
              ? 'Отправляем запрос…'
              : view.state === 'ready'
                ? 'Пересчитать соответствие'
                : 'Рассчитать соответствие'}
          </button>
        ) : null}
        {queued || view.state === 'ready' || error ? (
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
}: {
  readonly vacancyId: string;
  readonly initialView?: VacancyFitView;
  readonly onAddToProfile?: (requirement: string) => void;
  readonly showTable?: boolean;
}) {
  const state = useFitRequest(vacancyId, initialView);
  return (
    <section
      className="vacancy-fit-evidence"
      aria-label="Соответствие вашему профилю"
      aria-busy={state.busy}
    >
      <div role="status" aria-live="polite">
        <VacancyFitSummary view={state.view} />
      </div>
      <p className="vacancy-fit-note">
        Доля требований, подтверждённых фактами профиля. Вероятность найма не оценивается.
      </p>
      <FitGates result={state.view.result} />
      {showTable ? <FitEvidenceTable view={state.view} onAddToProfile={onAddToProfile} /> : null}
      <FitRequestControls state={state} />
    </section>
  );
}

export function VacancyFitEvidenceForItem({
  item,
  onAddToProfile,
  showTable,
}: {
  readonly item: MatchedVacancyItem;
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
  readonly showTable?: boolean;
}) {
  return (
    <VacancyFitEvidence
      key={item.cluster.id}
      showTable={showTable}
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

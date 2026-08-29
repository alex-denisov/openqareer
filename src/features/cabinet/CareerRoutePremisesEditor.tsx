import { useState, type FormEvent } from 'react';
import { CANDIDATE_REGION_CATALOGUE, type CandidateRegion } from '../workspace/candidateRegions';
import type { RoutePremisesDraft, RouteWorkMode } from './routePremises';

const WORK_MODE_OPTIONS: ReadonlyArray<readonly [RouteWorkMode, string]> = [
  ['remote', 'Удалённо'],
  ['hybrid', 'Гибрид'],
  ['office', 'Офис'],
  ['flexible', 'Гибкий формат'],
];

/**
 * The editor for the premises «Карьера» shows. Before B160 the same button
 * opened the «Аккаунт» panel, which holds none of these three fields, so the
 * candidate could read their route premises but never change them.
 */
export function CareerRoutePremisesEditor({
  initial,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: RoutePremisesDraft;
  saving: boolean;
  error?: string;
  onSave: (draft: RoutePremisesDraft) => void;
  onCancel: () => void;
}) {
  const [targetRole, setTargetRole] = useState(initial.targetRole);
  const [regions, setRegions] = useState<readonly CandidateRegion[]>(initial.regions);
  const [workMode, setWorkMode] = useState<RouteWorkMode | null>(initial.workMode);

  function toggleRegion(region: CandidateRegion, checked: boolean) {
    setRegions((current) =>
      checked ? [...current, region] : current.filter((item) => item !== region),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ targetRole, regions, workMode });
  }

  return (
    <form className="career-route-premises-editor" onSubmit={submit} aria-label="Роль и условия маршрута">
      <div className="career-route-premises-field">
        <label htmlFor="premises-role">Роль и уровень</label>
        <input
          id="premises-role"
          name="targetRole"
          type="text"
          value={targetRole}
          maxLength={220}
          onChange={(event) => setTargetRole(event.target.value)}
        />
      </div>

      <RegionChoice regions={regions} onToggle={toggleRegion} />

      <WorkModeChoice workMode={workMode} onChange={setWorkMode} />

      <EditorFooter saving={saving} error={error} onCancel={onCancel} />
    </form>
  );
}

function RegionChoice({
  regions,
  onToggle,
}: {
  regions: readonly CandidateRegion[];
  onToggle: (region: CandidateRegion, checked: boolean) => void;
}) {
  return (
    <fieldset className="career-route-premises-field">
      <legend>География</legend>
      <div className="career-route-premises-regions">
        {CANDIDATE_REGION_CATALOGUE.map((region) => (
          <label key={region.id} htmlFor={`premises-region-${region.id}`}>
            <input
              id={`premises-region-${region.id}`}
              type="checkbox"
              checked={regions.includes(region.id)}
              onChange={(event) => onToggle(region.id, event.target.checked)}
            />
            {region.label}
          </label>
        ))}
      </div>
      <p className="career-route-premises-hint">
        Можно выбрать несколько регионов. Пустой список — честный ответ «ещё не решил».
      </p>
    </fieldset>
  );
}

function WorkModeChoice({
  workMode,
  onChange,
}: {
  workMode: RouteWorkMode | null;
  onChange: (mode: RouteWorkMode | null) => void;
}) {
  return (
    <div className="career-route-premises-field">
      <label htmlFor="premises-work-mode">Формат работы</label>
      <select
        id="premises-work-mode"
        name="workMode"
        value={workMode ?? ''}
        onChange={(event) => onChange((event.target.value || null) as RouteWorkMode | null)}
      >
        <option value="">Не указан</option>
        {WORK_MODE_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function EditorFooter({
  saving,
  error,
  onCancel,
}: {
  saving: boolean;
  error?: string;
  onCancel: () => void;
}) {
  return (
    <>
      {error ? (
        <p className="career-route-premises-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="career-route-premises-actions">
        <button className="career-primary-button" type="submit" disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить предпосылки'}
        </button>
        <button className="career-quiet-button" type="button" onClick={onCancel} disabled={saving}>
          Отмена
        </button>
      </div>
    </>
  );
}

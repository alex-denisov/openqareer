import { pluralRu } from '../../../shared/pluralRu';
import {
  type CandidateRegion,
  type CandidateRegionProfile,
} from '../workspace/candidateRegions';

interface VacancyHypothesisBannerProps {
  readonly role: string;
  readonly vacancyCount: number;
  readonly adjacentRole?: { readonly id: string; readonly title: string };
  readonly availableRegions: readonly CandidateRegionProfile[];
  readonly regionsOpen: boolean;
  readonly remoteOnly: boolean;
  readonly saving: boolean;
  readonly error?: string;
  readonly onAddAdjacentRole: (role: { readonly id: string; readonly title: string }) => void;
  readonly onAddRegion: (region: CandidateRegion) => void;
  readonly onToggleRegions: () => void;
  readonly onToggleRemote: () => void;
}

export function VacancyHypothesisBanner(props: VacancyHypothesisBannerProps) {
  return (
    <section className="vacancy-hypothesis-banner" aria-label="Гипотеза по роли">
      <div className="vacancy-hypothesis-copy">
        <p className="vacancy-hypothesis-title">Это гипотеза, не результат.</p>
        <p>
          По роли {props.role} найдено{' '}
          {pluralRu(props.vacancyCount, ['вакансия', 'вакансии', 'вакансий'])}. Пока этого мало,
          чтобы делать вывод о рынке.
        </p>
      </div>
      <CampaignActionButtons {...props} />
      {props.regionsOpen ? (
        <RegionChoices
          regions={props.availableRegions}
          saving={props.saving}
          onSelect={(region) => props.onAddRegion(region.id)}
        />
      ) : null}
      {props.saving ? <p className="vacancy-hypothesis-status" role="status">Сохраняем кампанию…</p> : null}
      {props.error ? <p className="vacancy-hypothesis-error" role="alert">{props.error}</p> : null}
    </section>
  );
}

function CampaignActionButtons({
  adjacentRole,
  availableRegions,
  regionsOpen,
  remoteOnly,
  saving,
  onAddAdjacentRole,
  onToggleRegions,
  onToggleRemote,
}: Pick<
  VacancyHypothesisBannerProps,
  | 'adjacentRole'
  | 'availableRegions'
  | 'regionsOpen'
  | 'remoteOnly'
  | 'saving'
  | 'onAddAdjacentRole'
  | 'onToggleRegions'
  | 'onToggleRemote'
>) {
  return (
    <div className="vacancy-hypothesis-actions" aria-label="Как изменить кампанию">
      <AdjacentRoleAction role={adjacentRole} saving={saving} onSelect={onAddAdjacentRole} />
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        aria-expanded={regionsOpen}
        onClick={onToggleRegions}
        disabled={saving || availableRegions.length === 0}
      >
        {regionsOpen ? 'Скрыть регионы' : 'Расширить географию'}
      </button>
      <button
        type="button"
        className={`vacancies-btn vacancies-btn-secondary${remoteOnly ? ' is-selected' : ''}`}
        aria-pressed={remoteOnly}
        disabled={saving}
        onClick={onToggleRemote}
      >
        {remoteOnly ? 'Отключить «Удалённо»' : 'Добавить «Удалённо»'}
      </button>
    </div>
  );
}

function AdjacentRoleAction({
  role,
  saving,
  onSelect,
}: {
  readonly role?: VacancyHypothesisBannerProps['adjacentRole'];
  readonly saving: boolean;
  readonly onSelect: VacancyHypothesisBannerProps['onAddAdjacentRole'];
}) {
  if (!role) return <span className="vacancy-hypothesis-note">Смежная роль из автонабора не предложена.</span>;
  return (
    <button
      type="button"
      className="vacancies-btn vacancies-btn-secondary"
      disabled={saving}
      onClick={() => onSelect(role)}
    >
      Добавить смежную роль «{role.title}»
    </button>
  );
}

function RegionChoices({
  regions,
  saving,
  onSelect,
}: {
  readonly regions: readonly CandidateRegionProfile[];
  readonly saving: boolean;
  readonly onSelect: (region: CandidateRegionProfile) => void;
}) {
  if (regions.length === 0) {
    return <p className="vacancy-hypothesis-note">Все доступные регионы уже выбраны.</p>;
  }
  return (
    <div className="vacancy-hypothesis-regions" role="group" aria-label="Добавить регион">
      {regions.map((region) => (
        <button
          key={region.id}
          type="button"
          className="vacancies-chip"
          disabled={saving}
          onClick={() => onSelect(region)}
        >
          Добавить {region.label}
        </button>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { CANDIDATE_REGION_CATALOGUE, type CandidateRegion } from '../workspace/candidateRegions';
import { ONBOARDING_FORMAT_OPTIONS, type OnboardingFormat } from './onboardingFormat';

export type OnboardingCampaignState = 'loading' | 'model' | 'fallback';

export interface OnboardingCampaignRole {
  readonly id: string;
  /** Server title used for vacancy matching and saving the campaign. */
  readonly title: string;
  readonly titleRu?: string;
  readonly level?: 'ic' | 'lead' | 'head' | 'vp' | 'c-level' | null;
  readonly kind?: 'primary' | 'adjacent';
  readonly reason?: string;
  readonly evidence?: readonly string[];
  readonly source: 'model' | 'profile' | 'candidate';
}

interface OnboardingCampaignStepProps {
  readonly state: OnboardingCampaignState;
  readonly roles: readonly OnboardingCampaignRole[];
  readonly selectedRoleIds: readonly string[];
  readonly regions: readonly CandidateRegion[];
  readonly format: OnboardingFormat;
  readonly elapsedSeconds: number;
  readonly error?: string;
  readonly onToggleRole: (roleId: string) => void;
  readonly onAddRole: (title: string) => void;
  readonly onToggleRegion: (region: CandidateRegion) => void;
  readonly onChangeFormat: (format: OnboardingFormat) => void;
}

const LEVEL_LABEL: Record<NonNullable<OnboardingCampaignRole['level']>, string> = {
  ic: 'IC',
  lead: 'Lead',
  head: 'Head',
  vp: 'VP',
  'c-level': 'C-level',
};

const ROLE_SOURCE_LABEL: Record<OnboardingCampaignRole['source'], string> = {
  model: 'Гипотеза модели',
  profile: 'Из профиля',
  candidate: 'Добавлено вами',
};

export function OnboardingCampaignStep(props: OnboardingCampaignStepProps) {
  if (props.state === 'loading') return <CampaignProgress elapsedSeconds={props.elapsedSeconds} />;

  return (
    <div className="career-onboarding-campaign">
      <CampaignStateNotice state={props.state} error={props.error} />
      <CampaignRolePicker {...props} />
      <CampaignRegionPicker {...props} />
    </div>
  );
}

function CampaignStateNotice({ state, error }: { state: OnboardingCampaignState; error?: string }) {
  if (state === 'model') return null;
  return (
    <p className="career-inline-note" role="status">
      {error ?? 'Модель не успела ответить за 90 секунд.'} Ниже роли из профиля. Проверьте их,
      выберите подходящие или добавьте свою.
    </p>
  );
}

function CampaignRolePicker(props: OnboardingCampaignStepProps) {
  return (
    <section aria-label="Роли для подбора">
      <h2>Роли</h2>
      {props.roles.length === 0 ? (
        <p className="career-inline-note">
          Роли из профиля не распознаны. Добавьте роль, по которой ищете работу.
        </p>
      ) : (
        <div className="career-onboarding-role-grid">
          {props.roles.map((role) => (
            <CampaignRoleCard
              key={role.id}
              role={role}
              selected={props.selectedRoleIds.includes(role.id)}
              onToggle={() => props.onToggleRole(role.id)}
            />
          ))}
        </div>
      )}
      <AddCampaignRole onAdd={props.onAddRole} />
    </section>
  );
}

function CampaignRoleCard({
  role,
  selected,
  onToggle,
}: {
  role: OnboardingCampaignRole;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`career-onboarding-role-card ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onToggle}
    >
      <span className="career-onboarding-role-title">{role.titleRu ?? role.title}</span>
      <span className="career-onboarding-role-meta">
        <span className={`tag ${role.source === 'model' ? 'tag-hypothesis' : ''}`}>
          {ROLE_SOURCE_LABEL[role.source]}
        </span>
        <span className="tag career-onboarding-role-level">
          {role.level ? `Уровень: ${LEVEL_LABEL[role.level]}` : 'Уровень уточняется'}
        </span>
      </span>
      <span className="career-onboarding-role-evidence">
        <span>
          {role.reason ?? (role.source === 'profile' ? 'Взята из профиля' : 'Добавлена вами')}
        </span>
        {role.evidence?.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </span>
    </button>
  );
}

function AddCampaignRole({ onAdd }: { onAdd: (title: string) => void }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  function submit() {
    if (!draft.trim()) return;
    onAdd(draft.trim());
    setDraft('');
    setOpen(false);
  }
  if (!open) {
    return (
      <button type="button" className="career-quiet-button" onClick={() => setOpen(true)}>
        Добавить роль
      </button>
    );
  }
  return (
    <div className="career-onboarding-campaign-add-role">
      <label>
        <span>Новая роль</span>
        <input
          maxLength={200}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <button
        type="button"
        className="career-btn career-btn-secondary"
        disabled={!draft.trim()}
        onClick={submit}
      >
        Добавить
      </button>
      <button type="button" className="career-quiet-button" onClick={() => setOpen(false)}>
        Отмена
      </button>
    </div>
  );
}

function CampaignRegionPicker(props: OnboardingCampaignStepProps) {
  return (
    <section aria-label="Регионы для подбора">
      <h2>Регионы</h2>
      <RegionChoices regions={props.regions} onToggle={props.onToggleRegion} />
      <FormatChoices format={props.format} onChange={props.onChangeFormat} />
    </section>
  );
}

function RegionChoices({
  regions,
  onToggle,
}: {
  regions: readonly CandidateRegion[];
  onToggle: (region: CandidateRegion) => void;
}) {
  return (
    <div className="career-onboarding-geo-grid" role="group" aria-label="Где рассматриваете работу">
      {CANDIDATE_REGION_CATALOGUE.map((region) => (
        <button
          key={region.id}
          type="button"
          className={`tag ${regions.includes(region.id) ? 'is-selected' : ''}`}
          aria-pressed={regions.includes(region.id)}
          onClick={() => onToggle(region.id)}
        >
          {region.label}
        </button>
      ))}
    </div>
  );
}

function FormatChoices({
  format,
  onChange,
}: {
  format: OnboardingFormat;
  onChange: (format: OnboardingFormat) => void;
}) {
  return (
    <>
      <div className="career-onboarding-format-row" role="radiogroup" aria-label="Формат работы">
        {ONBOARDING_FORMAT_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={format === option}
            className={`tag ${format === option ? 'is-selected' : ''}`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <label className="career-onboarding-format-select">
        <span>Формат работы</span>
        <select
          value={format}
          onChange={(event) => onChange(event.target.value as OnboardingFormat)}
        >
          {ONBOARDING_FORMAT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function CampaignProgress({ elapsedSeconds }: { readonly elapsedSeconds: number }) {
  const remainingSeconds = Math.max(0, 90 - elapsedSeconds);
  return (
    <div
      className="career-onboarding-progress-list"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <h2>Собираем роли по профилю</h2>
      <p>Запрос отправлен модели. Ждём подтверждённый ответ, до таймаута — 90 секунд.</p>
      <p>
        Прошло {elapsedSeconds} с · осталось ждать до {remainingSeconds} с
      </p>
      <div className="career-onboarding-progress-row is-active">
        <span className="career-onboarding-progress-mark" aria-hidden="true" />
        <span>Подбираем роли с опорой на опыт</span>
      </div>
    </div>
  );
}

export interface OnboardingQuickStartStepProps {
  readonly roleTitle: string;
  readonly regions: readonly CandidateRegion[];
  readonly format: OnboardingFormat;
  readonly onRoleChange: (role: string) => void;
  readonly onToggleRegion: (region: CandidateRegion) => void;
  readonly onChangeFormat: (format: OnboardingFormat) => void;
}

export function OnboardingQuickStartStep(props: OnboardingQuickStartStepProps) {
  return (
    <div className="career-onboarding-quick-start">
      <label>
        <span>На какую роль ищете работу?</span>
        <input
          autoComplete="organization-title"
          maxLength={200}
          value={props.roleTitle}
          onChange={(event) => props.onRoleChange(event.target.value)}
          placeholder="Например, аналитик данных"
        />
      </label>
      <RegionChoices regions={props.regions} onToggle={props.onToggleRegion} />
      <FormatChoices format={props.format} onChange={props.onChangeFormat} />
    </div>
  );
}

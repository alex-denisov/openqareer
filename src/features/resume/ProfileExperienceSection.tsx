import { ProfileEmployerName } from './ProfileEmployerName';
import { useRef, useState } from 'react';
import { CollapsiblePlace, EXPANDED_PLACES } from './ProfileExperienceCollapsed';
import { experienceChips, profileLanguage, type ExperienceChip } from './experienceChips';
import {
  Buildings,
  CheckCircle,
  House,
  Info,
  Laptop,
  MapPin,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import { CareerTooltip } from '../shell/CareerTooltip';
import type { CandidateMemory } from '../coach/coachApi';
import { groupExperienceByEmployer } from './profileGrouping';
import { addExperience, removeExperience, updateExperience } from './resumeStudioModel';
import { SectionAddButton, SectionPencilButton, SectionRemoveButton } from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import { useCandidateMediaSrc } from './candidateMediaSrc';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';
import { ProfileExperienceSuggestions } from './ProfileExperienceSuggestions';
import { ExperienceFactRewrite } from './ProfileExperienceFacts';
import { PositionEditForm } from './ProfileExperienceEditor';
import { displayMonth, monthOrder } from './experienceDate';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';
import { VacancyRequirementAssistant } from './VacancyRequirementAssistant';
import { ProfileTeamSizeTag } from './ProfileTeamSizeTag';
import {
  ConfirmExperienceButton,
  experienceConfirmation,
  experienceConfirmationLabel,
} from './ExperienceConfirmation';
import type { VacancyProfileRequirementRequest } from '../vacancies/vacancyProfileRequirement';

export interface ProfileExperienceSectionProps {
  readonly candidateId?: string;
  readonly draft: ResumeDraft;
  readonly memory?: readonly CandidateMemory[];
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly vacancyRequirement?: VacancyProfileRequirementRequest;
  readonly onVacancyRequirementHandled?: () => void;
  readonly onVacancySuggestionPrepared?: (commandId: string) => Promise<void> | void;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
}

/**
 * Resolves a position's `bulletMemoryIds` against the candidate's memory —
 * the same fact store Resume Studio's evidence picker reads — into plain
 * responsibility text, in the order the position lists the ids (mockup
 * "Отвечал за платёжную стратегию…" bullets under every job).
 */
export function responsibilityBullets(
  entry: ResumeExperienceInput,
  memory: readonly CandidateMemory[],
): readonly string[] {
  if (!entry.bulletMemoryIds.length || !memory.length) return [];
  const byId = new Map(memory.map((item) => [item.id, item.statement]));
  return entry.bulletMemoryIds.flatMap((id) => {
    const statement = byId.get(id)?.trim();
    return statement ? [statement] : [];
  });
}

const WORKPLACE_ICON: Record<string, Icon> = {
  on_site: Buildings,
  hybrid: House,
  remote: Laptop,
};

type ExperiencePatchHandler = (
  entry: ResumeExperienceInput,
  patch: Partial<ResumeExperienceInput>,
) => Promise<boolean | void> | boolean | void;

export function periodLabel(entry: ResumeExperienceInput): string {
  if (!entry.startDate) return '';
  const start = displayMonth(entry.startDate);
  const end = entry.current ? 'по н. в.' : displayMonth(entry.endDate ?? '');
  return end ? `${start} — ${end}` : start;
}

function CompanyMark({
  employer,
  employerLogoMediaId,
}: {
  readonly employer: string;
  readonly employerLogoMediaId?: string;
}) {
  const src = useCandidateMediaSrc(employerLogoMediaId);
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        className="career-profile-screen-company-logo"
        src={src}
        onError={() => setBroken(true)}
        alt=""
        width={44}
        height={44}
      />
    );
  }
  const initials = employer.trim().slice(0, 2).toUpperCase() || '?';
  return (
    <span className="career-profile-screen-company-logo" aria-hidden="true">
      {initials}
    </span>
  );
}

function PositionSummary({
  entry,
  bullets,
  memory,
  onEdit,
  onRemove,
  onConfirmed,
}: {
  readonly entry: ResumeExperienceInput;
  readonly bullets: readonly string[];
  readonly memory: readonly CandidateMemory[];
  readonly onEdit: () => void;
  readonly onRemove: () => void;
  readonly onConfirmed?: () => Promise<void> | void;
}) {
  return (
    <div className="career-profile-screen-position" data-experience-id={entry.id}>
      <div className="career-profile-screen-position-title-row">
        <div className="profile-position-identity">
          <b>{entry.employer || 'Работодатель не указан'}</b>
          <p>{entry.title || 'Должность не указана'}</p>
        </div>
        {periodLabel(entry) ? (
          <span className="career-profile-screen-position-dates">{periodLabel(entry)}</span>
        ) : null}
        <SectionPencilButton
          visibleText="Редактировать место"
          label={`Редактировать место целиком: ${entry.employer || 'работодатель не указан'}`}
          onClick={onEdit}
        />
        <SectionRemoveButton label="Удалить должность" onClick={onRemove} />
      </div>
      <PositionEvidenceBadge
        entry={entry}
        bullets={bullets}
        memory={memory}
        onConfirmed={onConfirmed}
      />
      <PositionDetails
        entry={entry}
        bullets={bullets}
        description={
          entry.descriptionMemoryId
            ? memory.find((fact) => fact.id === entry.descriptionMemoryId)?.statement
            : undefined
        }
      />
    </div>
  );
}

const CHIP_ICON: Partial<Record<ExperienceChip['key'], Icon>> = {
  location: MapPin,
  team: UsersThree,
};

function PositionChips({
  entry,
  texts,
}: {
  readonly entry: ResumeExperienceInput;
  readonly texts: readonly string[];
}) {
  const lang = profileLanguage([entry.title, ...texts]);
  return (
    <>
      {experienceChips(entry, texts, lang).map((chip) => {
        const ChipIcon =
          chip.key === 'workplace' && entry.workplaceType
            ? WORKPLACE_ICON[entry.workplaceType]
            : CHIP_ICON[chip.key];
        return (
          <span
            key={chip.key}
            className={`career-profile-screen-tag${chip.accent ? ' is-accent' : ''}`}
            data-chip={chip.key}
          >
            {ChipIcon ? <ChipIcon size={14} aria-hidden="true" /> : null}
            {chip.label}
          </span>
        );
      })}
    </>
  );
}

function PositionEvidenceBadge({
  entry,
  bullets,
  memory,
  onConfirmed,
}: {
  readonly entry: ResumeExperienceInput;
  readonly bullets: readonly string[];
  readonly memory: readonly CandidateMemory[];
  readonly onConfirmed?: () => Promise<void> | void;
}) {
  const confirmation = experienceConfirmation(entry, memory);
  return (
    <div className="career-profile-screen-position-tags">
      <PositionChips entry={entry} texts={bullets} />
      {confirmation.confirmed ? (
        <span
          className="career-profile-screen-tag is-verified"
          title="Работодатель не проверяется; подтверждение относится к фактам профиля."
          aria-label={`${experienceConfirmationLabel(confirmation)}. Работодатель не проверяется.`}
          data-chip="confirmed"
        >
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          Подтверждено
        </span>
      ) : entry.bulletMemoryIds.length > 0 ? (
        <ConfirmExperienceButton experienceId={entry.id} onConfirmed={onConfirmed} />
      ) : null}
      {entry.teamSize ? null : <ProfileTeamSizeTag teamSize={entry.teamSize} />}
    </div>
  );
}

function PositionDetails({
  entry,
  bullets,
  description,
}: {
  readonly entry: ResumeExperienceInput;
  readonly bullets: readonly string[];
  readonly description?: string;
}) {
  return (
    <>
      {description ? <p className="career-profile-position-description">{description}</p> : null}
      {bullets.length ? (
        <ul className="career-profile-screen-position-bullets">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
      {entry.skills?.length ? (
        <div className="career-profile-screen-skill-row">
          {entry.skills.map((skill) => (
            <span key={skill} className="career-profile-screen-tag">
              {skill}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function PositionRow({
  entry,
  bullets,
  memory,
  candidateId,
  saving,
  onSave,
  onRemove,
  onManualExperienceFactAdded,
}: {
  readonly entry: ResumeExperienceInput;
  readonly bullets: readonly string[];
  readonly memory: readonly CandidateMemory[];
  readonly candidateId?: string;
  readonly saving?: boolean;
  readonly onSave: (
    patch: Partial<ResumeExperienceInput>,
  ) => Promise<boolean | void> | boolean | void;
  readonly onRemove: () => void;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <PositionEditForm
        entry={entry}
        memory={memory}
        candidateId={candidateId}
        saving={saving}
        onManualExperienceFactAdded={onManualExperienceFactAdded}
        onCancel={() => setEditing(false)}
        onDone={() => setEditing(false)}
        onSave={onSave}
      />
    );
  }
  return (
    <PositionSummary
      entry={entry}
      bullets={bullets}
      memory={memory}
      onEdit={() => setEditing(true)}
      onRemove={onRemove}
      onConfirmed={onManualExperienceFactAdded}
    />
  );
}

function CompanyHead({
  group,
}: {
  readonly group: ReturnType<typeof groupExperienceByEmployer>[number];
}) {
  return (
    <div className="career-profile-screen-company-head">
      <CompanyMark
        employer={group.employer}
        employerLogoMediaId={group.positions[0]?.employerLogoMediaId}
      />
      <div>
        <b>{group.employer || 'Работодатель не указан'}</b>
        {group.location ? (
          <div className="career-profile-screen-company-span">{group.location}</div>
        ) : null}
      </div>
    </div>
  );
}

function CompanyGroup({
  group,
  memory,
  candidateId,
  saving,
  onSectionSave,
  onUpdateExperience,
  onManualExperienceFactAdded,
  draft,
}: {
  readonly group: ReturnType<typeof groupExperienceByEmployer>[number];
  readonly memory: readonly CandidateMemory[];
  readonly candidateId?: string;
  readonly saving?: boolean;
  readonly draft: ResumeDraft;
  readonly onSectionSave: (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
  readonly onUpdateExperience: ExperiencePatchHandler;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
}) {
  return (
    <div className="career-profile-screen-company-group">
      <CompanyHead group={group} />
      {group.positions.map((entry) => (
        <PositionRow
          key={entry.id}
          entry={entry}
          bullets={responsibilityBullets(entry, memory)}
          memory={memory}
          candidateId={candidateId}
          saving={saving}
          onSave={(patch) => onUpdateExperience(entry, patch)}
          onRemove={() => onSectionSave(removeExperience(draft, entry.id))}
          onManualExperienceFactAdded={onManualExperienceFactAdded}
        />
      ))}
      {group.positions[0] ? (
        <ProfileEmployerName place={group.positions[0]} onChanged={onManualExperienceFactAdded} />
      ) : null}
    </div>
  );
}

export function ExperienceSuggestionsList(
  props: Pick<
    ProfileExperienceSectionProps,
    | 'draft'
    | 'memory'
    | 'suggestions'
    | 'onSectionSave'
    | 'onAcceptSuggestion'
    | 'onDismissSuggestion'
    | 'onRevertSuggestion'
    | 'onManualExperienceFactAdded'
  >,
) {
  return (
    <>
      <ProfileExperienceSuggestions
        draft={props.draft}
        suggestions={props.suggestions}
        onAcceptSuggestion={props.onAcceptSuggestion}
        onDismissSuggestion={props.onDismissSuggestion}
        onRevertSuggestion={props.onRevertSuggestion}
      />
      <ExperienceFactRewrite
        draft={props.draft}
        memory={props.memory ?? NO_MEMORY}
        onSectionSave={props.onSectionSave}
        onProfileChanged={props.onManualExperienceFactAdded}
      />
    </>
  );
}

const NO_MEMORY: readonly CandidateMemory[] = [];

function ExperienceGroupsList({
  candidateId,
  groups,
  memory,
  saving,
  draft,
  onSectionSave,
  onUpdateExperience,
  onManualExperienceFactAdded,
}: {
  readonly candidateId?: string;
  readonly groups: readonly ReturnType<typeof groupExperienceByEmployer>[number][];
  readonly memory: readonly CandidateMemory[];
  readonly saving?: boolean;
  readonly draft: ResumeDraft;
  readonly onSectionSave: (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
  readonly onUpdateExperience: ExperiencePatchHandler;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
}) {
  if (!groups.length) {
    return <p className="career-profile-screen-empty-note">Опыт работы ещё не добавлен.</p>;
  }
  return (
    <>
      {groups.map((group, index) => (
        <CollapsiblePlace
          key={group.key}
          group={group}
          collapsed={index >= EXPANDED_PLACES}
          period={group.positions[0] ? periodLabel(group.positions[0]) : ''}
        >
          <CompanyGroup
            group={group}
            memory={memory}
            candidateId={candidateId}
            saving={saving}
            draft={draft}
            onSectionSave={onSectionSave}
            onUpdateExperience={onUpdateExperience}
            onManualExperienceFactAdded={onManualExperienceFactAdded}
          />
        </CollapsiblePlace>
      ))}
    </>
  );
}

export function ProfileExperienceSection({ ...props }: ProfileExperienceSectionProps) {
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-experience"
      aria-labelledby="sec-experience-title"
    >
      <ExperienceSectionContent {...props} />
    </section>
  );
}

interface ExperienceComposer {
  readonly newEntry?: ResumeExperienceInput;
  readonly groups: readonly ReturnType<typeof groupExperienceByEmployer>[number][];
  readonly addPosition: () => void;
  readonly clearNewEntry: () => void;
  readonly saveExperience: ExperiencePatchHandler;
}

function useExperienceComposer(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
  onSectionSave: ProfileExperienceSectionProps['onSectionSave'],
): ExperienceComposer {
  const [newEntry, setNewEntry] = useState<ResumeExperienceInput>();
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const groups = groupExperienceByEmployer(
    [...draft.experience].sort(
      (left, right) => startDateOrder(right.startDate) - startDateOrder(left.startDate),
    ),
  );
  const saveExperience: ExperiencePatchHandler = (entry, patch) => {
    const currentDraft = latestDraft.current;
    const exists = currentDraft.experience.some((current) => current.id === entry.id);
    const next = exists
      ? updateExperience(currentDraft, entry.id, patch)
      : { ...currentDraft, experience: [...currentDraft.experience, { ...entry, ...patch }] };
    latestDraft.current = next;
    return onSectionSave(next);
  };
  return {
    newEntry,
    groups,
    addPosition: () => {
      const empty = addExperience(latestDraft.current, `manual-${Date.now()}`);
      setNewEntry(empty.experience.at(-1));
    },
    clearNewEntry: () => setNewEntry(undefined),
    saveExperience,
  };
}

function NewExperienceForm({
  entry,
  memory,
  candidateId,
  saving,
  onManualExperienceFactAdded,
  onCancel,
  onSave,
}: {
  readonly entry?: ResumeExperienceInput;
  readonly memory: readonly CandidateMemory[];
  readonly candidateId?: string;
  readonly saving?: boolean;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
  readonly onCancel: () => void;
  readonly onSave: ExperiencePatchHandler;
}) {
  if (!entry) return null;
  return (
    <PositionEditForm
      entry={entry}
      memory={memory}
      candidateId={candidateId}
      isNew
      saving={saving}
      onManualExperienceFactAdded={onManualExperienceFactAdded}
      onCancel={onCancel}
      onDone={onCancel}
      onSave={(patch) => onSave(entry, patch)}
    />
  );
}

export function ExperienceVacancyRequirement({
  props,
}: {
  readonly props: ProfileExperienceSectionProps;
}) {
  return (
    <VacancyRequirementSlot
      candidateId={props.candidateId}
      draft={props.draft}
      memory={props.memory ?? []}
      request={props.vacancyRequirement}
      onHandled={props.onVacancyRequirementHandled}
      onSuggestionPrepared={props.onVacancySuggestionPrepared}
      onManualFactAdded={props.onManualExperienceFactAdded}
    />
  );
}

function ExperienceSectionContent(props: ProfileExperienceSectionProps) {
  const {
    candidateId,
    draft,
    memory = [],
    saving,
    onSectionSave,
    onManualExperienceFactAdded,
  } = props;
  const composer = useExperienceComposer(draft, memory, onSectionSave);

  return (
    <>
      <ExperienceSectionHeading
        draft={draft}
        groupCount={composer.groups.length}
        onAdd={composer.newEntry ? undefined : composer.addPosition}
      />
      <ExperienceVacancyRequirement props={props} />
      <NewExperienceForm
        entry={composer.newEntry}
        memory={memory}
        candidateId={candidateId}
        saving={saving}
        onManualExperienceFactAdded={onManualExperienceFactAdded}
        onCancel={composer.clearNewEntry}
        onSave={composer.saveExperience}
      />
      <ExperienceSectionLists
        candidateId={candidateId}
        groups={composer.groups}
        memory={memory}
        saving={saving}
        draft={draft}
        onSectionSave={onSectionSave}
        onUpdateExperience={composer.saveExperience}
        onManualExperienceFactAdded={onManualExperienceFactAdded}
        suggestions={props.suggestions}
        onAcceptSuggestion={props.onAcceptSuggestion}
        onDismissSuggestion={props.onDismissSuggestion}
        onRevertSuggestion={props.onRevertSuggestion}
      />
    </>
  );
}

interface ExperienceSectionListsProps {
  readonly candidateId?: string;
  readonly groups: readonly ReturnType<typeof groupExperienceByEmployer>[number][];
  readonly memory: readonly CandidateMemory[];
  readonly saving?: boolean;
  readonly draft: ResumeDraft;
  readonly onSectionSave: (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onUpdateExperience: ExperiencePatchHandler;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
}

function ExperienceSectionLists(props: ExperienceSectionListsProps) {
  const {
    candidateId,
    groups,
    memory,
    saving,
    draft,
    onSectionSave,
    suggestions,
    onUpdateExperience,
    onManualExperienceFactAdded,
    onAcceptSuggestion,
    onDismissSuggestion,
    onRevertSuggestion,
  } = props;
  return (
    <>
      <ExperienceSuggestionsList
        draft={draft}
        memory={memory}
        suggestions={suggestions}
        onSectionSave={onSectionSave}
        onAcceptSuggestion={onAcceptSuggestion}
        onDismissSuggestion={onDismissSuggestion}
        onRevertSuggestion={onRevertSuggestion}
        onManualExperienceFactAdded={onManualExperienceFactAdded}
      />
      <ExperienceGroupsList
        candidateId={candidateId}
        groups={groups}
        memory={memory}
        saving={saving}
        draft={draft}
        onSectionSave={onSectionSave}
        onUpdateExperience={onUpdateExperience}
        onManualExperienceFactAdded={onManualExperienceFactAdded}
      />
    </>
  );
}

function startDateOrder(value?: string): number {
  return monthOrder(value);
}

function ExperienceSectionHeading({
  draft,
  groupCount,
  onAdd,
}: {
  readonly draft: ResumeDraft;
  readonly groupCount: number;
  readonly onAdd?: () => void;
}) {
  return (
    <SectionHead
      id="sec-experience-title"
      title="Опыт"
      count={draft.experience.length ? String(draft.experience.length) : undefined}
      action={
        <>
          <CareerTooltip content={`${draft.experience.length} позиции · ${groupCount} компании`}>
            <button
              type="button"
              className="career-quiet-button career-btn-sm career-profile-screen-info-button"
              aria-label="Сведения об опыте"
            >
              <Info size={16} aria-hidden="true" />
            </button>
          </CareerTooltip>
          {onAdd ? <SectionAddButton label="Добавить место работы" onClick={onAdd} /> : null}
        </>
      }
    />
  );
}

function VacancyRequirementSlot({
  candidateId,
  draft,
  memory,
  request,
  onHandled,
  onSuggestionPrepared,
  onManualFactAdded,
}: {
  readonly candidateId?: string;
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly request?: VacancyProfileRequirementRequest;
  readonly onHandled?: () => void;
  readonly onSuggestionPrepared?: (commandId: string) => Promise<void> | void;
  readonly onManualFactAdded?: () => Promise<void> | void;
}) {
  if (!request || !candidateId) return null;
  return (
    <VacancyRequirementAssistant
      draft={draft}
      memory={memory}
      request={request}
      onHandled={onHandled ?? (() => undefined)}
      onSuggestionPrepared={onSuggestionPrepared ?? (() => undefined)}
      onManualFactAdded={onManualFactAdded ?? (() => undefined)}
    />
  );
}

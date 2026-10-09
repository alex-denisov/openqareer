import { useRef, useState } from 'react';
import type { CandidateMemory } from '../coach/coachApi';
import { groupExperienceByEmployer } from './profileGrouping';
import { addExperience, removeExperience, updateExperience } from './resumeStudioModel';
import { SectionAddButton, SectionPencilButton, SectionRemoveButton } from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import { useCandidateMediaSrc } from './candidateMediaSrc';
import {
  InlineConsultantSuggestion,
  type InlineSuggestionItem,
} from './InlineConsultantSuggestion';
import { PositionEditForm } from './ProfileExperienceEditor';
import { monthOrder } from './experienceDate';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';
import { VacancyRequirementAssistant } from './VacancyRequirementAssistant';
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
function responsibilityBullets(
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

const WORKPLACE_LABEL: Record<string, string> = {
  on_site: 'Офис',
  hybrid: 'Гибрид',
  remote: 'Удалённо',
};

type ExperiencePatchHandler = (
  entry: ResumeExperienceInput,
  patch: Partial<ResumeExperienceInput>,
) => Promise<boolean | void> | boolean | void;

function periodLabel(entry: ResumeExperienceInput): string {
  if (!entry.startDate) return '';
  const end = entry.current ? 'по настоящее время' : (entry.endDate ?? '');
  return end ? `${entry.startDate} — ${end}` : entry.startDate;
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
}: {
  readonly entry: ResumeExperienceInput;
  readonly bullets: readonly string[];
  readonly memory: readonly CandidateMemory[];
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="career-profile-screen-position">
      <div className="career-profile-screen-position-title-row">
        <b>{entry.title || 'Должность не указана'}</b>
        <SectionPencilButton
          label={`Редактировать место целиком: ${entry.employer || 'работодатель не указан'}`}
          onClick={onEdit}
        />
        <SectionRemoveButton label="Удалить должность" onClick={onRemove} />
      </div>
      <PositionEvidenceBadge entry={entry} memory={memory} />
      <PositionDetails entry={entry} bullets={bullets} />
    </div>
  );
}

function PositionEvidenceBadge({
  entry,
  memory,
}: {
  readonly entry: ResumeExperienceInput;
  readonly memory: readonly CandidateMemory[];
}) {
  const linkedFacts = entry.bulletMemoryIds.flatMap((id) => {
    const fact = memory.find((item) => item.id === id);
    return fact ? [fact] : [];
  });
  const confirmedByCandidate =
    linkedFacts.length > 0 &&
    linkedFacts.length === entry.bulletMemoryIds.length &&
    linkedFacts.every(
      (fact) => fact.status === 'confirmed' && fact.confidence === 'candidate-confirmed',
    );
  return (
    <div className="career-profile-screen-position-tags">
      <span
        className={`career-profile-screen-tag ${confirmedByCandidate ? 'is-verified' : 'is-unverified'}`}
        title="Работодатель не проверяется; подтверждение относится к фактам профиля."
        aria-label={`${confirmedByCandidate ? 'Подтверждено вами' : 'Не подтверждено вами'}. Работодатель не проверяется.`}
      >
        {confirmedByCandidate ? 'Подтверждено вами' : 'Не подтверждено вами'}
      </span>
      {entry.employmentType ? (
        <span className="career-profile-screen-tag">{entry.employmentType}</span>
      ) : null}
      {entry.workplaceType ? (
        <span className="career-profile-screen-tag">{WORKPLACE_LABEL[entry.workplaceType]}</span>
      ) : null}
    </div>
  );
}

function PositionDetails({
  entry,
  bullets,
}: {
  readonly entry: ResumeExperienceInput;
  readonly bullets: readonly string[];
}) {
  return (
    <>
      {periodLabel(entry) ? (
        <div className="career-profile-screen-position-dates">{periodLabel(entry)}</div>
      ) : null}
      {entry.location ? (
        <div className="career-profile-screen-company-span">{entry.location}</div>
      ) : null}
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
    />
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
    </div>
  );
}

function ExperienceSuggestionsList({
  draft,
  suggestions,
  onSectionSave,
  onAcceptSuggestion,
  onDismissSuggestion,
  onRevertSuggestion,
}: Pick<
  ProfileExperienceSectionProps,
  | 'draft'
  | 'suggestions'
  | 'onSectionSave'
  | 'onAcceptSuggestion'
  | 'onDismissSuggestion'
  | 'onRevertSuggestion'
>) {
  const expSuggestions = (suggestions ?? []).filter((s) => s.section === 'experience');
  return (
    <>
      {expSuggestions.map((suggestion) => (
        <InlineConsultantSuggestion
          key={suggestion.id}
          suggestion={suggestion}
          onAccept={
            onAcceptSuggestion ??
            ((s) => {
              if (s.experienceId) {
                onSectionSave(updateExperience(draft, s.experienceId, { title: s.proposedText }));
              }
            })
          }
          onDismiss={onDismissSuggestion ?? (() => {})}
          onRevert={
            onRevertSuggestion ??
            (suggestion.currentText !== undefined && suggestion.experienceId
              ? async () => {
                  await onSectionSave(
                    updateExperience(draft, suggestion.experienceId!, {
                      title: suggestion.currentText,
                    }),
                  );
                }
              : undefined)
          }
        />
      ))}
    </>
  );
}

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
      {groups.map((group) => (
        <CompanyGroup
          key={group.key}
          group={group}
          memory={memory}
          candidateId={candidateId}
          saving={saving}
          draft={draft}
          onSectionSave={onSectionSave}
          onUpdateExperience={onUpdateExperience}
          onManualExperienceFactAdded={onManualExperienceFactAdded}
        />
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
  readonly additionalFacts: readonly CandidateMemory[];
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
  const additionalFacts = additionalExperienceFacts(draft, memory);
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
    additionalFacts,
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

function ExperienceVacancyRequirement({
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
        additionalFacts={composer.additionalFacts}
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
  readonly additionalFacts: readonly CandidateMemory[];
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
    additionalFacts,
    suggestions,
    onUpdateExperience,
    onManualExperienceFactAdded,
    onAcceptSuggestion,
    onDismissSuggestion,
    onRevertSuggestion,
  } = props;
  return (
    <>
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
      <AdditionalExperienceFacts facts={additionalFacts} />
      <ExperienceSuggestionsList
        draft={draft}
        suggestions={suggestions}
        onSectionSave={onSectionSave}
        onAcceptSuggestion={onAcceptSuggestion}
        onDismissSuggestion={onDismissSuggestion}
        onRevertSuggestion={onRevertSuggestion}
      />
    </>
  );
}

function additionalExperienceFacts(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): readonly CandidateMemory[] {
  const linkedMemoryIds = new Set(draft.experience.flatMap((entry) => entry.bulletMemoryIds));
  return memory.filter(
    (item) =>
      item.status === 'confirmed' &&
      item.domain === 'responsibility' &&
      !linkedMemoryIds.has(item.id),
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
      count={
        draft.experience.length
          ? `${draft.experience.length} позиции · ${groupCount} компании`
          : undefined
      }
      imported={draft.experience.length > 0}
      action={
        onAdd ? <SectionAddButton label="Добавить место работы" onClick={onAdd} /> : undefined
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

function AdditionalExperienceFacts({ facts }: { readonly facts: readonly CandidateMemory[] }) {
  if (!facts.length) return null;
  return (
    <div className="career-profile-screen-additional-facts">
      <h3>Дополнительные факты опыта</h3>
      <ul>
        {facts.map((fact) => (
          <li key={fact.id}>{fact.statement}</li>
        ))}
      </ul>
    </div>
  );
}

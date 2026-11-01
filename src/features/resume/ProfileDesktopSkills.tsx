import { useState } from 'react';
import { CheckCircle, Circle, Link, Question } from '@phosphor-icons/react';
import { skillSourceLabel } from './ProfileMobileSkills';
import { useProvenanceLabelOf } from './ProfileProvenanceChip';
import { SkillConfirmEntry } from './SkillConfirmEntry';
import { ProfileSkillDemandCard } from './ProfileSkillDemandCard';
import { skillStatusLabel } from './skillStatusLabel';
import { useSkillConfirmations } from './useSkillConfirmations';
import type { SkillConfirmation } from '../skills/skillConfirmationApi';
import { SkillsEditForm } from './ProfileSkillsSection';
import type { ProfileMobileDataProps } from './profileMobileTypes';
import type { ResumeSkillInput } from './resumeTypes';
import {
  SKILL_CONFIRMATION_HINT,
  confirmedSkillsLine,
  orderSkillsByVerification,
} from './skillConfirmation';

export function skillVerification(skill: ResumeSkillInput, confirmation?: SkillConfirmation) {
  // Mockup 2 (1440): «Подтверждено», «Разобрано в беседе», «Квиз не пройден» (only after a failed
  // attempt) or «Без квиза»; an unknown status code is never shown as is.
  const label = skillStatusLabel(skill, confirmation);
  if (label === 'Подтверждено') return { label, tone: 'is-ok', Icon: CheckCircle };
  if (label === 'Разобрано в беседе') return { label, tone: 'is-ok', Icon: CheckCircle };
  if (label === 'Квиз не пройден') return { label, tone: 'is-warn', Icon: Question };
  return { label, tone: 'is-dim', Icon: Circle };
}

function DesktopSkillRow({
  skill,
  confirmation,
}: {
  readonly skill: ResumeSkillInput;
  readonly confirmation?: SkillConfirmation;
}) {
  const status = skillVerification(skill, confirmation);
  const labelOf = useProvenanceLabelOf();
  const date = skill.verifiedAt ? new Date(skill.verifiedAt) : null;
  const stamp =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
      : skill.verifiedAt;
  return (
    <div className="profile-desktop-skill-row">
      <b>{skill.name}</b>
      <span className={`profile-desktop-skill-tag ${status.tone}`}>
        <status.Icon size="1em" aria-hidden="true" />
        {status.label}
      </span>
      <span className="profile-desktop-skill-source">
        <Link size="1em" aria-hidden="true" />
        {[skillSourceLabel(skill, labelOf), stamp].filter(Boolean).join(', ')}
      </span>
    </div>
  );
}

function DesktopSkillList({
  skills,
  confirmationOf,
}: {
  readonly skills: readonly ResumeSkillInput[];
  readonly confirmationOf: (name: string) => SkillConfirmation | undefined;
}) {
  const [all, setAll] = useState(false);
  const ordered = orderSkillsByVerification(skills);
  const visible = all ? ordered : ordered.slice(0, 6);
  return (
    <>
      <p className="career-profile-screen-quality-note">
        {skills.length ? `${confirmedSkillsLine(skills)} ` : ''}
        {SKILL_CONFIRMATION_HINT}
      </p>
      <div className="profile-desktop-skill-grid">
        {visible.map((skill) => (
          <DesktopSkillRow key={skill.id} skill={skill} confirmation={confirmationOf(skill.name)} />
        ))}
      </div>
      {skills.length ? (
        <button
          type="button"
          className="profile-skill-disclosure"
          disabled={skills.length <= 6}
          aria-expanded={all}
          aria-label={all ? 'Свернуть список навыков' : 'Показать все навыки'}
          onClick={() => setAll((current) => !current)}
        >
          Показано {visible.length} из {skills.length}.
        </button>
      ) : (
        <p className="career-profile-screen-quality-note">Навыки ещё не добавлены.</p>
      )}
    </>
  );
}

function DesktopSkillsCard(props: ProfileMobileDataProps) {
  const [editing, setEditing] = useState(false);
  const skills = props.draft.skills ?? [];
  const confirmations = useSkillConfirmations(props.candidateId);
  return (
    <section
      className="career-profile-screen-panel profile-desktop-skills"
      id="sec-skills"
      aria-labelledby="sec-skills-title"
    >
      <div className="career-profile-screen-section-head">
        <h2 id="sec-skills-title">Навыки</h2>
        <button
          className="profile-desktop-skill-tag"
          type="button"
          aria-label="Изменить навыки"
          onClick={() => setEditing(true)}
        >
          {skills.length}
        </button>
        <SkillConfirmEntry
          skills={confirmations.skills}
          className="career-primary-button"
          onDiscuss={props.onDiscussSkill}
          onApplied={() => {
            confirmations.reload();
            props.onRetry();
          }}
        />
      </div>
      {editing ? (
        <SkillsEditForm
          draft={props.draft}
          saving={props.saving}
          onCancel={() => setEditing(false)}
          onSectionSave={async (next) => {
            const result = await props.onSectionSave(next);
            if (result !== false) setEditing(false);
            return result;
          }}
        />
      ) : (
        <DesktopSkillList skills={skills} confirmationOf={confirmations.confirmationOf} />
      )}
    </section>
  );
}

export function ProfileDesktopSkills(props: ProfileMobileDataProps) {
  return (
    <div className="profile-desktop-skills-stack">
      <DesktopSkillsCard {...props} />
      <ProfileSkillDemandCard
        candidateId={props.candidateId}
        onOpen={props.onOpenRoleSkillAssessment}
      />
    </div>
  );
}

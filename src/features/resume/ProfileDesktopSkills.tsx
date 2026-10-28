import { useEffect, useState } from 'react';
import { CheckCircle, Circle, Link, ListChecks, Question } from '@phosphor-icons/react';
import {
  getCurrentRoleSkillAssessment,
  type RoleSkillAssessmentCurrent,
} from '../skills/roleSkillAssessmentApi';
import { skillSourceLabel } from './ProfileMobileSkills';
import { useProvenanceLabelOf } from './ProfileProvenanceChip';
import { SkillsEditForm } from './ProfileSkillsSection';
import type { ProfileMobileDataProps } from './profileMobileTypes';
import type { ResumeSkillInput } from './resumeTypes';
import {
  SKILL_CONFIRMATION_HINT,
  confirmedSkillsLine,
  orderSkillsByVerification,
} from './skillConfirmation';

export function skillVerification(skill: ResumeSkillInput) {
  if (skill.status === 'подтверждён')
    return { label: 'Подтверждено', tone: 'is-ok', Icon: CheckCircle };
  if (skill.status === 'не подтверждён')
    return { label: 'Не подтверждено', tone: 'is-warn', Icon: Question };
  // Mockup 2 (1440): a skill without a quiz verdict reads «Квиз не пройден»; an unknown status
  // code is never shown as is.
  return { label: 'Квиз не пройден', tone: 'is-dim', Icon: Circle };
}

function DesktopSkillRow({ skill }: { readonly skill: ResumeSkillInput }) {
  const status = skillVerification(skill);
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

function DesktopSkillList({ skills }: { readonly skills: readonly ResumeSkillInput[] }) {
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
          <DesktopSkillRow key={skill.id} skill={skill} />
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
        <button
          type="button"
          className="career-primary-button"
          disabled={!props.onOpenSkillQuizBank}
          onClick={props.onOpenSkillQuizBank}
        >
          <ListChecks size="1em" aria-hidden="true" />
          Пройти квиз
        </button>
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
        <DesktopSkillList skills={skills} />
      )}
    </section>
  );
}

function useAssessmentSummary(candidateId: string) {
  const [current, setCurrent] = useState<RoleSkillAssessmentCurrent | null>();
  useEffect(() => {
    let active = true;
    setCurrent(undefined);
    void getCurrentRoleSkillAssessment().then(
      (result) => {
        if (active) setCurrent(result);
      },
      () => {
        if (active) setCurrent(null);
      },
    );
    return () => {
      active = false;
    };
  }, [candidateId]);
  return current;
}

function assessmentDescription(current: RoleSkillAssessmentCurrent | null | undefined): string {
  if (current === undefined) return 'Проверяем сохранённое состояние…';
  switch (current?.state) {
    case 'ready':
      return 'Уровень не оценён: проверка навыков не пройдена.';
    case 'run':
      return 'Проверка начата. Продолжите с сохранённого шага.';
    case 'result':
      return 'Проверка завершена. Откройте сохранённый результат.';
    case 'role_changed':
      return 'Требования роли изменились. Откройте проверку, чтобы обновить результат.';
    case 'role_not_selected':
      return 'Сначала выберите целевую роль.';
    case 'too_few_vacancies':
      return `В выборке ${current.sampleSize} вакансий; для проверки требуется ${current.threshold}.`;
    case 'insufficient_requirements':
      return current.collecting
        ? 'Требования роли собираются из текстов вакансий.'
        : 'В выборке недостаточно проверенных требований роли.';
    default:
      return 'Нет проверенных данных о текущей проверке.';
  }
}

function DesktopAssessmentCard(props: ProfileMobileDataProps) {
  const current = useAssessmentSummary(props.candidateId);
  const title =
    current && 'roleTitle' in current
      ? current.roleTitle
      : current && 'run' in current
        ? current.run.roleTitle
        : props.draft.targetRole || 'Навыки выбранной роли';
  const action =
    current?.state === 'result'
      ? 'Открыть результат'
      : current?.state === 'run'
        ? 'Продолжить'
        : 'Начать';
  return (
    <section
      className="career-profile-screen-panel profile-desktop-assessment"
      aria-labelledby="profile-assessment-title"
    >
      <div className="career-profile-screen-section-head">
        <h2 id="profile-assessment-title">Проверка навыков</h2>
      </div>
      <div className="profile-desktop-assessment-row">
        <div>
          <b>{title}</b>
          <p>{assessmentDescription(current)}</p>
        </div>
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          disabled={!props.onOpenRoleSkillAssessment}
          onClick={props.onOpenRoleSkillAssessment}
        >
          {action}
        </button>
      </div>
    </section>
  );
}

export function ProfileDesktopSkills(props: ProfileMobileDataProps) {
  return (
    <div className="profile-desktop-skills-stack">
      <DesktopSkillsCard {...props} />
      <DesktopAssessmentCard {...props} />
    </div>
  );
}

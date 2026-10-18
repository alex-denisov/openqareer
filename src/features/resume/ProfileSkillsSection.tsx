import { useState } from 'react';
import { useProfileEntrySave, type ProfileEntrySaveResult } from './profileEntrySave';
import { categorizeSkills } from './profileGrouping';
import { addSkill, removeSkill } from './resumeStudioModel';
import { SectionEditActions, SectionPencilButton } from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeDraft } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
}

function SkillEditFields({
  skills,
  newSkill,
  onNewSkill,
  onRemove,
}: {
  readonly skills: NonNullable<ResumeDraft['skills']>;
  readonly newSkill: string;
  readonly onNewSkill: (value: string) => void;
  readonly onRemove: (skillId: string) => void;
}) {
  return (
    <>
      <div className="career-profile-screen-group-chips">
        {skills.map((skill) => (
          <span key={skill.id} className="career-profile-screen-tag is-removable">
            {skill.name}
            <button
              type="button"
              aria-label={`Удалить навык ${skill.name}`}
              onClick={() => onRemove(skill.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Новый навык</span>
          <input value={newSkill} onChange={(event) => onNewSkill(event.target.value)} />
        </label>
      </div>
    </>
  );
}

export function SkillsEditForm({
  draft,
  saving,
  onCancel,
  onSectionSave,
}: SectionProps & { readonly onCancel: () => void }) {
  const [workingDraft, setWorkingDraft] = useState(draft);
  const [newSkill, setNewSkill] = useState('');
  const skills = workingDraft.skills ?? [];
  const submit = useProfileEntrySave(onSectionSave, (next: ResumeDraft) => {
    const originalSkills = draft.skills ?? [];
    const nextSkills = next.skills ?? [];
    const unchanged =
      originalSkills.length === nextSkills.length &&
      originalSkills.every((skill, index) => skill.id === nextSkills[index]?.id);
    return unchanged ? 'Добавьте навык или удалите существующий.' : undefined;
  });
  const save = () => {
    const clean = newSkill.trim();
    void submit.save(clean ? addSkill(workingDraft, clean) : workingDraft);
  };
  return (
    <div className="career-profile-screen-edit-body">
      <SkillEditFields
        skills={skills}
        newSkill={newSkill}
        onNewSkill={setNewSkill}
        onRemove={(skillId) => setWorkingDraft((current) => removeSkill(current, skillId))}
      />
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <SectionEditActions saving={saving || submit.busy} onCancel={onCancel} onSave={save} />
    </div>
  );
}

function SkillChip({ skill }: { readonly skill: NonNullable<ResumeDraft['skills']>[number] }) {
  const verifiedClass =
    skill.status === 'подтверждён'
      ? 'is-verified'
      : skill.status === 'не подтверждён'
        ? 'is-unverified'
        : '';
  const source = skill.source?.trim() || 'Источник не указан';
  const details = [source, skill.verifiedAt].filter(Boolean).join(' · ');
  return (
    <span key={skill.id} className={`career-profile-screen-tag ${verifiedClass}`}>
      {skill.name}
      {skill.status ? (
        <span className="career-profile-screen-skill-meta">
          {' '}
          · {skill.status} ({details})
        </span>
      ) : null}
    </span>
  );
}

function SkillGroupsList({ groups }: { readonly groups: ReturnType<typeof categorizeSkills> }) {
  return (
    <div className="career-profile-screen-skill-groups">
      {groups.map((group) => (
        <div key={group.label}>
          <span className="career-profile-screen-group-label">{group.label}</span>
          <div className="career-profile-screen-group-chips">
            {group.skills.map((skill) => (
              <SkillChip key={skill.id} skill={skill} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfileSkillsSection({ draft, saving, onSectionSave }: SectionProps) {
  const [editing, setEditing] = useState(false);
  const skills = draft.skills ?? [];
  const groups = categorizeSkills(skills);
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-skills"
      aria-labelledby="sec-skills-title"
    >
      <SectionHead
        id="sec-skills-title"
        title="Навыки"
        count={skills.length ? String(skills.length) : undefined}
        action={<SectionPencilButton label="Изменить навыки" onClick={() => setEditing(true)} />}
      />
      {editing ? (
        <SkillsEditForm
          draft={draft}
          saving={saving}
          onSectionSave={async (next) => {
            const result = await onSectionSave(next);
            if (result !== false) setEditing(false);
            return result;
          }}
          onCancel={() => setEditing(false)}
        />
      ) : skills.length ? (
        <SkillGroupsList groups={groups} />
      ) : (
        <p className="career-profile-screen-empty-note">Навыки ещё не добавлены.</p>
      )}
    </section>
  );
}

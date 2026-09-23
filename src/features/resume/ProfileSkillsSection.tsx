import { useState } from 'react';
import { categorizeSkills } from './profileGrouping';
import { addSkill, removeSkill } from './resumeStudioModel';
import { SectionEditActions, SectionPencilButton } from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeDraft } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
}

function SkillsEditForm({
  draft,
  saving,
  onCancel,
  onSectionSave,
}: SectionProps & { readonly onCancel: () => void }) {
  const [newSkill, setNewSkill] = useState('');
  const skills = draft.skills ?? [];
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-group-chips">
        {skills.map((skill) => (
          <span key={skill.id} className="career-profile-screen-tag is-removable">
            {skill.name}
            <button
              type="button"
              aria-label={`Удалить навык ${skill.name}`}
              onClick={() => onSectionSave(removeSkill(draft, skill.id))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Новый навык</span>
          <input value={newSkill} onChange={(event) => setNewSkill(event.target.value)} />
        </label>
      </div>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSectionSave(newSkill.trim() ? addSkill(draft, newSkill.trim()) : draft)}
      />
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
        imported={skills.length > 0}
        action={<SectionPencilButton label="Изменить навыки" onClick={() => setEditing(true)} />}
      />
      {editing ? (
        <SkillsEditForm
          draft={draft}
          saving={saving}
          onSectionSave={(next) => onSectionSave(next)}
          onCancel={() => setEditing(false)}
        />
      ) : skills.length ? (
        <div className="career-profile-screen-skill-groups">
          {groups.map((group) => (
            <div key={group.label}>
              <span className="career-profile-screen-group-label">{group.label}</span>
              <div className="career-profile-screen-group-chips">
                {group.skills.map((skill) => (
                  <span key={skill.id} className="career-profile-screen-tag">
                    {skill.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="career-profile-screen-empty-note">Навыки ещё не добавлены.</p>
      )}
    </section>
  );
}

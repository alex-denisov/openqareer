import { useState } from 'react';
import {
  addAchievement,
  removeAchievement,
  updateAchievement,
} from './profileEntryEditing';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeAchievementInput, ResumeDraft } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
}

const ACHIEVEMENT_GROUP_LABEL: Record<ResumeAchievementInput['kind'], string> = {
  honor: 'Награды',
  publication: 'Публикации',
  patent: 'Патенты',
  organization: 'Организации',
  volunteering: 'Волонтёрство',
};

function AchievementEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeAchievementInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeAchievementInput>) => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [issuer, setIssuer] = useState(entry.issuer ?? '');
  const [date, setDate] = useState(entry.date ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Название</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Кто выдал / где опубликовано</span>
          <input value={issuer} onChange={(event) => setIssuer(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Дата</span>
          <input value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ title, issuer, date })}
      />
    </div>
  );
}

function AchievementItem({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeAchievementInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeAchievementInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <AchievementEditForm
        entry={entry}
        saving={saving}
        onCancel={() => setEditing(false)}
        onSave={(patch) => {
          onSave(patch);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="career-profile-screen-achv-item">
      <b>{entry.title || 'Название не указано'}</b>
      <span>{[entry.issuer, entry.date].filter(Boolean).join(' · ')}</span>
      <SectionPencilButton label="Изменить достижение" onClick={() => setEditing(true)} />
      <SectionRemoveButton label="Удалить достижение" onClick={onRemove} />
    </div>
  );
}

export function ProfileAchievementsSection({ draft, saving, onSectionSave }: SectionProps) {
  const achievements = draft.achievements ?? [];
  const groups = new Map<ResumeAchievementInput['kind'], ResumeAchievementInput[]>();
  achievements.forEach((achievement) => {
    const bucket = groups.get(achievement.kind) ?? [];
    groups.set(achievement.kind, [...bucket, achievement]);
  });
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-achievements"
      aria-labelledby="sec-achievements-title"
    >
      <SectionHead
        id="sec-achievements-title"
        title="Достижения"
        imported={achievements.length > 0}
        action={
          <SectionAddButton
            label="Добавить достижение"
            onClick={() => onSectionSave(addAchievement(draft))}
          />
        }
      />
      {!achievements.length ? (
        <p className="career-profile-screen-empty-note">Достижений пока нет.</p>
      ) : (
        [...groups.entries()].map(([kind, items]) => (
          <div key={kind} className="career-profile-screen-achv-group">
            <h3>{ACHIEVEMENT_GROUP_LABEL[kind]}</h3>
            {items.map((item) => (
              <AchievementItem
                key={item.id}
                entry={item}
                saving={saving}
                onSave={(patch) => onSectionSave(updateAchievement(draft, item.id, patch))}
                onRemove={() => onSectionSave(removeAchievement(draft, item.id))}
              />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

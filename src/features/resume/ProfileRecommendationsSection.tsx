import { useState } from 'react';
import { Quotes } from '@phosphor-icons/react';
import { updateRecommendation } from './profileEntryEditing';
import { addRecommendation, removeRecommendation } from './resumeStudioModel';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeDraft, ResumeRecommendationInput } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
}

function RecommendationEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeRecommendationInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeRecommendationInput>) => void;
}) {
  const [recommender, setRecommender] = useState(entry.recommender ?? entry.author ?? '');
  const [organization, setOrganization] = useState(entry.organization ?? '');
  const [position, setPosition] = useState(entry.position ?? entry.role ?? '');
  const [text, setText] = useState(entry.text ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Автор</span>
          <input value={recommender} onChange={(event) => setRecommender(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Компания</span>
          <input value={organization} onChange={(event) => setOrganization(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Должность автора</span>
          <input value={position} onChange={(event) => setPosition(event.target.value)} />
        </label>
      </div>
      <label className="career-profile-screen-field">
        <span>Текст рекомендации</span>
        <textarea
          className="career-profile-screen-textarea"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ recommender, organization, position, text })}
      />
    </div>
  );
}

function RecommendationCard({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeRecommendationInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeRecommendationInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <RecommendationEditForm
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
    <div className="career-profile-screen-rec">
      <p className="career-profile-screen-rec-quote">
        <Quotes size={14} />
        {entry.text}
      </p>
      <div className="career-profile-screen-rec-author">
        <div>
          <b>{entry.recommender || entry.author}</b>
          <span>{[entry.position ?? entry.role, entry.organization].filter(Boolean).join(', ')}</span>
        </div>
        <SectionPencilButton label="Изменить рекомендацию" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить рекомендацию" onClick={onRemove} />
      </div>
    </div>
  );
}

export function ProfileRecommendationsSection({ draft, saving, onSectionSave }: SectionProps) {
  const recommendations = draft.recommendations ?? [];
  const addItem = () => onSectionSave(addRecommendation(draft, ''));
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-recommendations"
      aria-labelledby="sec-recommendations-title"
    >
      <SectionHead
        id="sec-recommendations-title"
        title="Рекомендации"
        count={recommendations.length ? String(recommendations.length) : undefined}
        imported={recommendations.length > 0}
        action={<SectionAddButton label="Добавить рекомендацию" onClick={addItem} />}
      />
      {!recommendations.length ? (
        <p className="career-profile-screen-empty-note">Рекомендаций пока нет.</p>
      ) : (
        recommendations.map((rec) => (
          <RecommendationCard
            key={rec.id}
            entry={rec}
            saving={saving}
            onSave={(patch) => onSectionSave(updateRecommendation(draft, rec.id, patch))}
            onRemove={() => onSectionSave(removeRecommendation(draft, rec.id))}
          />
        ))
      )}
    </section>
  );
}

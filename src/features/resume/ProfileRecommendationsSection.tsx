import { useState } from 'react';
import { useProfileEntrySave, type ProfileEntrySaveResult } from './profileEntrySave';
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
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
}

function RecommendationFields({
  recommender,
  organization,
  position,
  text,
  onRecommender,
  onOrganization,
  onPosition,
  onText,
}: {
  readonly recommender: string;
  readonly organization: string;
  readonly position: string;
  readonly text: string;
  readonly onRecommender: (value: string) => void;
  readonly onOrganization: (value: string) => void;
  readonly onPosition: (value: string) => void;
  readonly onText: (value: string) => void;
}) {
  return (
    <>
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Автор</span>
          <input value={recommender} onChange={(event) => onRecommender(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Компания</span>
          <input value={organization} onChange={(event) => onOrganization(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Должность автора</span>
          <input value={position} onChange={(event) => onPosition(event.target.value)} />
        </label>
      </div>
      <label className="career-profile-screen-field">
        <span>Текст рекомендации</span>
        <textarea
          className="career-profile-screen-textarea"
          rows={3}
          value={text}
          onChange={(event) => onText(event.target.value)}
        />
      </label>
    </>
  );
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
  readonly onSave: (patch: Partial<ResumeRecommendationInput>) => ProfileEntrySaveResult;
}) {
  const submit = useProfileEntrySave(onSave, (patch: Partial<ResumeRecommendationInput>) =>
    patch.text?.trim() ? undefined : 'Добавьте текст рекомендации.',
  );
  const [recommender, setRecommender] = useState(entry.recommender ?? entry.author ?? '');
  const [organization, setOrganization] = useState(entry.organization ?? '');
  const [position, setPosition] = useState(entry.position ?? entry.role ?? '');
  const [text, setText] = useState(entry.text ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <RecommendationFields
        recommender={recommender}
        organization={organization}
        position={position}
        text={text}
        onRecommender={setRecommender}
        onOrganization={setOrganization}
        onPosition={setPosition}
        onText={setText}
      />
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <SectionEditActions
        saving={saving || submit.busy}
        onCancel={onCancel}
        onSave={() => {
          void submit.save({ recommender, organization, position, text });
        }}
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
  readonly onSave: (patch: Partial<ResumeRecommendationInput>) => ProfileEntrySaveResult;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <RecommendationEditForm
        entry={entry}
        saving={saving}
        onCancel={() => setEditing(false)}
        onSave={async (patch) => {
          const result = await onSave(patch);
          if (result !== false) setEditing(false);
          return result;
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
          <span>
            {[entry.position ?? entry.role, entry.organization].filter(Boolean).join(', ')}
          </span>
        </div>
        <SectionPencilButton label="Изменить рекомендацию" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить рекомендацию" onClick={onRemove} />
      </div>
    </div>
  );
}

export function ProfileRecommendationsSection({ draft, saving, onSectionSave }: SectionProps) {
  const recommendations = draft.recommendations ?? [];
  const [newEntry, setNewEntry] = useState<ResumeRecommendationInput>();
  const addItem = () => setNewEntry(addRecommendation(draft, '').recommendations?.at(-1));
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
        action={<SectionAddButton label="Добавить рекомендацию" onClick={addItem} />}
      />
      {newEntry ? (
        <RecommendationEditForm
          entry={newEntry}
          saving={saving}
          onCancel={() => setNewEntry(undefined)}
          onSave={async (patch) => {
            const result = await onSectionSave({
              ...draft,
              recommendations: [...recommendations, { ...newEntry, ...patch }],
            });
            if (result !== false) setNewEntry(undefined);
            return result;
          }}
        />
      ) : null}
      {!recommendations.length && !newEntry ? (
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

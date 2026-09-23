import { useState } from 'react';
import { groupExperienceByEmployer } from './profileGrouping';
import { addExperience, removeExperience, updateExperience } from './resumeStudioModel';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
}

const WORKPLACE_LABEL: Record<string, string> = {
  on_site: 'On-site',
  hybrid: 'Гибрид',
  remote: 'Remote',
};

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
  if (employerLogoMediaId) {
    return (
      <img
        className="career-profile-screen-company-logo"
        src={`/api/v1/candidate/media/${encodeURIComponent(employerLogoMediaId)}`}
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

function PositionEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeExperienceInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeExperienceInput>) => void;
}) {
  const [title, setTitle] = useState(entry.title ?? '');
  const [employer, setEmployer] = useState(entry.employer ?? '');
  const [startDate, setStartDate] = useState(entry.startDate ?? '');
  const [endDate, setEndDate] = useState(entry.endDate ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Должность</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Компания</span>
          <input value={employer} onChange={(event) => setEmployer(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Начало</span>
          <input value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Окончание</span>
          <input
            value={endDate}
            disabled={entry.current}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
      </div>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ title, employer, startDate, endDate })}
      />
    </div>
  );
}

function PositionSummary({
  entry,
  onEdit,
  onRemove,
}: {
  readonly entry: ResumeExperienceInput;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="career-profile-screen-position">
      <div className="career-profile-screen-position-title-row">
        <b>{entry.title || 'Должность не указана'}</b>
        <SectionPencilButton label="Изменить должность" onClick={onEdit} />
        <SectionRemoveButton label="Удалить должность" onClick={onRemove} />
      </div>
      <div className="career-profile-screen-position-tags">
        {entry.employmentType ? (
          <span className="career-profile-screen-tag">{entry.employmentType}</span>
        ) : null}
        {entry.workplaceType ? (
          <span className="career-profile-screen-tag">{WORKPLACE_LABEL[entry.workplaceType]}</span>
        ) : null}
      </div>
      {periodLabel(entry) ? (
        <div className="career-profile-screen-position-dates">{periodLabel(entry)}</div>
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
    </div>
  );
}

function PositionRow({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeExperienceInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeExperienceInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <PositionEditForm
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
  return <PositionSummary entry={entry} onEdit={() => setEditing(true)} onRemove={onRemove} />;
}

function CompanyGroup({
  group,
  saving,
  onSectionSave,
  draft,
}: {
  readonly group: ReturnType<typeof groupExperienceByEmployer>[number];
  readonly saving?: boolean;
  readonly draft: ResumeDraft;
  readonly onSectionSave: (next: ResumeDraft) => void;
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
          saving={saving}
          onSave={(patch) => onSectionSave(updateExperience(draft, entry.id, patch))}
          onRemove={() => onSectionSave(removeExperience(draft, entry.id))}
        />
      ))}
    </div>
  );
}

export function ProfileExperienceSection({ draft, saving, onSectionSave }: SectionProps) {
  const groups = groupExperienceByEmployer(draft.experience);
  const addPosition = () => onSectionSave(addExperience(draft, `manual-${Date.now()}`));
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-experience"
      aria-labelledby="sec-experience-title"
    >
      <SectionHead
        id="sec-experience-title"
        title="Опыт"
        count={
          draft.experience.length
            ? `${draft.experience.length} позиции · ${groups.length} компании`
            : undefined
        }
        imported={draft.experience.length > 0}
        action={<SectionAddButton label="Добавить место работы" onClick={addPosition} />}
      />
      {!draft.experience.length ? (
        <p className="career-profile-screen-empty-note">Опыт работы ещё не добавлен.</p>
      ) : (
        groups.map((group) => (
          <CompanyGroup
            key={group.key}
            group={group}
            saving={saving}
            draft={draft}
            onSectionSave={onSectionSave}
          />
        ))
      )}
    </section>
  );
}

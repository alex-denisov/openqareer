import { useState } from 'react';
import {
  addCertification,
  addProject,
  removeCertification,
  removeProject,
  updateCertification,
  updateProject,
} from './profileEntryEditing';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeCertificationInput, ResumeDraft, ResumeProjectInput } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
}

function CertificateEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeCertificationInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeCertificationInput>) => void;
}) {
  const [name, setName] = useState(entry.name);
  const [issuer, setIssuer] = useState(entry.issuer ?? '');
  const [issuedAt, setIssuedAt] = useState(entry.issuedAt ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Название</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Кто выдал</span>
          <input value={issuer} onChange={(event) => setIssuer(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Дата выдачи</span>
          <input value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
        </label>
      </div>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ name, issuer, issuedAt })}
      />
    </div>
  );
}

function CertificateTile({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeCertificationInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeCertificationInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CertificateEditForm
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
    <div className="career-profile-screen-tile">
      <div className="career-profile-screen-tile-head">
        <b>{entry.name || 'Название не указано'}</b>
        <SectionPencilButton label="Изменить сертификат" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить сертификат" onClick={onRemove} />
      </div>
      <span className="career-profile-screen-tile-meta">
        {[entry.issuer, entry.issuedAt ? `выдан ${entry.issuedAt}` : undefined]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {entry.url ? (
        <a className="career-profile-screen-tile-link" href={entry.url}>
          Подтверждение
        </a>
      ) : null}
    </div>
  );
}

export function ProfileCertificatesSection({ draft, saving, onSectionSave }: SectionProps) {
  const certifications = draft.certifications ?? [];
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-certificates"
      aria-labelledby="sec-certificates-title"
    >
      <SectionHead
        id="sec-certificates-title"
        title="Сертификаты"
        count={certifications.length ? String(certifications.length) : undefined}
        imported={certifications.length > 0}
        action={
          <SectionAddButton
            label="Добавить сертификат"
            onClick={() => onSectionSave(addCertification(draft))}
          />
        }
      />
      {!certifications.length ? (
        <p className="career-profile-screen-empty-note">Сертификаты ещё не добавлены.</p>
      ) : (
        <div className="career-profile-screen-tile-grid">
          {certifications.map((cert) => (
            <CertificateTile
              key={cert.id}
              entry={cert}
              saving={saving}
              onSave={(patch) => onSectionSave(updateCertification(draft, cert.id, patch))}
              onRemove={() => onSectionSave(removeCertification(draft, cert.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeProjectInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeProjectInput>) => void;
}) {
  const [name, setName] = useState(entry.name);
  const [employer, setEmployer] = useState(entry.employer ?? '');
  const [description, setDescription] = useState(entry.description ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Название</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Компания</span>
          <input value={employer} onChange={(event) => setEmployer(event.target.value)} />
        </label>
      </div>
      <label className="career-profile-screen-field">
        <span>Описание</span>
        <textarea
          className="career-profile-screen-textarea"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ name, employer, description })}
      />
    </div>
  );
}

function ProjectTile({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeProjectInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeProjectInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <ProjectEditForm
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
    <div className="career-profile-screen-tile">
      <div className="career-profile-screen-tile-head">
        <b>{entry.name || 'Название не указано'}</b>
        <SectionPencilButton label="Изменить проект" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить проект" onClick={onRemove} />
      </div>
      <span className="career-profile-screen-tile-meta">
        {[entry.employer, [entry.startDate, entry.endDate].filter(Boolean).join(' — ')]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {entry.description ? <p>{entry.description}</p> : null}
    </div>
  );
}

export function ProfileProjectsSection({ draft, saving, onSectionSave }: SectionProps) {
  const projects = draft.projects ?? [];
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-projects"
      aria-labelledby="sec-projects-title"
    >
      <SectionHead
        id="sec-projects-title"
        title="Проекты"
        count={projects.length ? String(projects.length) : undefined}
        imported={projects.length > 0}
        action={
          <SectionAddButton label="Добавить проект" onClick={() => onSectionSave(addProject(draft))} />
        }
      />
      {!projects.length ? (
        <p className="career-profile-screen-empty-note">Проекты ещё не добавлены.</p>
      ) : (
        <div className="career-profile-screen-tile-grid">
          {projects.map((project) => (
            <ProjectTile
              key={project.id}
              entry={project}
              saving={saving}
              onSave={(patch) => onSectionSave(updateProject(draft, project.id, patch))}
              onRemove={() => onSectionSave(removeProject(draft, project.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

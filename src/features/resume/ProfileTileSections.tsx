import { useState } from 'react';
import { ProfileFactProvenance } from './ProfileProvenanceChip';
import { useProfileEntrySave, type ProfileEntrySaveResult } from './profileEntrySave';
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
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
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
  readonly onSave: (patch: Partial<ResumeCertificationInput>) => ProfileEntrySaveResult;
}) {
  const submit = useProfileEntrySave(onSave, (patch: Partial<ResumeCertificationInput>) =>
    patch.name?.trim() ? undefined : 'Укажите название сертификата.',
  );
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
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <SectionEditActions
        saving={saving || submit.busy}
        onCancel={onCancel}
        onSave={() => {
          void submit.save({ name, issuer, issuedAt });
        }}
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
  readonly onSave: (patch: Partial<ResumeCertificationInput>) => ProfileEntrySaveResult;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CertificateEditForm
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

function NewCertificateForm({
  draft,
  entry,
  saving,
  onSectionSave,
  onCancel,
}: SectionProps & { readonly entry: ResumeCertificationInput; readonly onCancel: () => void }) {
  return (
    <CertificateEditForm
      entry={entry}
      saving={saving}
      onCancel={onCancel}
      onSave={async (patch) => {
        const result = await onSectionSave({
          ...draft,
          certifications: [...(draft.certifications ?? []), { ...entry, ...patch }],
        });
        if (result !== false) onCancel();
        return result;
      }}
    />
  );
}

export function ProfileCertificatesSection({ draft, saving, onSectionSave }: SectionProps) {
  const certifications = draft.certifications ?? [];
  const [newEntry, setNewEntry] = useState<ResumeCertificationInput>();
  const addItem = () => setNewEntry(addCertification(draft).certifications?.at(-1));
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
        action={<SectionAddButton label="Добавить сертификат" onClick={addItem} />}
      />
      {newEntry ? (
        <NewCertificateForm
          draft={draft}
          entry={newEntry}
          saving={saving}
          onSectionSave={onSectionSave}
          onCancel={() => setNewEntry(undefined)}
        />
      ) : null}
      {!certifications.length && !newEntry ? (
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

function ProjectIdentityFields({
  name,
  employer,
  onName,
  onEmployer,
}: {
  readonly name: string;
  readonly employer: string;
  readonly onName: (value: string) => void;
  readonly onEmployer: (value: string) => void;
}) {
  return (
    <div className="career-profile-screen-field-grid">
      <label className="career-profile-screen-field">
        <span>Название</span>
        <input value={name} onChange={(event) => onName(event.target.value)} />
      </label>
      <label className="career-profile-screen-field">
        <span>Компания</span>
        <input value={employer} onChange={(event) => onEmployer(event.target.value)} />
      </label>
    </div>
  );
}

export function ProjectEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeProjectInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeProjectInput>) => ProfileEntrySaveResult;
}) {
  const submit = useProfileEntrySave(onSave, (patch: Partial<ResumeProjectInput>) =>
    patch.name?.trim() ? undefined : 'Укажите название проекта.',
  );
  const [name, setName] = useState(entry.name);
  const [employer, setEmployer] = useState(entry.employer ?? '');
  const [description, setDescription] = useState(entry.description ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <ProjectIdentityFields
        name={name}
        employer={employer}
        onName={setName}
        onEmployer={setEmployer}
      />
      <label className="career-profile-screen-field">
        <span>Описание</span>
        <textarea
          className="career-profile-screen-textarea"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <SectionEditActions
        saving={saving || submit.busy}
        onCancel={onCancel}
        onSave={() => {
          void submit.save({ name, employer, description });
        }}
      />
    </div>
  );
}

interface ProjectTileProps {
  readonly entry: ResumeProjectInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeProjectInput>) => ProfileEntrySaveResult;
  readonly onRemove: () => void;
}

function ProjectTile({ entry, saving, onSave, onRemove }: ProjectTileProps) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <ProjectEditForm
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
    <div className="career-profile-screen-tile">
      <div className="career-profile-screen-tile-head">
        <div className="profile-project-identity">
          <b>{entry.name || 'Название не указано'}</b>
          <p className="career-profile-screen-tile-meta">
            {[entry.description, entry.employer].filter(Boolean).join(', ')}
          </p>
        </div>
        <span className="profile-project-period">
          {[entry.startDate, entry.current ? 'по н. в.' : entry.endDate]
            .map((value) => value?.replace(/^(\d{4})-(\d{2})$/u, '$2.$1'))
            .filter(Boolean)
            .join(' — ')}
        </span>
        <SectionPencilButton label="Изменить проект" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить проект" onClick={onRemove} />
      </div>
      {entry.url ? (
        <a href={entry.url} target="_blank" rel="noopener noreferrer">
          Открыть проект
        </a>
      ) : null}
      <div className="career-profile-screen-entry-origin">
        <ProfileFactProvenance memoryId={entry.evidenceMemoryId ?? `manual-${entry.id}`} />
      </div>
    </div>
  );
}

function NewProjectEntryForm({
  draft,
  entry,
  saving,
  onSectionSave,
  onCancel,
}: SectionProps & { readonly entry: ResumeProjectInput; readonly onCancel: () => void }) {
  return (
    <ProjectEditForm
      entry={entry}
      saving={saving}
      onCancel={onCancel}
      onSave={async (patch) => {
        const result = await onSectionSave({
          ...draft,
          projects: [...(draft.projects ?? []), { ...entry, ...patch }],
        });
        if (result !== false) onCancel();
        return result;
      }}
    />
  );
}

export function ProfileProjectsSection({ draft, saving, onSectionSave }: SectionProps) {
  const projects = draft.projects ?? [];
  const [newEntry, setNewEntry] = useState<ResumeProjectInput>();
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-projects"
      aria-labelledby="sec-projects-title"
    >
      <SectionHead
        id="sec-projects-title"
        title="Проекты"
        action={
          <SectionAddButton
            label="Добавить проект"
            onClick={() => setNewEntry(addProject(draft).projects?.at(-1))}
          />
        }
      />
      {newEntry ? (
        <NewProjectEntryForm
          draft={draft}
          entry={newEntry}
          saving={saving}
          onSectionSave={onSectionSave}
          onCancel={() => setNewEntry(undefined)}
        />
      ) : null}
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

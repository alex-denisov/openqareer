import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireStepFormProps } from '../RelocationQuestionnaireSteps';
import {
  CountrySelect,
  EducationLevelSelect,
  RecognitionSelect,
  RelocationFormField,
  relocationRowId,
} from '../RelocationFormControls';

type RelocationEducation = RelocationQuestionnaire['education']['education'][number];
type RelocationCertificate = RelocationQuestionnaire['education']['certificates'][number];
type RelocationDraftProps = Pick<RelocationQuestionnaireStepFormProps, 'profile' | 'onProfileChange'>;

interface NewCertificateDraft {
  readonly title: string;
  readonly issuer: string;
  readonly countryCode: string;
  readonly recognitionStatus: RelocationCertificate['recognitionStatus'];
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export function EducationForm(props: RelocationQuestionnaireStepFormProps) {
  return (
    <div className="career-relocation-step-content">
      <EducationEntries {...props} />
      <NewEducationForm {...props} />
      <CertificateEntries {...props} />
      <NewCertificateForm {...props} />
    </div>
  );
}

function EducationEntries({ profile, onProfileChange }: RelocationDraftProps) {
  const entries = profile.education.education;
  if (!entries.length) return <p className="career-relocation-empty">Образование не указано.</p>;
  return (
    <section className="career-relocation-step-card" aria-labelledby="relocation-education-title">
      <h3 id="relocation-education-title">Образование</h3>
      <div className="career-relocation-edit-list">
        {entries.map((entry) => (
          <EducationRow key={entry.id} entry={entry} profile={profile} onProfileChange={onProfileChange} />
        ))}
      </div>
    </section>
  );
}

function EducationRow({
  entry,
  profile,
  onProfileChange,
}: {
  readonly entry: RelocationEducation;
  readonly profile: RelocationQuestionnaireStepFormProps['profile'];
  readonly onProfileChange: RelocationQuestionnaireStepFormProps['onProfileChange'];
}) {
  const prefix = `relocation-education-${entry.id}`;
  const update = (change: Partial<RelocationEducation>) => onProfileChange({
    ...profile,
    education: {
      ...profile.education,
      education: profile.education.education.map((item) => item.id === entry.id ? { ...item, ...change } : item),
    },
  });
  const remove = () => onProfileChange({
    ...profile,
    education: { ...profile.education, education: profile.education.education.filter(({ id }) => id !== entry.id) },
  });
  return (
    <fieldset className="career-relocation-record">
      <legend>{entry.title}</legend>
      <div className="career-relocation-form-grid">
        <RelocationFormField id={`${prefix}-title`} label="Учебное заведение"><input id={`${prefix}-title`} value={entry.title} onChange={(event) => update({ title: event.target.value })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-level`} label="Степень"><EducationLevelSelect id={`${prefix}-level`} value={entry.level} onChange={(level) => update({ level })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-field`} label="Направление"><input id={`${prefix}-field`} value={entry.fieldOfStudy ?? ''} onChange={(event) => update({ fieldOfStudy: event.target.value || undefined })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-country`} label="Страна диплома"><CountrySelect id={`${prefix}-country`} value={entry.countryCode} onChange={(countryCode) => update({ countryCode })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-recognition`} label="Признание за рубежом"><RecognitionSelect id={`${prefix}-recognition`} value={entry.recognitionStatus} onChange={(recognitionStatus) => update({ recognitionStatus })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-started`} label="Дата начала"><input id={`${prefix}-started`} type="date" value={entry.startedAt ?? ''} onChange={(event) => update({ startedAt: event.target.value || undefined })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-completed`} label="Дата окончания"><input id={`${prefix}-completed`} type="date" value={entry.completedAt ?? ''} onChange={(event) => update({ completedAt: event.target.value || undefined })} /></RelocationFormField>
      </div>
      <button className="career-btn career-btn-destructive" type="button" onClick={remove}>
        <Trash aria-hidden="true" size={16} />Удалить образование
      </button>
    </fieldset>
  );
}

function NewEducationForm({ profile, onProfileChange }: RelocationDraftProps) {
  const [draft, setDraft] = useState({
    title: '', level: 'bachelor' as RelocationEducation['level'], fieldOfStudy: '',
    countryCode: '', recognitionStatus: 'unknown' as RelocationEducation['recognitionStatus'],
    startedAt: '', completedAt: '',
  });
  const add = () => {
    if (!draft.title.trim() || !draft.countryCode) return;
    const entry: RelocationEducation = {
      id: relocationRowId('education'),
      title: draft.title.trim(),
      level: draft.level,
      countryCode: draft.countryCode,
      recognitionStatus: draft.recognitionStatus,
      ...(draft.fieldOfStudy.trim() ? { fieldOfStudy: draft.fieldOfStudy.trim() } : {}),
      ...(draft.startedAt ? { startedAt: draft.startedAt } : {}),
      ...(draft.completedAt ? { completedAt: draft.completedAt } : {}),
    };
    onProfileChange({ ...profile, education: { ...profile.education, education: [...profile.education.education, entry] } });
    setDraft({ ...draft, title: '', fieldOfStudy: '', countryCode: '', startedAt: '', completedAt: '' });
  };
  return <EducationDraft draft={draft} onChange={setDraft} onAdd={add} />;
}

function EducationDraft({
  draft,
  onChange,
  onAdd,
}: {
  readonly draft: ReturnType<typeof initialEducationDraft>;
  readonly onChange: (draft: ReturnType<typeof initialEducationDraft>) => void;
  readonly onAdd: () => void;
}) {
  const prefix = 'relocation-new-education';
  return (
    <section className="career-relocation-add-form" aria-labelledby="relocation-add-education-title">
      <h3 id="relocation-add-education-title">Добавить образование</h3>
      <div className="career-relocation-form-grid">
        <RelocationFormField id={`${prefix}-title`} label="Учебное заведение"><input id={`${prefix}-title`} value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-level`} label="Степень"><EducationLevelSelect id={`${prefix}-level`} value={draft.level} onChange={(level) => onChange({ ...draft, level })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-field`} label="Направление"><input id={`${prefix}-field`} value={draft.fieldOfStudy} onChange={(event) => onChange({ ...draft, fieldOfStudy: event.target.value })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-country`} label="Страна диплома"><CountrySelect id={`${prefix}-country`} value={draft.countryCode} onChange={(countryCode) => onChange({ ...draft, countryCode })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-recognition`} label="Признание"><RecognitionSelect id={`${prefix}-recognition`} value={draft.recognitionStatus} onChange={(recognitionStatus) => onChange({ ...draft, recognitionStatus })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-started`} label="Дата начала"><input id={`${prefix}-started`} type="date" value={draft.startedAt} onChange={(event) => onChange({ ...draft, startedAt: event.target.value })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-completed`} label="Дата окончания"><input id={`${prefix}-completed`} type="date" value={draft.completedAt} onChange={(event) => onChange({ ...draft, completedAt: event.target.value })} /></RelocationFormField>
      </div>
      <button className="career-btn career-btn-secondary" type="button" disabled={!draft.title.trim() || !draft.countryCode} onClick={onAdd}>
        <Plus aria-hidden="true" size={16} />Добавить образование
      </button>
    </section>
  );
}

function initialEducationDraft() {
  return {
    title: '', level: 'bachelor' as RelocationEducation['level'], fieldOfStudy: '',
    countryCode: '', recognitionStatus: 'unknown' as RelocationEducation['recognitionStatus'],
    startedAt: '', completedAt: '',
  };
}

function CertificateEntries({ profile, onProfileChange }: RelocationDraftProps) {
  const entries = profile.education.certificates;
  return (
    <section className="career-relocation-step-card" aria-labelledby="relocation-certificates-title">
      <h3 id="relocation-certificates-title">Ассессменты и сертификаты</h3>
      {entries.length ? (
        <div className="career-relocation-edit-list">
          {entries.map((entry) => (
            <CertificateRow key={entry.id} entry={entry} profile={profile} onProfileChange={onProfileChange} />
          ))}
        </div>
      ) : <p>Сертификаты не указаны.</p>}
      <p>Импорт сертификатов пока не поддержан. Языки можно перенести из подключённого профиля.</p>
    </section>
  );
}

function CertificateRow({
  entry,
  profile,
  onProfileChange,
}: {
  readonly entry: RelocationCertificate;
  readonly profile: RelocationQuestionnaireStepFormProps['profile'];
  readonly onProfileChange: RelocationQuestionnaireStepFormProps['onProfileChange'];
}) {
  const prefix = `relocation-certificate-${entry.id}`;
  const update = (change: Partial<RelocationCertificate>) => onProfileChange({
    ...profile,
    education: {
      ...profile.education,
      certificates: profile.education.certificates.map((item) => item.id === entry.id ? { ...item, ...change } : item),
    },
  });
  const remove = () => onProfileChange({
    ...profile,
    education: { ...profile.education, certificates: profile.education.certificates.filter(({ id }) => id !== entry.id) },
  });
  return (
    <fieldset className="career-relocation-record">
      <legend>{entry.title}</legend>
      <CertificateFields prefix={prefix} entry={entry} onChange={update} />
      <button className="career-btn career-btn-destructive" type="button" onClick={remove}>
        <Trash aria-hidden="true" size={16} />Удалить сертификат
      </button>
    </fieldset>
  );
}

function CertificateFields({
  prefix,
  entry,
  onChange,
}: {
  readonly prefix: string;
  readonly entry: Pick<RelocationCertificate, 'title' | 'issuer' | 'countryCode' | 'recognitionStatus' | 'issuedAt' | 'expiresAt'>;
  readonly onChange: (change: Partial<RelocationCertificate>) => void;
}) {
  return (
    <div className="career-relocation-form-grid">
      <RelocationFormField id={`${prefix}-title`} label="Название"><input id={`${prefix}-title`} value={entry.title} onChange={(event) => onChange({ title: event.target.value })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-issuer`} label="Выдавшая организация"><input id={`${prefix}-issuer`} value={entry.issuer ?? ''} onChange={(event) => onChange({ issuer: event.target.value || undefined })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-country`} label="Страна"><CountrySelect id={`${prefix}-country`} value={entry.countryCode} onChange={(countryCode) => onChange({ countryCode })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-recognition`} label="Признание"><RecognitionSelect id={`${prefix}-recognition`} value={entry.recognitionStatus} onChange={(recognitionStatus) => onChange({ recognitionStatus })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-issued`} label="Дата выдачи"><input id={`${prefix}-issued`} type="date" value={entry.issuedAt ?? ''} onChange={(event) => onChange({ issuedAt: event.target.value || undefined })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-expires`} label="Действует до"><input id={`${prefix}-expires`} type="date" value={entry.expiresAt ?? ''} onChange={(event) => onChange({ expiresAt: event.target.value || undefined })} /></RelocationFormField>
    </div>
  );
}

function NewCertificateForm(props: RelocationDraftProps) {
  const [draft, setDraft] = useState<NewCertificateDraft>({
    title: '', issuer: '', countryCode: '', recognitionStatus: 'unknown', issuedAt: '', expiresAt: '',
  });
  const add = () => {
    if (!draft.title.trim() || !draft.countryCode) return;
    const entry: RelocationCertificate = {
      id: relocationRowId('certificate'),
      title: draft.title.trim(),
      countryCode: draft.countryCode,
      recognitionStatus: draft.recognitionStatus,
      ...(draft.issuer.trim() ? { issuer: draft.issuer.trim() } : {}),
      ...(draft.issuedAt ? { issuedAt: draft.issuedAt } : {}),
      ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
    };
    props.onProfileChange({
      ...props.profile,
      education: { ...props.profile.education, certificates: [...props.profile.education.certificates, entry] },
    });
    setDraft({ title: '', issuer: '', countryCode: '', recognitionStatus: 'unknown', issuedAt: '', expiresAt: '' });
  };
  return <CertificateDraft draft={draft} onChange={setDraft} onAdd={add} />;
}

function CertificateDraft({
  draft,
  onChange,
  onAdd,
}: {
  readonly draft: NewCertificateDraft;
  readonly onChange: (draft: NewCertificateDraft) => void;
  readonly onAdd: () => void;
}) {
  return (
    <section className="career-relocation-add-form" aria-labelledby="relocation-add-certificate-title">
      <h3 id="relocation-add-certificate-title">Добавить сертификат</h3>
      <CertificateFields
        prefix="relocation-new-certificate"
        entry={draft}
        onChange={(change) => onChange({ ...draft, ...change })}
      />
      <button className="career-btn career-btn-secondary" type="button" disabled={!draft.title.trim() || !draft.countryCode} onClick={onAdd}>
        <Plus aria-hidden="true" size={16} />Добавить сертификат
      </button>
    </section>
  );
}

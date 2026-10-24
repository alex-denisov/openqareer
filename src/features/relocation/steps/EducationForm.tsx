import { RelocationDateInput } from '../RelocationFormControls';
import { useState } from 'react';
import { Info, Plus, Trash } from '@phosphor-icons/react';
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

/** Mockup 15 `i2`: education rows and the add form; certificates open by a checkbox. */
export function EducationForm(props: RelocationQuestionnaireStepFormProps) {
  const [certificates, setCertificates] = useState(props.profile.education.certificates.length > 0);
  return (
    <div className="career-relocation-step-content">
      <EducationEntries {...props} />
      <NewEducationForm {...props} />
      <label className="career-relocation-check">
        <input type="checkbox" checked={certificates} onChange={(event) => setCertificates(event.target.checked)} />
        <span>Есть ассессменты или сертификаты, которые стоит учесть</span>
      </label>
      {certificates ? (
        <section className="career-relocation-add-form career-relocation-certificates" aria-labelledby="relocation-certificates-title">
          <h3 id="relocation-certificates-title">Ассессменты и сертификаты</h3>
          <CertificateEntries {...props} />
          <NewCertificateForm {...props} />
        </section>
      ) : null}
    </div>
  );
}

function EducationEntries({ profile, onProfileChange }: RelocationDraftProps) {
  const entries = profile.education.education;
  if (!entries.length) return null;
  return (
    <section className="career-relocation-step-card" aria-label="Образование">
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
        <RelocationFormField id={`${prefix}-started`} label="Дата начала"><RelocationDateInput id={`${prefix}-started`} value={entry.startedAt ?? ''} onChange={(event) => update({ startedAt: event.target.value || undefined })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-completed`} label="Дата окончания"><RelocationDateInput id={`${prefix}-completed`} value={entry.completedAt ?? ''} onChange={(event) => update({ completedAt: event.target.value || undefined })} /></RelocationFormField>
      </div>
      <button className="career-relocation-btn is-danger" type="button" onClick={remove}>
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
        <RelocationFormField id={`${prefix}-title`} label="Учебное заведение"><input id={`${prefix}-title`} placeholder="Например, МГУ им. Ломоносова" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-level`} label="Степень"><EducationLevelSelect id={`${prefix}-level`} value={draft.level} onChange={(level) => onChange({ ...draft, level })} /></RelocationFormField>
        <div className="career-relocation-field-wide"><RelocationFormField id={`${prefix}-field`} label="Направление, специальность"><input id={`${prefix}-field`} placeholder="Например, Прикладная математика" value={draft.fieldOfStudy} onChange={(event) => onChange({ ...draft, fieldOfStudy: event.target.value })} /></RelocationFormField></div>
        <RelocationFormField id={`${prefix}-country`} label="Страна диплома"><CountrySelect id={`${prefix}-country`} value={draft.countryCode} onChange={(countryCode) => onChange({ ...draft, countryCode })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-recognition`} label="Признание диплома за рубежом"><RecognitionSelect id={`${prefix}-recognition`} value={draft.recognitionStatus} onChange={(recognitionStatus) => onChange({ ...draft, recognitionStatus })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-started`} label="Дата начала"><RelocationDateInput id={`${prefix}-started`} value={draft.startedAt} onChange={(event) => onChange({ ...draft, startedAt: event.target.value })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-completed`} label="Дата окончания"><RelocationDateInput id={`${prefix}-completed`} value={draft.completedAt} onChange={(event) => onChange({ ...draft, completedAt: event.target.value })} /></RelocationFormField>
      </div>
      <button className="career-relocation-btn" type="button" disabled={!draft.title.trim() || !draft.countryCode} onClick={onAdd}>
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
  if (!entries.length) {
    return (
      <p className="career-relocation-summary-note">
        <Info aria-hidden="true" size={16} />
        <span>В профиле сертификатов нет. Добавьте вручную.</span>
      </p>
    );
  }
  return (
    <div className="career-relocation-edit-list">
      {entries.map((entry) => (
        <CertificateRow key={entry.id} entry={entry} profile={profile} onProfileChange={onProfileChange} />
      ))}
    </div>
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
      <button className="career-relocation-btn is-danger" type="button" onClick={remove}>
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
      <RelocationFormField id={`${prefix}-title`} label="Название"><input id={`${prefix}-title`} placeholder="Например, AWS Certified Solutions Architect" value={entry.title} onChange={(event) => onChange({ title: event.target.value })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-issuer`} label="Выдавшая организация"><input id={`${prefix}-issuer`} placeholder="Например, Amazon Web Services" value={entry.issuer ?? ''} onChange={(event) => onChange({ issuer: event.target.value || undefined })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-country`} label="Страна"><CountrySelect id={`${prefix}-country`} value={entry.countryCode} onChange={(countryCode) => onChange({ countryCode })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-recognition`} label="Признание"><RecognitionSelect id={`${prefix}-recognition`} value={entry.recognitionStatus} onChange={(recognitionStatus) => onChange({ recognitionStatus })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-issued`} label="Дата выдачи"><RelocationDateInput id={`${prefix}-issued`} value={entry.issuedAt ?? ''} onChange={(event) => onChange({ issuedAt: event.target.value || undefined })} /></RelocationFormField>
      <RelocationFormField id={`${prefix}-expires`} label="Действует до"><RelocationDateInput id={`${prefix}-expires`} value={entry.expiresAt ?? ''} onChange={(event) => onChange({ expiresAt: event.target.value || undefined })} /></RelocationFormField>
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
    <div className="career-relocation-certificate-draft">
      <CertificateFields
        prefix="relocation-new-certificate"
        entry={draft}
        onChange={(change) => onChange({ ...draft, ...change })}
      />
      <button className="career-relocation-btn" type="button" disabled={!draft.title.trim() || !draft.countryCode} onClick={onAdd}>
        <Plus aria-hidden="true" size={16} />Добавить сертификат
      </button>
    </div>
  );
}

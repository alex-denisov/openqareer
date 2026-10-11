import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireStepFormProps } from '../RelocationQuestionnaireSteps';
import {
  CountrySelect,
  DocumentKindSelect,
  RelocationFormField,
  relocationCountryName,
  relocationDocumentKindLabel,
  relocationRowId,
} from '../RelocationFormControls';

type RelocationDocument = RelocationQuestionnaire['citizenshipDocuments']['documents'][number];
type RelocationDraftProps = Pick<RelocationQuestionnaireStepFormProps, 'profile' | 'onProfileChange'>;

export function CitizenshipDocumentsForm(props: RelocationQuestionnaireStepFormProps) {
  return (
    <div className="career-relocation-step-content">
      <CitizenshipList {...props} />
      <DocumentsSection {...props} />
    </div>
  );
}

function CitizenshipList({ profile, onProfileChange }: RelocationDraftProps) {
  const [countryToAdd, setCountryToAdd] = useState('');
  const countries = profile.citizenshipDocuments.citizenshipCountryCodes;
  const add = () => {
    if (!countryToAdd || countries.includes(countryToAdd)) return;
    onProfileChange({ ...profile, citizenshipDocuments: { ...profile.citizenshipDocuments, citizenshipCountryCodes: [...countries, countryToAdd] } });
    setCountryToAdd('');
  };
  const remove = (countryCode: string) => onProfileChange({
    ...profile,
    citizenshipDocuments: { ...profile.citizenshipDocuments, citizenshipCountryCodes: countries.filter((code) => code !== countryCode) },
  });
  return (
    <section className="career-relocation-step-card" aria-labelledby="relocation-citizenship-title">
      <h3 id="relocation-citizenship-title">Гражданство</h3>
      <div className="career-relocation-chip-list">
        {countries.map((countryCode) => (
          <span className="career-relocation-chip" key={countryCode}>
            {relocationCountryName(countryCode)}
            <button type="button" aria-label={`Убрать гражданство: ${relocationCountryName(countryCode)}`} onClick={() => remove(countryCode)}>
              <Trash aria-hidden="true" size={15} />
            </button>
          </span>
        ))}
      </div>
      <div className="career-relocation-inline-form">
        <RelocationFormField id="relocation-citizenship-add" label="Добавить гражданство">
          <CountrySelect id="relocation-citizenship-add" value={countryToAdd} onChange={setCountryToAdd} />
        </RelocationFormField>
        <button className="career-btn career-btn-secondary" type="button" disabled={!countryToAdd} onClick={add}>
          <Plus aria-hidden="true" size={16} />Добавить
        </button>
      </div>
    </section>
  );
}

function DocumentsSection({ profile, onProfileChange }: RelocationDraftProps) {
  return (
    <section className="career-relocation-step-card" aria-labelledby="relocation-documents-title">
      <h3 id="relocation-documents-title">Вид на жительство, разрешения и визы</h3>
      {profile.citizenshipDocuments.documents.length ? (
        <div className="career-relocation-edit-list">
          {profile.citizenshipDocuments.documents.map((document) => (
            <DocumentEditor key={document.id} document={document} profile={profile} onProfileChange={onProfileChange} />
          ))}
        </div>
      ) : <p>Документы не указаны.</p>}
      <NewDocumentForm profile={profile} onProfileChange={onProfileChange} />
    </section>
  );
}

function DocumentEditor({
  document,
  profile,
  onProfileChange,
}: {
  readonly document: RelocationDocument;
  readonly profile: RelocationQuestionnaireStepFormProps['profile'];
  readonly onProfileChange: RelocationQuestionnaireStepFormProps['onProfileChange'];
}) {
  const update = (change: Partial<RelocationDocument>) => onProfileChange({
    ...profile,
    citizenshipDocuments: {
      ...profile.citizenshipDocuments,
      documents: profile.citizenshipDocuments.documents.map((item) => item.id === document.id ? { ...item, ...change } : item),
    },
  });
  const remove = () => onProfileChange({
    ...profile,
    citizenshipDocuments: {
      ...profile.citizenshipDocuments,
      documents: profile.citizenshipDocuments.documents.filter((item) => item.id !== document.id),
    },
  });
  return (
    <fieldset className="career-relocation-record">
      <legend>{relocationDocumentKindLabel(document.kind)}, {relocationCountryName(document.countryCode)}</legend>
      <DocumentFields document={document} onChange={update} prefix={document.id} />
      <button className="career-btn career-btn-destructive" type="button" onClick={remove}>
        <Trash aria-hidden="true" size={16} />Удалить документ
      </button>
    </fieldset>
  );
}

function DocumentFields({
  document,
  onChange,
  prefix,
}: {
  readonly document: Pick<RelocationDocument, 'kind' | 'countryCode' | 'issuedAt' | 'expiresAt'>;
  readonly onChange: (change: Partial<RelocationDocument>) => void;
  readonly prefix: string;
}) {
  const countryId = `${prefix}-country`;
  const kindId = `${prefix}-kind`;
  const issuedId = `${prefix}-issued`;
  const expiresId = `${prefix}-expires`;
  return (
    <div className="career-relocation-form-grid">
      <RelocationFormField id={kindId} label="Тип документа"><DocumentKindSelect id={kindId} value={document.kind} onChange={(kind) => onChange({ kind })} /></RelocationFormField>
      <RelocationFormField id={countryId} label="Страна"><CountrySelect id={countryId} value={document.countryCode} onChange={(countryCode) => onChange({ countryCode })} /></RelocationFormField>
      <RelocationFormField id={issuedId} label="Дата выдачи"><input id={issuedId} type="date" value={document.issuedAt ?? ''} onChange={(event) => onChange({ issuedAt: event.target.value || undefined })} /></RelocationFormField>
      <RelocationFormField id={expiresId} label="Действует до"><input id={expiresId} type="date" value={document.expiresAt ?? ''} onChange={(event) => onChange({ expiresAt: event.target.value || undefined })} /></RelocationFormField>
    </div>
  );
}

function NewDocumentForm({ profile, onProfileChange }: RelocationDraftProps) {
  const [kind, setKind] = useState<RelocationDocument['kind']>('residence_permit');
  const [countryCode, setCountryCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const add = () => {
    if (!countryCode) return;
    const document: RelocationDocument = { id: relocationRowId('document'), kind, countryCode, ...(expiresAt ? { expiresAt } : {}) };
    onProfileChange({
      ...profile,
      citizenshipDocuments: { ...profile.citizenshipDocuments, documents: [...profile.citizenshipDocuments.documents, document] },
    });
    setCountryCode('');
    setExpiresAt('');
  };
  const kindId = 'relocation-new-document-kind';
  const countryId = 'relocation-new-document-country';
  const expiresId = 'relocation-new-document-expires';
  return (
    <div className="career-relocation-add-form">
      <h4>Добавить документ</h4>
      <div className="career-relocation-form-grid">
        <RelocationFormField id={kindId} label="Тип документа"><DocumentKindSelect id={kindId} value={kind} onChange={setKind} /></RelocationFormField>
        <RelocationFormField id={countryId} label="Страна"><CountrySelect id={countryId} value={countryCode} onChange={setCountryCode} /></RelocationFormField>
        <RelocationFormField id={expiresId} label="Действует до"><input id={expiresId} type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></RelocationFormField>
      </div>
      <button className="career-btn career-btn-secondary" type="button" disabled={!countryCode} onClick={add}>
        <Plus aria-hidden="true" size={16} />Добавить документ
      </button>
    </div>
  );
}

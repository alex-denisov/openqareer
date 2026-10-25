import { RelocationDateInput } from '../RelocationFormControls';
import { useState } from 'react';
import { Check, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
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
import { localIsoDate, relocationDay } from '../relocationDates';

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

/** Mockup 15 `i1`: one citizenship picker and «Есть второе гражданство» for a second one. */
function CitizenshipList({ profile, onProfileChange }: RelocationDraftProps) {
  const countries = profile.citizenshipDocuments.citizenshipCountryCodes;
  const [second, setSecond] = useState(countries.length > 1);
  const write = (codes: readonly string[]) => onProfileChange({
    ...profile,
    citizenshipDocuments: { ...profile.citizenshipDocuments, citizenshipCountryCodes: [...new Set(codes.filter(Boolean))] },
  });
  const toggleSecond = (checked: boolean) => {
    setSecond(checked);
    if (!checked) write(countries.slice(0, 1));
  };
  return (
    <section className="career-relocation-step-card" aria-labelledby="relocation-citizenship-title">
      <RelocationFormField id="relocation-citizenship-first" label="Гражданство">
        <CountrySelect id="relocation-citizenship-first" value={countries[0] ?? ''} onChange={(code) => write([code, ...countries.slice(1)])} />
      </RelocationFormField>
      <label className="career-relocation-check">
        <input type="checkbox" checked={second} onChange={(event) => toggleSecond(event.target.checked)} />
        <span id="relocation-citizenship-title">Есть второе гражданство</span>
      </label>
      {second ? (
        <RelocationFormField id="relocation-citizenship-second" label="Второе гражданство">
          <CountrySelect id="relocation-citizenship-second" value={countries[1] ?? ''} onChange={(code) => write([countries[0] ?? '', code])} />
        </RelocationFormField>
      ) : null}
    </section>
  );
}

const SHORT_KIND: Readonly<Record<RelocationDocument['kind'], string>> = {
  residence_permit: 'ВНЖ', work_permit: 'Разрешение на работу', work_visa: 'Рабочая виза',
  study_visa: 'Учебная виза', visa: 'Виза', other: 'Документ',
};

function documentTitle(document: RelocationDocument): string {
  return `${SHORT_KIND[document.kind]}, ${relocationCountryName(document.countryCode)}`;
}

function documentTerm(document: RelocationDocument): string {
  if (!document.expiresAt) return 'Срок не указан';
  const today = localIsoDate();
  if (document.expiresAt < today) return `Истёк ${relocationDay(document.expiresAt)}`;
  const soon = new Date(`${today}T00:00:00`);
  soon.setMonth(soon.getMonth() + 6);
  const ending = document.expiresAt < localIsoDate(soon) ? ': срок скоро закончится' : '';
  return `До ${relocationDay(document.expiresAt)}${ending}`;
}

/** Mockup 15 `i1`: a saved document is a compact row; «Изменить» opens its fields in place. */
function DocumentsSection({ profile, onProfileChange }: RelocationDraftProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const remove = (id: string) => onProfileChange({
    ...profile,
    citizenshipDocuments: {
      ...profile.citizenshipDocuments,
      documents: profile.citizenshipDocuments.documents.filter((item) => item.id !== id),
    },
  });
  return (
    <section className="career-relocation-step-card" aria-labelledby="relocation-documents-title">
      <h3 id="relocation-documents-title">Вид на жительство, ПМЖ, визы</h3>
      {profile.citizenshipDocuments.documents.length ? (
        <ul className="career-relocation-doc-list">
          {profile.citizenshipDocuments.documents.map((document) => (
            <li key={document.id}>
              {editingId === document.id ? (
                <DocumentEditor document={document} profile={profile} onProfileChange={onProfileChange} onDone={() => setEditingId(null)} />
              ) : (
                <>
                  <div>
                    <strong>{documentTitle(document)}</strong>
                    <p>{documentTerm(document)}</p>
                  </div>
                  <span className="career-relocation-doc-actions">
                    <button className="career-relocation-btn is-sm is-icon is-ghost" type="button" aria-label={`Изменить: ${documentTitle(document)}`} onClick={() => setEditingId(document.id)}>
                      <PencilSimple aria-hidden="true" size={18} />
                    </button>
                    <button className="career-relocation-btn is-sm is-icon is-ghost" type="button" aria-label={`Удалить: ${documentTitle(document)}`} onClick={() => remove(document.id)}>
                      <Trash aria-hidden="true" size={18} />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="career-relocation-empty-line">Документы не указаны.</p>}
      <NewDocumentForm profile={profile} onProfileChange={onProfileChange} />
    </section>
  );
}

function DocumentEditor({
  document,
  profile,
  onProfileChange,
  onDone,
}: {
  readonly document: RelocationDocument;
  readonly profile: RelocationQuestionnaireStepFormProps['profile'];
  readonly onProfileChange: RelocationQuestionnaireStepFormProps['onProfileChange'];
  readonly onDone: () => void;
}) {
  const update = (change: Partial<RelocationDocument>) => onProfileChange({
    ...profile,
    citizenshipDocuments: {
      ...profile.citizenshipDocuments,
      documents: profile.citizenshipDocuments.documents.map((item) => item.id === document.id ? { ...item, ...change } : item),
    },
  });
  return (
    <fieldset className="career-relocation-record">
      <legend>{relocationDocumentKindLabel(document.kind)}, {relocationCountryName(document.countryCode)}</legend>
      <DocumentFields document={document} onChange={update} prefix={document.id} />
      <button className="career-relocation-btn" type="button" onClick={onDone}>
        <Check aria-hidden="true" size={16} />Готово
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
      <RelocationFormField id={issuedId} label="Дата выдачи"><RelocationDateInput id={issuedId} value={document.issuedAt ?? ''} onChange={(event) => onChange({ issuedAt: event.target.value || undefined })} /></RelocationFormField>
      <RelocationFormField id={expiresId} label="Действует до"><RelocationDateInput id={expiresId} value={document.expiresAt ?? ''} onChange={(event) => onChange({ expiresAt: event.target.value || undefined })} /></RelocationFormField>
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
        <RelocationFormField id={expiresId} label="Действует до"><RelocationDateInput id={expiresId} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></RelocationFormField>
      </div>
      <button className="career-relocation-btn" type="button" disabled={!countryCode} onClick={add}>
        <Plus aria-hidden="true" size={16} />Добавить документ
      </button>
    </div>
  );
}

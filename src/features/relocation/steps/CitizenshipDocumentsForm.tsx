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
  const [documentOpen, setDocumentOpen] = useState(false);
  // 390 (mockup 15 `mv=doc`): a new document is its own push screen, not an inline form.
  if (props.mobile && documentOpen) {
    return <NewDocumentForm {...props} screen onDone={() => setDocumentOpen(false)} />;
  }
  return (
    <div className="career-relocation-step-content">
      <CitizenshipList {...props} />
      <DocumentsSection {...props} onOpenDocument={props.mobile ? () => setDocumentOpen(true) : undefined} />
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

function DocumentsSection({ profile, onProfileChange, onOpenDocument }: RelocationDraftProps & {
  readonly onOpenDocument?: () => void;
}) {
  return (
    <section className="career-relocation-step-card" aria-labelledby="relocation-documents-title">
      <h3 id="relocation-documents-title">Вид на жительство, ПМЖ, визы</h3>
      {profile.citizenshipDocuments.documents.length ? (
        <div className="career-relocation-edit-list">
          {profile.citizenshipDocuments.documents.map((document) => (
            <DocumentEditor key={document.id} document={document} profile={profile} onProfileChange={onProfileChange} />
          ))}
        </div>
      ) : <p>Документы не указаны.</p>}
      {onOpenDocument ? (
        <button className="career-btn career-btn-secondary" type="button" onClick={onOpenDocument}>
          <Plus aria-hidden="true" size={16} />Добавить документ
        </button>
      ) : <NewDocumentForm profile={profile} onProfileChange={onProfileChange} />}
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

function NewDocumentForm({ profile, onProfileChange, screen = false, onDone }: RelocationDraftProps & {
  readonly screen?: boolean;
  readonly onDone?: () => void;
}) {
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
    onDone?.();
  };
  const kindId = 'relocation-new-document-kind';
  const countryId = 'relocation-new-document-country';
  const expiresId = 'relocation-new-document-expires';
  return (
    <div className={screen ? 'career-relocation-document-screen' : 'career-relocation-add-form'}>
      {screen ? <h3>Документ</h3> : <h4>Добавить документ</h4>}
      <div className="career-relocation-form-grid">
        <RelocationFormField id={kindId} label="Тип документа"><DocumentKindSelect id={kindId} value={kind} onChange={setKind} /></RelocationFormField>
        <RelocationFormField id={countryId} label="Страна"><CountrySelect id={countryId} value={countryCode} onChange={setCountryCode} /></RelocationFormField>
        <RelocationFormField id={expiresId} label="Действует до"><input id={expiresId} type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></RelocationFormField>
      </div>
      <button className={`career-btn ${screen ? 'career-btn-primary' : 'career-btn-secondary'}`} type="button" disabled={!countryCode} onClick={add}>
        {screen ? 'Сохранить' : <><Plus aria-hidden="true" size={16} />Добавить документ</>}
      </button>
      {screen ? <button className="career-relocation-text-action" type="button" onClick={onDone}>Отмена</button> : null}
    </div>
  );
}

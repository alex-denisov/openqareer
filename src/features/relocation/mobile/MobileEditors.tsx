import { useState, type ReactNode } from 'react';
import { Fingerprint, GraduationCap, MapPin, Translate } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../../shared/relocationQuestionnaire';
import {
  DOCUMENT_KIND_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  LANGUAGE_LEVEL_OPTIONS,
  RECOGNITION_OPTIONS,
  relocationCountryName,
  relocationRowId,
} from '../RelocationFormControls';
import { MobilePush } from '../RelocationMobilePush';
import {
  MobileCountrySearch,
  MobileGroup,
  MobileInputRow,
  MobileNavRow,
  MobilePickerRow,
  MobilePrimary,
} from './MobileRows';

type Profile = RelocationQuestionnaire;
type RelocationDocument = Profile['citizenshipDocuments']['documents'][number];
type RelocationEducation = Profile['education']['education'][number];
type RelocationCertificate = Profile['education']['certificates'][number];
type RelocationLanguage = Profile['languages']['languages'][number];

export interface MobileEditorProps {
  readonly profile: Profile;
  readonly onProfileChange: (profile: Profile) => void;
  readonly onClose: () => void;
  /** Existing row id; a new row when absent. */
  readonly rowId?: string;
}

interface EditorScreenProps {
  readonly title: string;
  readonly sub: string;
  readonly canSave: boolean;
  readonly removeLabel?: string;
  readonly onSave: () => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** One record as a push screen: large title, a group of rows, one «Сохранить». */
function EditorScreen(props: EditorScreenProps) {
  return (
    <MobilePush title={props.title} onBack={props.onClose}>
      <div className="vacancy-push-hero">
        <h2>{props.title}</h2>
        <p>{props.sub}</p>
      </div>
      <MobileGroup>{props.children}</MobileGroup>
      <MobilePrimary label="Сохранить" disabled={!props.canSave} onClick={props.onSave} />
      {props.removeLabel ? (
        <button
          className="vacancy-push-text career-relocation-remove"
          type="button"
          onClick={props.onRemove}
        >
          {props.removeLabel}
        </button>
      ) : null}
    </MobilePush>
  );
}

/** Replaces, appends or removes one row of a list, then closes the screen. */
function rowWriter<T extends { readonly id: string }>(
  rows: readonly T[],
  existing: T | undefined,
  commit: (rows: T[]) => void,
) {
  return {
    save: (row: T) =>
      commit(
        existing ? rows.map((item) => (item.id === existing.id ? row : item)) : [...rows, row],
      ),
    remove: () => commit(rows.filter(({ id }) => id !== existing?.id)),
  };
}

function CountryRow({
  title,
  value,
  onClick,
}: {
  readonly title: string;
  readonly value: string;
  readonly onClick: () => void;
}) {
  const id = title === 'Страна' ? 'relocation-new-document-country' : undefined;
  return (
    <MobileNavRow
      id={id}
      icon={<MapPin aria-hidden="true" />}
      title={title}
      value={value ? relocationCountryName(value) : 'Выберите'}
      onClick={onClick}
    />
  );
}

/** Country chosen on its own search screen inside an editor. */
function useCountryPicker(initial: string) {
  const [countryCode, setCountryCode] = useState(initial);
  const [picking, setPicking] = useState(false);
  const search = picking ? (
    <MobileCountrySearch
      title="Страна"
      value={countryCode}
      onBack={() => setPicking(false)}
      onPick={(code) => {
        setCountryCode(code);
        setPicking(false);
      }}
    />
  ) : null;
  return { countryCode, open: () => setPicking(true), search };
}

function DocumentRows(props: {
  readonly kind: RelocationDocument['kind'];
  readonly setKind: (kind: RelocationDocument['kind']) => void;
  readonly country: ReturnType<typeof useCountryPicker>;
  readonly expiresAt: string;
  readonly setExpiresAt: (value: string) => void;
}) {
  const { kind, setKind, country, expiresAt, setExpiresAt } = props;
  return (
    <>
      <MobilePickerRow
        id="relocation-new-document-kind"
        icon={<Fingerprint aria-hidden="true" />}
        label="Тип документа"
        value={kind}
        options={DOCUMENT_KIND_OPTIONS}
        onChange={setKind}
      />
      <CountryRow title="Страна" value={country.countryCode} onClick={country.open} />
      <MobileInputRow
        id="relocation-new-document-expires"
        label="Действует до"
        type="date"
        value={expiresAt}
        onChange={setExpiresAt}
      />
    </>
  );
}

/** Mockup 15 `mv=doc`: type, country and expiry as a group of rows, one «Сохранить». */
export function MobileDocumentEditor({
  profile,
  onProfileChange,
  onClose,
  rowId,
}: MobileEditorProps) {
  const documents = profile.citizenshipDocuments.documents;
  const existing = documents.find(({ id }) => id === rowId);
  const [kind, setKind] = useState<RelocationDocument['kind']>(
    existing?.kind ?? 'residence_permit',
  );
  const [expiresAt, setExpiresAt] = useState(existing?.expiresAt ?? '');
  const country = useCountryPicker(existing?.countryCode ?? '');
  const writer = rowWriter(documents, existing, (next) => {
    onProfileChange({
      ...profile,
      citizenshipDocuments: { ...profile.citizenshipDocuments, documents: next },
    });
    onClose();
  });
  if (country.search) return country.search;
  const save = () => {
    const { expiresAt: _previous, ...base } = existing ?? { id: relocationRowId('document') };
    writer.save({
      ...base,
      kind,
      countryCode: country.countryCode,
      ...(expiresAt ? { expiresAt } : {}),
    });
  };
  return (
    <EditorScreen
      title="Документ"
      sub="Тип, страна и срок действия."
      canSave={Boolean(country.countryCode)}
      removeLabel={existing ? 'Удалить документ' : undefined}
      onSave={save}
      onRemove={writer.remove}
      onClose={onClose}
    >
      <DocumentRows
        kind={kind}
        setKind={setKind}
        country={country}
        expiresAt={expiresAt}
        setExpiresAt={setExpiresAt}
      />
    </EditorScreen>
  );
}

interface EducationDraft {
  readonly title: string;
  readonly level: RelocationEducation['level'];
  readonly fieldOfStudy: string;
  readonly recognitionStatus: RelocationEducation['recognitionStatus'];
  readonly startedAt: string;
  readonly completedAt: string;
}

function educationDraft(entry?: RelocationEducation): EducationDraft {
  return {
    title: entry?.title ?? '',
    level: entry?.level ?? 'bachelor',
    fieldOfStudy: entry?.fieldOfStudy ?? '',
    recognitionStatus: entry?.recognitionStatus ?? 'unknown',
    startedAt: entry?.startedAt ?? '',
    completedAt: entry?.completedAt ?? '',
  };
}

function educationFromDraft(
  id: string,
  countryCode: string,
  draft: EducationDraft,
): RelocationEducation {
  return {
    id,
    title: draft.title.trim(),
    level: draft.level,
    countryCode,
    recognitionStatus: draft.recognitionStatus,
    ...(draft.fieldOfStudy.trim() ? { fieldOfStudy: draft.fieldOfStudy.trim() } : {}),
    ...(draft.startedAt ? { startedAt: draft.startedAt } : {}),
    ...(draft.completedAt ? { completedAt: draft.completedAt } : {}),
  };
}

function EducationRows({
  draft,
  change,
}: {
  readonly draft: EducationDraft;
  readonly change: (patch: Partial<EducationDraft>) => void;
}) {
  const prefix = 'relocation-mobile-education';
  return (
    <>
      <MobileInputRow
        id={`${prefix}-title`}
        label="Учебное заведение"
        value={draft.title}
        onChange={(title) => change({ title })}
      />
      <MobileInputRow
        id={`${prefix}-field`}
        label="Направление"
        value={draft.fieldOfStudy}
        onChange={(fieldOfStudy) => change({ fieldOfStudy })}
      />
      <MobilePickerRow
        id={`${prefix}-level`}
        icon={<GraduationCap aria-hidden="true" />}
        label="Степень"
        value={draft.level}
        options={EDUCATION_LEVEL_OPTIONS}
        onChange={(level) => change({ level })}
      />
      <MobilePickerRow
        id={`${prefix}-recognition`}
        label="Признание за рубежом"
        value={draft.recognitionStatus}
        options={RECOGNITION_OPTIONS}
        onChange={(recognitionStatus) => change({ recognitionStatus })}
      />
    </>
  );
}

function EducationDateRows({
  draft,
  change,
}: {
  readonly draft: EducationDraft;
  readonly change: (patch: Partial<EducationDraft>) => void;
}) {
  const prefix = 'relocation-mobile-education';
  return (
    <>
      <MobileInputRow
        id={`${prefix}-started`}
        label="Начало"
        type="date"
        value={draft.startedAt}
        onChange={(startedAt) => change({ startedAt })}
      />
      <MobileInputRow
        id={`${prefix}-completed`}
        label="Окончание"
        type="date"
        value={draft.completedAt}
        onChange={(completedAt) => change({ completedAt })}
      />
    </>
  );
}

/** Mockup 15 `mv=i2`: one diploma as a push screen of rows. */
export function MobileEducationEditor({
  profile,
  onProfileChange,
  onClose,
  rowId,
}: MobileEditorProps) {
  const entries = profile.education.education;
  const existing = entries.find(({ id }) => id === rowId);
  const [draft, setDraft] = useState(() => educationDraft(existing));
  const country = useCountryPicker(existing?.countryCode ?? '');
  const writer = rowWriter(entries, existing, (next) => {
    onProfileChange({ ...profile, education: { ...profile.education, education: next } });
    onClose();
  });
  if (country.search) return country.search;
  const save = () =>
    writer.save(
      educationFromDraft(existing?.id ?? relocationRowId('education'), country.countryCode, draft),
    );
  return (
    <EditorScreen
      title="Образование"
      sub="Диплом, страна и признание за рубежом."
      canSave={Boolean(draft.title.trim() && country.countryCode)}
      removeLabel={existing ? 'Удалить образование' : undefined}
      onSave={save}
      onRemove={writer.remove}
      onClose={onClose}
    >
      <EducationRows
        draft={draft}
        change={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      />
      <EducationDateRows
        draft={draft}
        change={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      />
      <CountryRow title="Страна диплома" value={country.countryCode} onClick={country.open} />
    </EditorScreen>
  );
}

interface CertificateForm {
  readonly title: string;
  readonly issuer: string;
  readonly recognitionStatus: RelocationCertificate['recognitionStatus'];
}

function CertificateRows({
  form,
  change,
}: {
  readonly form: CertificateForm;
  readonly change: (patch: Partial<CertificateForm>) => void;
}) {
  return (
    <>
      <MobileInputRow
        id="relocation-mobile-certificate-title"
        label="Название"
        value={form.title}
        onChange={(title) => change({ title })}
      />
      <MobileInputRow
        id="relocation-mobile-certificate-issuer"
        label="Кто выдал"
        value={form.issuer}
        onChange={(issuer) => change({ issuer })}
      />
      <MobilePickerRow
        id="relocation-mobile-certificate-recognition"
        label="Признание"
        value={form.recognitionStatus}
        options={RECOGNITION_OPTIONS}
        onChange={(recognitionStatus) => change({ recognitionStatus })}
      />
    </>
  );
}

function certificateRow(
  existing: RelocationCertificate | undefined,
  form: CertificateForm,
  countryCode: string,
): RelocationCertificate {
  const { issuer: _previous, ...base } = existing ?? { id: relocationRowId('certificate') };
  const issuer = form.issuer.trim();
  return {
    ...base,
    title: form.title.trim(),
    countryCode,
    recognitionStatus: form.recognitionStatus,
    ...(issuer ? { issuer } : {}),
  };
}

/** A certificate or assessment: title, issuer, country and recognition. */
export function MobileCertificateEditor({
  profile,
  onProfileChange,
  onClose,
  rowId,
}: MobileEditorProps) {
  const certificates = profile.education.certificates;
  const existing = certificates.find(({ id }) => id === rowId);
  const [form, setForm] = useState<CertificateForm>({
    title: existing?.title ?? '',
    issuer: existing?.issuer ?? '',
    recognitionStatus: existing?.recognitionStatus ?? 'unknown',
  });
  const country = useCountryPicker(existing?.countryCode ?? '');
  const writer = rowWriter(certificates, existing, (next) => {
    onProfileChange({ ...profile, education: { ...profile.education, certificates: next } });
    onClose();
  });
  if (country.search) return country.search;
  return (
    <EditorScreen
      title="Сертификат"
      sub="Ассессмент или сертификат, который важен для визы."
      canSave={Boolean(form.title.trim() && country.countryCode)}
      removeLabel={existing ? 'Удалить сертификат' : undefined}
      onSave={() => writer.save(certificateRow(existing, form, country.countryCode))}
      onRemove={writer.remove}
      onClose={onClose}
    >
      <CertificateRows
        form={form}
        change={(patch) => setForm((current) => ({ ...current, ...patch }))}
      />
      <CountryRow title="Страна выдачи" value={country.countryCode} onClick={country.open} />
    </EditorScreen>
  );
}

function LanguageRows(props: {
  readonly name: string;
  readonly setName: (value: string) => void;
  readonly level: RelocationLanguage['level'];
  readonly setLevel: (value: RelocationLanguage['level']) => void;
}) {
  const { name, setName, level, setLevel } = props;
  return (
    <>
      <MobileInputRow
        id="relocation-mobile-language-name"
        label="Язык"
        value={name}
        onChange={setName}
      />
      <MobilePickerRow
        id="relocation-mobile-language-level"
        icon={<Translate aria-hidden="true" />}
        label="Уровень"
        value={level}
        options={LANGUAGE_LEVEL_OPTIONS}
        onChange={setLevel}
      />
    </>
  );
}

/** Mockup 15 `mv=i4`: one language and its level; an imported one is confirmed here. */
export function MobileLanguageEditor({
  profile,
  onProfileChange,
  onClose,
  rowId,
}: MobileEditorProps) {
  const languages = profile.languages.languages;
  const existing = languages.find(({ id }) => id === rowId);
  const [name, setName] = useState(existing?.name ?? '');
  const [level, setLevel] = useState<RelocationLanguage['level']>(existing?.level ?? 'unknown');
  const writer = rowWriter(languages, existing, (next) => {
    onProfileChange({ ...profile, languages: { languages: next } });
    onClose();
  });
  const save = () =>
    writer.save(
      existing
        ? { ...existing, name: name.trim(), level, confirmation: 'confirmed' }
        : {
            id: relocationRowId('language'),
            name: name.trim(),
            level,
            source: 'candidate',
            confirmation: 'confirmed',
          },
    );
  const sub =
    existing?.confirmation === 'proposed'
      ? 'Значение импортировано: проверьте и сохраните.'
      : 'Язык и уровень владения.';
  return (
    <EditorScreen
      title="Язык"
      sub={sub}
      canSave={Boolean(name.trim())}
      removeLabel={existing ? 'Удалить язык' : undefined}
      onSave={save}
      onRemove={writer.remove}
      onClose={onClose}
    >
      <LanguageRows name={name} setName={setName} level={level} setLevel={setLevel} />
    </EditorScreen>
  );
}

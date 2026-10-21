import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import type {
  RelocationQuestionnaire,
} from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries } from './relocationCountryData';

type RelocationDocument = RelocationQuestionnaire['citizenshipDocuments']['documents'][number];
type RelocationEducation = RelocationQuestionnaire['education']['education'][number];
type RelocationCertificate = RelocationQuestionnaire['education']['certificates'][number];

type LanguageLevel = RelocationQuestionnaire['languages']['languages'][number]['level'];

export const DOCUMENT_KIND_OPTIONS: readonly (readonly [RelocationDocument['kind'], string])[] = [
  ['residence_permit', 'ВНЖ'], ['work_permit', 'Разрешение на работу'], ['work_visa', 'Рабочая виза'],
  ['study_visa', 'Учебная виза'], ['visa', 'Виза'], ['other', 'Другой документ'],
];

export const EDUCATION_LEVEL_OPTIONS: readonly (readonly [RelocationEducation['level'], string])[] = [
  ['secondary', 'Среднее'], ['vocational', 'Среднее профессиональное'], ['bachelor', 'Бакалавриат'],
  ['master', 'Магистратура'], ['doctorate', 'Аспирантура'], ['other', 'Другое'],
];

export const RECOGNITION_OPTIONS: readonly (readonly [RelocationEducation['recognitionStatus'], string])[] = [
  ['unknown', 'Не проверялось'], ['not_started', 'Не начинал'], ['in_progress', 'В процессе'],
  ['recognized', 'Признано'], ['not_required', 'Не требуется'],
];

export const LANGUAGE_LEVEL_OPTIONS: readonly (readonly [LanguageLevel, string])[] = [
  ['unknown', 'Не указан'], ['A1', 'A1'], ['A2', 'A2'], ['B1', 'B1'], ['B2', 'B2'], ['C1', 'C1'], ['C2', 'C2'],
];

export function RelocationFormField({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="career-relocation-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Country picker of mockup 15 (`i1-dc`, `i2-e4`): a button with the chosen
 * country that opens a search over the rules catalog.
 */
export function CountrySelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  const needle = query.trim().toLocaleLowerCase('ru');
  const countries = listRelocationCountries().filter(({ name }) => !needle || name.toLocaleLowerCase('ru').includes(needle));
  const pick = (code: string) => { onChange(code); setOpen(false); setQuery(''); };
  return (
    <div className="career-relocation-country-picker">
      <button id={id} type="button" className="career-relocation-picker-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{value ? relocationCountryName(value) : 'Выберите страну'}</span>
        <CaretDown aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className="career-relocation-picker-panel">
          <input type="search" aria-label="Поиск: Страна" placeholder="Поиск: Страна" value={query} ref={searchRef} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} />
          <ul role="listbox" aria-label="Страны">
            {countries.map(({ countryCode, name }) => (
              <li key={countryCode} role="option" aria-selected={countryCode === value}>
                <button type="button" onClick={() => pick(countryCode)}>{name}</button>
              </li>
            ))}
            {countries.length ? null : <li role="presentation">Такой страны нет в каталоге правил.</li>}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function DocumentKindSelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: RelocationDocument['kind'];
  readonly onChange: (value: RelocationDocument['kind']) => void;
}) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as RelocationDocument['kind'])}>{DOCUMENT_KIND_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>;
}

export function EducationLevelSelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: RelocationEducation['level'];
  readonly onChange: (value: RelocationEducation['level']) => void;
}) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as RelocationEducation['level'])}>{EDUCATION_LEVEL_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>;
}

export function RecognitionSelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: RelocationEducation['recognitionStatus'] | RelocationCertificate['recognitionStatus'];
  readonly onChange: (value: RelocationEducation['recognitionStatus']) => void;
}) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as RelocationEducation['recognitionStatus'])}>{RECOGNITION_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>;
}

export function LanguageLevelSelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: RelocationQuestionnaire['languages']['languages'][number]['level'];
  readonly onChange: (value: RelocationQuestionnaire['languages']['languages'][number]['level']) => void;
}) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as LanguageLevel)}>{LANGUAGE_LEVEL_OPTIONS.map(([level, label]) => <option key={level} value={level}>{label}</option>)}</select>;
}

export function relocationRowId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function relocationCountryName(code: string): string {
  return listRelocationCountries().find((country) => country.countryCode === code)?.name ?? 'Страна не определена';
}

export function relocationDocumentKindLabel(kind: RelocationDocument['kind']): string {
  const labels: Readonly<Record<RelocationDocument['kind'], string>> = {
    residence_permit: 'Вид на жительство', work_permit: 'Разрешение на работу', work_visa: 'Рабочая виза',
    study_visa: 'Учебная виза', visa: 'Виза', other: 'Документ',
  };
  return labels[kind];
}

export function relocationRecognitionLabel(status: RelocationEducation['recognitionStatus']): string {
  const labels: Readonly<Record<RelocationEducation['recognitionStatus'], string>> = {
    recognized: 'признано', in_progress: 'признание в процессе', not_started: 'не подавалось на признание',
    not_required: 'признание не требуется', unknown: 'не проверено',
  };
  return labels[status];
}

import type { ReactNode } from 'react';
import type {
  RelocationQuestionnaire,
} from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries } from './relocationCountryData';

type RelocationDocument = RelocationQuestionnaire['citizenshipDocuments']['documents'][number];
type RelocationEducation = RelocationQuestionnaire['education']['education'][number];
type RelocationCertificate = RelocationQuestionnaire['education']['certificates'][number];

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

export function CountrySelect({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Выберите страну</option>
      {listRelocationCountries().map(({ countryCode, name }) => (
        <option key={countryCode} value={countryCode}>{name}</option>
      ))}
    </select>
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
  const options: readonly { readonly value: RelocationDocument['kind']; readonly label: string }[] = [
    { value: 'residence_permit', label: 'ВНЖ' },
    { value: 'work_permit', label: 'Разрешение на работу' },
    { value: 'work_visa', label: 'Рабочая виза' },
    { value: 'study_visa', label: 'Учебная виза' },
    { value: 'visa', label: 'Виза' },
    { value: 'other', label: 'Другой документ' },
  ];
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as RelocationDocument['kind'])}>{options.map(({ value: code, label }) => <option key={code} value={code}>{label}</option>)}</select>;
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
  const options: readonly [RelocationEducation['level'], string][] = [
    ['secondary', 'Среднее'], ['vocational', 'Среднее профессиональное'], ['bachelor', 'Бакалавриат'],
    ['master', 'Магистратура'], ['doctorate', 'Аспирантура'], ['other', 'Другое'],
  ];
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as RelocationEducation['level'])}>{options.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>;
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
  const options: readonly [RelocationEducation['recognitionStatus'], string][] = [
    ['unknown', 'Не проверялось'], ['not_started', 'Не начинал'], ['in_progress', 'В процессе'],
    ['recognized', 'Признано'], ['not_required', 'Не требуется'],
  ];
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as RelocationEducation['recognitionStatus'])}>{options.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>;
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
  const options: readonly RelocationQuestionnaire['languages']['languages'][number]['level'][] = [
    'unknown', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2',
  ];
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as RelocationQuestionnaire['languages']['languages'][number]['level'])}>{options.map((level) => <option key={level} value={level}>{level === 'unknown' ? 'Не указан' : level}</option>)}</select>;
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

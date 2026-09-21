import { Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import type { ResumeUnknown } from './resumeTypes';

/** Provenance is never optional: a claim without its memory id is unverifiable. */
/**
 * A candidate reading their own resume should see *where* a claim came from,
 * not the dossier's internal key. The raw id stays in the tooltip so support
 * and the engine can still trace it (B148 §7).
 */
export function EvidenceChip({ memoryId }: { memoryId: string }) {
  return (
    <span className="career-resume-evidence" title={`Факт: ${memoryId}`}>
      Источник: {evidenceOriginLabel(memoryId)}
    </span>
  );
}

function evidenceOriginLabel(memoryId: string): string {
  if (/^imp[A-Za-z0-9]*-/u.test(memoryId)) return 'импортированное резюме';
  return 'разговор с консультантом';
}

export function EntryUnknowns({ unknowns }: { unknowns: readonly ResumeUnknown[] }) {
  if (unknowns.length === 0) return null;
  return (
    <ul className="career-resume-inline-unknowns">
      {unknowns.map((item) => (
        <li
          key={`${item.code}-${item.entryId ?? ''}-${item.memoryId ?? ''}`}
          className={item.blocking ? 'is-blocking' : ''}
        >
          <WarningCircle size={14} weight="fill" />
          <span>{item.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Offers only evidence the engine accepts. When nothing is left it says why,
 * because an empty select with no explanation reads as a broken interface.
 */
export function EvidencePicker({
  label,
  options,
  onPick,
}: {
  label: string;
  options: readonly CandidateMemory[];
  onPick: (memoryId: string) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="career-resume-empty">
        Свободных подтверждённых фактов нет. Подтвердите факт в разговоре с экспертом — резюме берёт
        только их.
      </p>
    );
  }
  return (
    <label className="career-resume-picker">
      <span>{label}</span>
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value);
        }}
      >
        <option value="">Выберите факт…</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.statement.slice(0, 90)}
          </option>
        ))}
      </select>
      <Plus size={15} aria-hidden />
    </label>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="career-resume-remove" onClick={onClick}>
      <Trash size={14} />
      {label}
    </button>
  );
}

export function Field({
  label,
  value,
  placeholder,
  onChange,
  readOnly = false,
  disabled = false,
  large = false,
  mono = false,
  type = 'text',
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  large?: boolean;
  mono?: boolean;
  type?: string;
}) {
  return (
    <label className={`career-resume-field ${large ? 'is-large' : ''} ${mono ? 'is-mono' : ''}`}>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  placeholder,
  onChange,
  readOnly = false,
  disabled = false,
  rows = 4,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  rows?: number;
}) {
  return (
    <label className="career-resume-field is-textarea">
      <span>{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

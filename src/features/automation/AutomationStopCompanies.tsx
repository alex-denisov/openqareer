import { Plus, X } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import type { CandidateAutomationStopCompany } from '../../../server/candidate/sqliteCandidateAutomationRepository';

export interface AutomationStopCompaniesProps {
  readonly companies: readonly CandidateAutomationStopCompany[];
  readonly busy: boolean;
  readonly onAdd: (company: string) => Promise<void>;
  readonly onRemove: (company: string) => Promise<void>;
}

type Mode = 'manage' | 'add' | null;

function countLabel(companies: readonly CandidateAutomationStopCompany[]): string {
  const rejected = companies.filter((item) => item.origin === 'rejection').length;
  return `Вручную ${companies.length - rejected}, из отказов ${rejected}`;
}

export function AutomationStopCompanies(props: AutomationStopCompaniesProps) {
  const [mode, setMode] = useState<Mode>(null);
  const toggle = (next: Exclude<Mode, null>) =>
    setMode((current) => (current === next ? null : next));
  return (
    <div className="automation-rule-row">
      <dt>
        <strong>Стоп-компании</strong>
        <small>{countLabel(props.companies)}</small>
      </dt>
      <dd>
        <span className="automation-rule-value">{props.companies.length} компаний</span>
        {mode === 'manage' ? <StopList {...props} /> : null}
        {mode === 'add' ? <StopAddForm busy={props.busy} onAdd={props.onAdd} /> : null}
      </dd>
      <div className="automation-rule-row__action">
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          aria-expanded={mode === 'manage'}
          onClick={() => toggle('manage')}
        >
          Управлять
        </button>
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          aria-expanded={mode === 'add'}
          onClick={() => toggle('add')}
        >
          <Plus size={16} aria-hidden="true" />
          Добавить
        </button>
      </div>
    </div>
  );
}

function StopList({ companies, busy, onRemove }: AutomationStopCompaniesProps) {
  if (!companies.length) return <p className="automation-empty">Стоп-компаний пока нет.</p>;
  return (
    <ul className="automation-stop-list">
      {companies.map((item) => (
        <li key={item.company}>
          <span>
            {item.company}
            <small>{item.origin === 'rejection' ? 'Добавлена из отказа' : 'Добавлена вами'}</small>
          </span>
          <button
            type="button"
            className="automation-icon-button"
            aria-label={`Убрать ${item.company} из стоп-компаний`}
            disabled={busy}
            onClick={() => void onRemove(item.company)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function StopAddForm({
  busy,
  onAdd,
}: {
  readonly busy: boolean;
  readonly onAdd: (company: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const company = value.trim();
    if (!company) return;
    await onAdd(company);
    setValue('');
  }
  return (
    <form className="automation-add-stop" onSubmit={(event) => void submit(event)}>
      <label htmlFor="automation-stop-company">Компания</label>
      <input
        id="automation-stop-company"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        maxLength={300}
      />
      <button className="career-btn" type="submit" disabled={busy || !value.trim()}>
        Добавить в список
      </button>
    </form>
  );
}

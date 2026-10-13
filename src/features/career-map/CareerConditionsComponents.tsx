import { useState, type ReactElement } from 'react';
import {
  Buildings,
  Check,
  Coins,
  Globe,
  HouseLine,
  MapPin,
  Plus,
  Prohibit,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { SearchConditionsDraft } from './careerScreenTypes';

export type EditableConditionField = 'geo' | 'sal' | 'fmt' | 'stop' | null;

function SalaryActionButtons({
  onSave,
  onCancel,
}: {
  onSave: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <>
      <button
        type="button"
        className="career-btn career-btn-primary"
        style={{ minHeight: '44px', minWidth: '44px' }}
        aria-label="Сохранить"
        onClick={onSave}
      >
        <Check size={18} />
      </button>
      <button
        type="button"
        className="career-btn career-btn-ghost"
        style={{ minHeight: '44px', minWidth: '44px' }}
        aria-label="Отменить"
        onClick={onCancel}
      >
        <X size={18} />
      </button>
    </>
  );
}

export function CareerInlineSalaryEditor({
  initialSalary,
  initialShowWithoutSalary,
  onSave,
  onCancel,
  errorMessage,
}: {
  initialSalary: number;
  initialShowWithoutSalary: boolean;
  onSave: (salary: number, showWithoutSalary: boolean) => void;
  onCancel: () => void;
  errorMessage?: string | null;
}): ReactElement {
  const [val, setVal] = useState(initialSalary.toString());
  const [showNoWage, setShowNoWage] = useState(initialShowWithoutSalary);

  const handleSave = () => {
    const num = parseInt(val.replace(/\s+/g, ''), 10) || initialSalary;
    onSave(num, showNoWage);
  };

  return (
    <div className="career-inline-edit" aria-label="Редактирование зарплаты">
      <label className="career-section-subhead" htmlFor="salary-input">
        Зарплата от, ₽ в месяц
      </label>
      <div className="career-inline-row">
        <input
          id="salary-input"
          className="career-inline-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <SalaryActionButtons onSave={handleSave} onCancel={onCancel} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showNoWage}
          onChange={(e) => setShowNoWage(e.target.checked)}
        />
        <span style={{ fontSize: 'var(--career-text-xs)' }}>Показывать вакансии без зарплаты</span>
      </label>
      {errorMessage ? (
        <div className="career-note career-note-error" role="alert">
          <WarningCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      ) : null}
    </div>
  );
}

function StopListItemsList({
  items,
}: {
  items: SearchConditionsDraft['stopList'];
}): ReactElement {
  return (
    <ul className="career-check-list">
      {items.map((c) => (
        <li key={c.id} className="career-check-item">
          <Buildings size={16} />
          <span>
            {c.name} ({c.origin})
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CareerInlineStopListEditor({
  stopList,
  onAddCompany,
  onClose,
}: {
  stopList: SearchConditionsDraft['stopList'];
  onAddCompany: (name: string) => void;
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState('');

  const handleAdd = () => {
    if (name.trim()) {
      onAddCompany(name.trim());
      setName('');
    }
  };

  return (
    <div className="career-inline-edit" aria-label="Редактирование стоп-листа">
      <h4 className="career-section-subhead">Стоп-лист компаний</h4>
      <StopListItemsList items={stopList} />
      <div className="career-inline-row">
        <input
          className="career-inline-input"
          placeholder="Название компании"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="career-btn career-btn-secondary"
          disabled={!name.trim()}
          onClick={handleAdd}
        >
          <Plus size={16} />
          Добавить компанию
        </button>
        <button type="button" className="career-btn career-btn-ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

export function CareerInlineFormatEditor({
  initialFormat,
  onSave,
  onCancel,
  errorMessage,
}: {
  initialFormat: SearchConditionsDraft['format'];
  onSave: (format: SearchConditionsDraft['format']) => void;
  onCancel: () => void;
  errorMessage?: string | null;
}): ReactElement {
  const [office, setOffice] = useState(initialFormat.office);
  const [hybrid, setHybrid] = useState(initialFormat.hybrid);
  const [remote, setRemote] = useState(initialFormat.remote);

  const handleSave = () => {
    onSave({ office, hybrid, remote });
  };

  return (
    <div className="career-inline-edit" aria-label="Редактирование формата">
      <h4 className="career-section-subhead">Формат работы</h4>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', margin: '8px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={office} onChange={(e) => setOffice(e.target.checked)} />
          <span style={{ fontSize: 'var(--career-text-xs)' }}>Офис</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={hybrid} onChange={(e) => setHybrid(e.target.checked)} />
          <span style={{ fontSize: 'var(--career-text-xs)' }}>Гибрид</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          <span style={{ fontSize: 'var(--career-text-xs)' }}>Удалённо</span>
        </label>
      </div>
      <div className="career-inline-row">
        <SalaryActionButtons onSave={handleSave} onCancel={onCancel} />
      </div>
      {errorMessage ? (
        <div className="career-note career-note-error" role="alert">
          <WarningCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      ) : null}
    </div>
  );
}

export function CareerInlineGeoEditor({
  initialSelected,
  onSave,
  onCancel,
  errorMessage,
}: {
  initialSelected: readonly string[];
  onSave: (selected: readonly string[]) => void;
  onCancel: () => void;
  errorMessage?: string | null;
}): ReactElement {
  const [val, setVal] = useState(initialSelected.join(', '));

  const handleSave = () => {
    const list = val.split(',').map((s) => s.trim()).filter(Boolean);
    onSave(list.length ? list : initialSelected);
  };

  return (
    <div className="career-inline-edit" aria-label="Редактирование географии">
      <label className="career-section-subhead" htmlFor="geo-input">
        Города и регионы поиска
      </label>
      <div className="career-inline-row">
        <input
          id="geo-input"
          className="career-inline-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Например: Москва, Удалённо из РФ"
        />
        <SalaryActionButtons onSave={handleSave} onCancel={onCancel} />
      </div>
      {errorMessage ? (
        <div className="career-note career-note-error" role="alert">
          <WarningCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      ) : null}
    </div>
  );
}

function ConditionsChipList({
  conditions,
  formatStr,
  onEditField,
}: {
  conditions: SearchConditionsDraft;
  formatStr: string;
  onEditField: (field: EditableConditionField) => void;
}): ReactElement {
  const salaryStr = conditions.salaryFrom.amountRubles
    .toLocaleString('ru-RU')
    .replace(/\u00A0/g, ' ');

  return (
    <div className="career-conditions-chips">
      <button type="button" className="career-cond-chip" onClick={() => onEditField('geo')}>
        <MapPin size={16} />
        <span className="career-cond-label">География:</span>
        <span className="career-cond-val">{conditions.geography.selected.join(', ')}</span>
      </button>
      <button type="button" className="career-cond-chip" onClick={() => onEditField('sal')}>
        <Coins size={16} />
        <span className="career-cond-label">Зарплата от:</span>
        <span className="career-cond-val">{salaryStr} ₽</span>
      </button>
      <button type="button" className="career-cond-chip" onClick={() => onEditField('fmt')}>
        <HouseLine size={16} />
        <span className="career-cond-label">Формат:</span>
        <span className="career-cond-val">{formatStr}</span>
      </button>
      <button type="button" className="career-cond-chip" onClick={() => onEditField('stop')}>
        <Prohibit size={16} />
        <span className="career-cond-label">Стоп-лист:</span>
        <span className="career-cond-val">{conditions.stopList.length} компании</span>
      </button>
    </div>
  );
}

function RelocationBox({
  isRelocationEnabled,
  onEnableRelocation,
}: {
  isRelocationEnabled: boolean;
  onEnableRelocation?: () => void;
}): ReactElement {
  return (
    <div className="career-relocation-box">
      <div className="career-relocation-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Globe size={18} />
          <span style={{ fontWeight: 500 }}>Страны и релокация</span>
          <span className="career-badge">{isRelocationEnabled ? 'Включено' : 'Не включено'}</span>
        </div>
        {!isRelocationEnabled ? (
          <button
            type="button"
            className="career-btn career-btn-secondary"
            style={{ minHeight: '36px', padding: '4px 12px' }}
            onClick={onEnableRelocation}
          >
            Включить релокацию
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CareerConditionsCard({
  conditions,
  onEditField,
  onEnableRelocation,
}: {
  conditions: SearchConditionsDraft;
  onEditField: (field: EditableConditionField) => void;
  onEnableRelocation?: () => void;
}): ReactElement {
  const formatStr = [
    conditions.format.office ? 'Офис' : null,
    conditions.format.hybrid ? 'Гибрид' : null,
    conditions.format.remote ? 'удалённо' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="career-card" aria-labelledby="cond-h">
      <div className="career-card-head">
        <div className="career-card-title-group">
          <h2 id="cond-h">Условия поиска</h2>
        </div>
      </div>
      <ConditionsChipList conditions={conditions} formatStr={formatStr} onEditField={onEditField} />
      <p className="career-role-meta">
        С этими условиями: {conditions.matchingStats.matched} вакансий из{' '}
        {conditions.matchingStats.total} по ролям, {conditions.matchingStats.asOf}.
      </p>
      <RelocationBox
        isRelocationEnabled={conditions.geography.isRelocationEnabled}
        onEnableRelocation={onEnableRelocation}
      />
    </section>
  );
}

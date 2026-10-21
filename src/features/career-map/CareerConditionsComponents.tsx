import { useState, type ReactElement } from 'react';
import {
  Buildings,
  CaretDown,
  Check,
  Circle,
  Clock,
  FunnelSimple,
  Globe,
  Info,
  PencilSimple,
  Plus,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { RolesMarketSummary, SearchConditionsDraft } from './careerScreenTypes';
import {
  formatCompaniesCount,
  formatConditionsFormat,
  formatSalaryFloor,
} from './careerConditionsStorage';

function EditorError({ message }: { message?: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <div className="career-note career-note-error" role="alert">
      <WarningCircle size={16} aria-hidden />
      <span>{message}</span>
    </div>
  );
}

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
        className="career-btn career-btn-primary career-btn-icon"
        aria-label="Сохранить"
        onClick={onSave}
      >
        <Check size={18} />
      </button>
      <button
        type="button"
        className="career-btn career-btn-ghost career-btn-icon"
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
  initialSalary: number | null;
  initialShowWithoutSalary: boolean;
  onSave: (salary: number | null, showWithoutSalary: boolean) => void;
  onCancel: () => void;
  errorMessage?: string | null;
}): ReactElement {
  const [val, setVal] = useState(initialSalary === null ? '' : initialSalary.toString());
  const [showNoWage, setShowNoWage] = useState(initialShowWithoutSalary);

  const handleSave = () => {
    const digits = val.replace(/\D+/g, '');
    onSave(digits ? Number(digits) : null, showNoWage);
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
          inputMode="numeric"
          placeholder="Не указано"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <SalaryActionButtons onSave={handleSave} onCancel={onCancel} />
      </div>
      <label className="career-checkbox-label">
        <input
          type="checkbox"
          checked={showNoWage}
          onChange={(e) => setShowNoWage(e.target.checked)}
        />
        <span className="career-checkbox-text">Показывать вакансии без зарплаты</span>
      </label>
      <EditorError message={errorMessage} />
    </div>
  );
}

function StopListItemsList({ items }: { items: SearchConditionsDraft['stopList'] }): ReactElement {
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
      <div className="career-format-options">
        <label className="career-format-option">
          <input type="checkbox" checked={office} onChange={(e) => setOffice(e.target.checked)} />
          <span className="career-checkbox-text">Офис</span>
        </label>
        <label className="career-format-option">
          <input type="checkbox" checked={hybrid} onChange={(e) => setHybrid(e.target.checked)} />
          <span className="career-checkbox-text">Гибрид</span>
        </label>
        <label className="career-format-option">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          <span className="career-checkbox-text">Удалённо</span>
        </label>
      </div>
      <div className="career-inline-row">
        <SalaryActionButtons onSave={handleSave} onCancel={onCancel} />
      </div>
      <EditorError message={errorMessage} />
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
    const list = val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    onSave(list);
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
      <EditorError message={errorMessage} />
    </div>
  );
}

/** «Пояснение» ⓘ у шапки секции: короткий текст раскрывается под шапкой. */
export function SectionInfoToggle({ id, text }: { id: string; text: string }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="career-btn career-btn-icon career-btn-ghost"
        aria-label="Пояснение"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={18} aria-hidden />
      </button>
      {open ? (
        <p id={id} className="career-section-explain">
          {text}
        </p>
      ) : null}
    </>
  );
}

export interface ConditionRow {
  readonly field: Exclude<EditableConditionField, null>;
  readonly label: string;
  readonly value: string | null;
}

export function conditionRows(conditions: SearchConditionsDraft): readonly ConditionRow[] {
  const geo = conditions.geography.selected;
  return [
    { field: 'geo', label: 'География', value: geo.length > 0 ? geo.join(', ') : null },
    {
      field: 'sal',
      label: 'Зарплата от',
      value: formatSalaryFloor(conditions.salaryFrom.amountRubles),
    },
    { field: 'fmt', label: 'Формат', value: formatConditionsFormat(conditions.format) },
    {
      field: 'stop',
      label: 'Стоп-лист',
      value:
        conditions.stopList.length > 0 ? formatCompaniesCount(conditions.stopList.length) : null,
    },
  ];
}

function ConditionsChipList({
  conditions,
  onEditField,
}: {
  conditions: SearchConditionsDraft;
  onEditField: (field: EditableConditionField) => void;
}): ReactElement {
  return (
    <div className="career-conditions-chips">
      {conditionRows(conditions).map((row) => (
        <button
          key={row.field}
          type="button"
          className="career-cond-chip"
          aria-label={`Изменить: ${row.label}`}
          onClick={() => onEditField(row.field)}
        >
          <span className="career-cond-label">{row.label}</span>
          <span className={row.value ? 'career-cond-val' : 'career-cond-val career-cond-empty'}>
            {row.value ?? 'не указано · Указать'}
          </span>
          <PencilSimple size={14} aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** Сводка вакансий по ролям: число и дата из данных ролей, «N из M» — только когда посчитано. */
export function ConditionsMarketLine({ summary }: { summary: RolesMarketSummary }): ReactElement {
  return (
    <p className="career-role-meta career-meta-icon">
      <FunnelSimple size={16} aria-hidden />
      <span>
        {summary.vacancyTotal > 0
          ? `Вакансий по ролям: ${summary.vacancyTotal}${summary.asOf ? `, срез ${summary.asOf}` : ''}. Сколько из них проходит эти условия, ещё не посчитано.`
          : 'Число вакансий с этими условиями ещё не посчитано.'}
      </span>
    </p>
  );
}

export function RelocationRow({
  isRelocationEnabled,
  onOpenRelocation,
}: {
  isRelocationEnabled: boolean;
  onOpenRelocation: () => void;
}): ReactElement {
  return (
    <details className="career-relocation-box">
      <summary className="career-relocation-head">
        <span className="career-relocation-title-group">
          <Globe size={18} aria-hidden />
          <span className="career-relocation-title">Страны и релокация</span>
        </span>
        <span className="career-badge career-badge-muted">
          <Circle size={12} aria-hidden />
          {isRelocationEnabled ? 'Включено' : 'Не включено'}
        </span>
        <CaretDown size={18} className="career-role-caret" aria-hidden />
      </summary>
      <div className="career-relocation-body">
        <p className="career-role-meta">
          {isRelocationEnabled
            ? 'Подборка учитывает страны из раздела «Страны и релокация».'
            : 'Сейчас подборка идёт только по России. Включение — через анкету и согласие на экране «Страны и релокация».'}
        </p>
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={onOpenRelocation}
        >
          Открыть «Страны и релокация»
        </button>
      </div>
    </details>
  );
}

export function CareerConditionsCard({
  conditions,
  summary,
  onEditField,
  onOpenRelocation,
  editor,
}: {
  conditions: SearchConditionsDraft;
  summary: RolesMarketSummary;
  onEditField: (field: EditableConditionField) => void;
  onOpenRelocation: () => void;
  editor?: ReactElement | null;
}): ReactElement {
  return (
    <section className="career-card" aria-labelledby="cond-h">
      <div className="career-card-head">
        <h2 id="cond-h">Условия и география</h2>
        <SectionInfoToggle
          id="cond-explain"
          text="Условия фильтруют подборку по всем ролям. Пустое условие поиск не ограничивает. Каждое значение правится отдельно."
        />
      </div>
      <ConditionsChipList conditions={conditions} onEditField={onEditField} />
      {editor}
      <ConditionsMarketLine summary={summary} />
      <RelocationRow
        isRelocationEnabled={conditions.geography.isRelocationEnabled}
        onOpenRelocation={onOpenRelocation}
      />
    </section>
  );
}

export function MarketSourceStamp({
  summary,
}: {
  summary: RolesMarketSummary;
}): ReactElement | null {
  if (summary.vacancyTotal === 0) return null;
  const sources = ['каталог openqareer', ...summary.sources];
  const named =
    sources.length > 1 ? `${sources.slice(0, -1).join(', ')} и ${sources.at(-1)}` : sources[0];
  return (
    <p className="career-source-stamp career-meta-icon">
      <Clock size={14} aria-hidden />
      <span>
        Источник: {named} · {summary.vacancyTotal} вакансий
        {summary.asOf ? ` · ${summary.asOf}` : ''}
      </span>
    </p>
  );
}

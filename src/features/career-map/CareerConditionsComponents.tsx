import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  Buildings,
  CaretDown,
  Check,
  CheckCircle,
  Circle,
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
import { useEscapeLayer } from '../shell/escapeLayers';
import { useGeoDirectory } from '../geo/useGeoDirectory';
import { CareerGeoCombobox, normalizeGeoSelection } from './CareerGeoCombobox';

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

/**
 * Enter сохраняет правку условия, как галочка; Escape отменяет её. Редактор
 * регистрируется верхним слоем Escape, чтобы клавиша не свернула консультанта.
 */
function useEditorKeys(onSubmit: () => void, onCancel: () => void) {
  useEscapeLayer(onCancel);
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit();
  };
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
  const onKeyDown = useEditorKeys(handleSave, onCancel);

  return (
    <div className="career-inline-edit" aria-label="Редактирование зарплаты">
      <label className="career-section-subhead" htmlFor="salary-input">
        Зарплата от, ₽ в месяц
      </label>
      <div className="career-inline-row">
        <input
          onKeyDown={onKeyDown}
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
          onKeyDown={onKeyDown}
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
  const onKeyDown = useEditorKeys(handleAdd, onClose);

  return (
    <div className="career-inline-edit" aria-label="Редактирование стоп-листа">
      <h4 className="career-section-subhead">Стоп-лист компаний</h4>
      <StopListItemsList items={stopList} />
      <div className="career-inline-row">
        <input
          onKeyDown={onKeyDown}
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
  const onKeyDown = useEditorKeys(handleSave, onCancel);
  const formatOptions = [
    ['Офис', office, setOffice],
    ['Гибрид', hybrid, setHybrid],
    ['Удалённо', remote, setRemote],
  ] as const;

  return (
    <div className="career-inline-edit" aria-label="Редактирование формата">
      <h4 className="career-section-subhead">Формат работы</h4>
      <div className="career-format-options">
        {formatOptions.map(([label, checked, setChecked]) => (
          <label key={label} className="career-format-option">
            <input
              onKeyDown={onKeyDown}
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span className="career-checkbox-text">{label}</span>
          </label>
        ))}
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
  const { ready } = useGeoDirectory();
  const [selected, setSelected] = useState<readonly string[]>(() =>
    normalizeGeoSelection(initialSelected),
  );
  // Справочник на клиенте приходит чанком: старые значения сводятся к нему после загрузки.
  useEffect(() => {
    if (ready) setSelected((current) => normalizeGeoSelection(current));
  }, [ready]);
  const handleSave = () => onSave(selected);
  useEscapeLayer(onCancel);

  return (
    <div className="career-inline-edit" aria-label="Редактирование географии">
      <label className="career-section-subhead" htmlFor="geo-input">
        Города и регионы поиска
      </label>
      <div className="career-inline-row">
        <CareerGeoCombobox
          inputId="geo-input"
          selected={selected}
          onChange={setSelected}
          onSubmit={handleSave}
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
        className="career-btn is-sm is-icon is-ghost"
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
  /** null — согласие ещё не прочитано: статус не показываем. */
  isRelocationEnabled: boolean | null;
  onOpenRelocation: () => void;
}): ReactElement {
  return (
    <details className="career-relocation-box">
      <summary className="career-relocation-head">
        <span className="career-relocation-title-group">
          <Globe size={18} aria-hidden />
          <span className="career-relocation-title">Страны и релокация</span>
        </span>
        {isRelocationEnabled === null ? null : (
          <span
            className={`career-badge ${isRelocationEnabled ? 'career-badge-ok' : 'career-badge-muted'}`}
          >
            {isRelocationEnabled ? (
              <CheckCircle size={12} aria-hidden />
            ) : (
              <Circle size={12} aria-hidden />
            )}
            {isRelocationEnabled ? 'Включено' : 'Не включено'}
          </span>
        )}
        <CaretDown size={18} className="career-role-caret" aria-hidden />
      </summary>
      <div className="career-relocation-body">
        <p className="career-role-meta">
          {isRelocationEnabled === null
            ? 'Проверяем, включён ли раздел «Страны и релокация».'
            : isRelocationEnabled
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
  relocationEnabled = conditions.geography.isRelocationEnabled,
  editor,
}: {
  conditions: SearchConditionsDraft;
  summary: RolesMarketSummary;
  onEditField: (field: EditableConditionField) => void;
  onOpenRelocation: () => void;
  /** Согласие анкеты релокации — то же состояние, что в самом разделе (B445-r1); null — ещё не прочитано. */
  relocationEnabled?: boolean | null;
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
      <RelocationRow isRelocationEnabled={relocationEnabled} onOpenRelocation={onOpenRelocation} />
    </section>
  );
}

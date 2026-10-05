import { useState, useRef, type FormEvent } from 'react';
import { X } from '@phosphor-icons/react';
import type { ApplicationOfferTerms, ApplicationView } from './applicationsApi';
import { calculateOfferCompensation } from './offerCompensation';
import { useEscapeLayer } from '../shell/escapeLayers';

export interface OfferEditModalProps {
  readonly application: ApplicationView;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (
    applicationId: string,
    terms: ApplicationOfferTerms,
    respondBy: string | null,
  ) => Promise<void>;
}

function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat('ru-RU').format(amount);
  const symbol = currency === 'RUB' ? '₽' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency;
  return `${formatted} ${symbol}`;
}

function useOfferEditFormState(application: ApplicationView) {
  const initialTerms = application.offer?.terms;
  const [baseSalary, setBaseSalary] = useState(
    initialTerms?.baseSalary !== undefined ? String(initialTerms.baseSalary) : '',
  );
  const [salaryPeriod, setSalaryPeriod] = useState<'month' | 'year'>(
    initialTerms?.salaryPeriod ?? 'month',
  );
  const [currency, setCurrency] = useState(initialTerms?.currency ?? 'RUB');
  const [bonus, setBonus] = useState(
    initialTerms?.bonus !== undefined ? String(initialTerms.bonus) : '',
  );
  const [format, setFormat] = useState(initialTerms?.format ?? 'remote');
  const [probationMonths, setProbationMonths] = useState(
    initialTerms?.probationPeriodMonths !== undefined ? String(initialTerms.probationPeriodMonths) : '',
  );
  const [probationSalary, setProbationSalary] = useState(
    initialTerms?.probationSalary !== undefined ? String(initialTerms.probationSalary) : '',
  );
  const [benefits, setBenefits] = useState(
    initialTerms?.benefits ? initialTerms.benefits.join(', ') : '',
  );
  const [risks, setRisks] = useState(
    initialTerms?.risks ? initialTerms.risks.join(', ') : '',
  );
  const [respondBy, setRespondBy] = useState(
    application.offer?.respondBy ? application.offer.respondBy.slice(0, 10) : '',
  );
  const [sourceNote, setSourceNote] = useState(
    initialTerms?.sourceNote ?? 'со слов кандидата',
  );

  return {
    baseSalary, setBaseSalary,
    salaryPeriod, setSalaryPeriod,
    currency, setCurrency,
    bonus, setBonus,
    format, setFormat,
    probationMonths, setProbationMonths,
    probationSalary, setProbationSalary,
    benefits, setBenefits,
    risks, setRisks,
    respondBy, setRespondBy,
    sourceNote, setSourceNote,
  };
}

interface FormState extends ReturnType<typeof useOfferEditFormState> {
  readonly saving: boolean;
  readonly error: string | null;
  readonly handleSubmit: (e: FormEvent) => Promise<void>;
  readonly currentCompensation: ReturnType<typeof calculateOfferCompensation>;
}

function buildOfferTerms(
  fields: ReturnType<typeof useOfferEditFormState>,
  numBase: number,
  numBonus: number,
  numProbMonths: number,
  numProbSal: number | undefined,
): ApplicationOfferTerms {
  return {
    baseSalary: numBase,
    salaryPeriod: fields.salaryPeriod,
    currency: fields.currency,
    bonus: numBonus,
    format: fields.format,
    probationPeriodMonths: numProbMonths,
    probationSalary: numProbSal,
    benefits: fields.benefits.split(',').map((s) => s.trim()).filter(Boolean),
    risks: fields.risks.split(',').map((s) => s.trim()).filter(Boolean),
    sourceNote: fields.sourceNote.trim() || 'со слов кандидата',
  };
}

function useOfferEditForm(
  application: ApplicationView,
  onSave: OfferEditModalProps['onSave'],
  onClose: () => void,
): FormState {
  const fields = useOfferEditFormState(application);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numBase = fields.baseSalary ? Math.max(0, Number(fields.baseSalary) || 0) : 0;
  const numBonus = fields.bonus ? Math.max(0, Number(fields.bonus) || 0) : 0;
  const numProbMonths = fields.probationMonths ? Math.max(0, Number(fields.probationMonths) || 0) : 0;
  const numProbSal = fields.probationSalary ? Math.max(0, Number(fields.probationSalary) || 0) : undefined;

  const currentCompensation = calculateOfferCompensation({
    baseSalary: numBase,
    salaryPeriod: fields.salaryPeriod,
    bonus: numBonus,
    currency: fields.currency,
    probationPeriodMonths: numProbMonths,
    probationSalary: numProbSal,
    sourceNote: fields.sourceNote,
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const terms = buildOfferTerms(fields, numBase, numBonus, numProbMonths, numProbSal);
    try {
      await onSave(
        application.id,
        terms,
        fields.respondBy ? new Date(fields.respondBy).toISOString() : null,
      );
      onClose();
    } catch {
      setError('Не удалось сохранить условия оффера.');
    } finally {
      setSaving(false);
    }
  };

  return { ...fields, saving, error, handleSubmit, currentCompensation };
}

function OfferFormGrid({ form }: { readonly form: FormState }) {
  return (
    <div className="career-offer-form-grid">
      <BaseSalaryField
        baseSalary={form.baseSalary}
        setBaseSalary={form.setBaseSalary}
        salaryPeriod={form.salaryPeriod}
        setSalaryPeriod={form.setSalaryPeriod}
      />
      <BonusAndCurrencyField
        currency={form.currency}
        setCurrency={form.setCurrency}
        bonus={form.bonus}
        setBonus={form.setBonus}
      />
      <WorkFormatField
        format={form.format}
        setFormat={form.setFormat}
        respondBy={form.respondBy}
        setRespondBy={form.setRespondBy}
      />
      <ProbationField
        probationMonths={form.probationMonths}
        setProbationMonths={form.setProbationMonths}
        probationSalary={form.probationSalary}
        setProbationSalary={form.setProbationSalary}
      />
    </div>
  );
}

function OfferEditForm({
  form,
  onClose,
}: {
  readonly form: FormState;
  readonly onClose: () => void;
}) {
  return (
    <form onSubmit={form.handleSubmit} className="career-offer-edit-form">
      <OfferPreviewBox
        total={form.currentCompensation.totalAnnualCompensation}
        monthly={form.currentCompensation.monthlyAverage}
        currency={form.currency}
        sourceLabel={form.currentCompensation.sourceLabel}
      />
      <OfferFormGrid form={form} />
      <BenefitsRisksFields
        benefits={form.benefits}
        setBenefits={form.setBenefits}
        risks={form.risks}
        setRisks={form.setRisks}
      />
      <SourceNoteField
        sourceNote={form.sourceNote}
        setSourceNote={form.setSourceNote}
      />
      {form.error && <div className="career-offer-error" role="alert">{form.error}</div>}
      <OfferEditModalActions saving={form.saving} onClose={onClose} />
    </form>
  );
}

export function OfferEditModal({
  application,
  isOpen,
  onClose,
  onSave,
}: OfferEditModalProps) {
  useEscapeLayer(onClose, isOpen);
  const cardRef = useRef<HTMLDivElement>(null);
  const form = useOfferEditForm(application, onSave, onClose);

  if (!isOpen) return null;

  const company = application.vacancy?.companyHidden
    ? 'Скрытая компания'
    : (application.vacancy?.company || 'Компания');

  return (
    <div
      className="career-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (!cardRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="career-offer-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Условия оффера — ${company}`}
      >
        <OfferEditModalHeader
          company={company}
          title={application.vacancy?.title ?? 'Без названия'}
          onClose={onClose}
        />
        <OfferEditForm form={form} onClose={onClose} />
      </div>
    </div>
  );
}

function OfferEditModalHeader({
  company,
  title,
  onClose,
}: {
  readonly company: string;
  readonly title: string;
  readonly onClose: () => void;
}) {
  return (
    <header className="career-offer-edit-header">
      <div>
        <h2 className="career-offer-edit-title">Условия оффера</h2>
        <div className="career-offer-edit-subtitle">{company} · {title}</div>
      </div>
      <button
        type="button"
        className="career-btn career-btn-ghost career-btn-icon"
        aria-label="Закрыть"
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </header>
  );
}

function OfferPreviewBox({
  total,
  monthly,
  currency,
  sourceLabel,
}: {
  readonly total: number;
  readonly monthly: number;
  readonly currency: string;
  readonly sourceLabel: string;
}) {
  return (
    <div className="career-offer-preview-box">
      <span className="career-offer-preview-label">Расчёт годового дохода по формуле</span>
      <div className="career-offer-preview-values">
        <span className="career-offer-preview-total career-mono">
          {formatMoney(total, currency)}
        </span>
        <span className="career-offer-preview-monthly career-mono">
          {formatMoney(monthly, currency)}/мес.
        </span>
      </div>
      <span className="career-offer-source-badge">{sourceLabel}</span>
    </div>
  );
}

function BaseSalaryField({
  baseSalary,
  setBaseSalary,
  salaryPeriod,
  setSalaryPeriod,
}: {
  readonly baseSalary: string;
  readonly setBaseSalary: (v: string) => void;
  readonly salaryPeriod: 'month' | 'year';
  readonly setSalaryPeriod: (v: 'month' | 'year') => void;
}) {
  return (
    <>
      <div className="career-offer-field">
        <label htmlFor="offer-base-salary">Базовый оклад</label>
        <input
          id="offer-base-salary"
          type="number"
          min="0"
          step="1000"
          value={baseSalary}
          onChange={(e) => setBaseSalary(e.target.value)}
          placeholder="Например, 300000"
          className="career-input"
        />
      </div>
      <div className="career-offer-field">
        <label htmlFor="offer-salary-period">Период оклада</label>
        <select
          id="offer-salary-period"
          value={salaryPeriod}
          onChange={(e) => setSalaryPeriod(e.target.value as 'month' | 'year')}
          className="career-input"
        >
          <option value="month">В месяц</option>
          <option value="year">В год</option>
        </select>
      </div>
    </>
  );
}

function BonusAndCurrencyField({
  currency,
  setCurrency,
  bonus,
  setBonus,
}: {
  readonly currency: string;
  readonly setCurrency: (v: string) => void;
  readonly bonus: string;
  readonly setBonus: (v: string) => void;
}) {
  return (
    <>
      <div className="career-offer-field">
        <label htmlFor="offer-currency">Валюта</label>
        <select
          id="offer-currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="career-input"
        >
          <option value="RUB">RUB (₽)</option>
          <option value="USD">USD ($)</option>
          <option value="EUR">EUR (€)</option>
        </select>
      </div>
      <div className="career-offer-field">
        <label htmlFor="offer-bonus">Годовой бонус / премия</label>
        <input
          id="offer-bonus"
          type="number"
          min="0"
          step="1000"
          value={bonus}
          onChange={(e) => setBonus(e.target.value)}
          placeholder="Например, 500000"
          className="career-input"
        />
      </div>
    </>
  );
}

function WorkFormatField({
  format,
  setFormat,
  respondBy,
  setRespondBy,
}: {
  readonly format: string;
  readonly setFormat: (v: string) => void;
  readonly respondBy: string;
  readonly setRespondBy: (v: string) => void;
}) {
  return (
    <>
      <div className="career-offer-field">
        <label htmlFor="offer-format">Формат работы</label>
        <select
          id="offer-format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="career-input"
        >
          <option value="remote">Удалённо</option>
          <option value="hybrid">Гибрид</option>
          <option value="office">Офис</option>
        </select>
      </div>
      <div className="career-offer-field">
        <label htmlFor="offer-respond-by">Дедлайн ответа</label>
        <input
          id="offer-respond-by"
          type="date"
          value={respondBy}
          onChange={(e) => setRespondBy(e.target.value)}
          className="career-input"
        />
      </div>
    </>
  );
}

function ProbationField({
  probationMonths,
  setProbationMonths,
  probationSalary,
  setProbationSalary,
}: {
  readonly probationMonths: string;
  readonly setProbationMonths: (v: string) => void;
  readonly probationSalary: string;
  readonly setProbationSalary: (v: string) => void;
}) {
  return (
    <>
      <div className="career-offer-field">
        <label htmlFor="offer-probation-months">Испытательный срок (мес.)</label>
        <input
          id="offer-probation-months"
          type="number"
          min="0"
          max="12"
          value={probationMonths}
          onChange={(e) => setProbationMonths(e.target.value)}
          placeholder="3"
          className="career-input"
        />
      </div>
      <div className="career-offer-field">
        <label htmlFor="offer-probation-salary">Оклад на испытательном</label>
        <input
          id="offer-probation-salary"
          type="number"
          min="0"
          step="1000"
          value={probationSalary}
          onChange={(e) => setProbationSalary(e.target.value)}
          placeholder="Если отличается от базового"
          className="career-input"
        />
      </div>
    </>
  );
}

function BenefitsRisksFields({
  benefits,
  setBenefits,
  risks,
  setRisks,
}: {
  readonly benefits: string;
  readonly setBenefits: (v: string) => void;
  readonly risks: string;
  readonly setRisks: (v: string) => void;
}) {
  return (
    <>
      <div className="career-offer-field">
        <label htmlFor="offer-benefits">Бенефиты (через запятую)</label>
        <input
          id="offer-benefits"
          type="text"
          value={benefits}
          onChange={(e) => setBenefits(e.target.value)}
          placeholder="ДМС со стоматологией, оплата спорта, техника"
          className="career-input"
        />
      </div>
      <div className="career-offer-field">
        <label htmlFor="offer-risks">Риски и нюансы (через запятую)</label>
        <input
          id="offer-risks"
          type="text"
          value={risks}
          onChange={(e) => setRisks(e.target.value)}
          placeholder="Серая премия, частые переработки, обязательный офис"
          className="career-input"
        />
      </div>
    </>
  );
}

function SourceNoteField({
  sourceNote,
  setSourceNote,
}: {
  readonly sourceNote: string;
  readonly setSourceNote: (v: string) => void;
}) {
  return (
    <div className="career-offer-field">
      <label htmlFor="offer-source-note">Источник данных</label>
      <input
        id="offer-source-note"
        type="text"
        value={sourceNote}
        onChange={(e) => setSourceNote(e.target.value)}
        placeholder="со слов кандидата"
        className="career-input"
      />
    </div>
  );
}

function OfferEditModalActions({
  saving,
  onClose,
}: {
  readonly saving: boolean;
  readonly onClose: () => void;
}) {
  return (
    <footer className="career-offer-edit-actions">
      <button
        type="button"
        className="career-btn career-btn-secondary"
        onClick={onClose}
        disabled={saving}
      >
        Отмена
      </button>
      <button
        type="submit"
        className="career-btn career-btn-primary"
        data-testid="save-offer-btn"
        disabled={saving}
      >
        {saving ? 'Сохраняем…' : 'Сохранить условия'}
      </button>
    </footer>
  );
}

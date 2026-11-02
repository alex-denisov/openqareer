import { useState, type FormEvent, type ReactNode } from 'react';
import { CaretRight, Info, PencilSimple, Plus, Scales } from '@phosphor-icons/react';
import type { ApplicationView, CreateApplicationInput } from './applicationsApi';
import type { UseApplications } from './useApplications';
import { calculateOfferCompensation } from './offerCompensation';
import { CareerTooltip } from '../shell/CareerTooltip';

export const TOTAL_COMP_ITEMS = ['Оклад', 'Бонус', 'Акции и опционы', 'ДМС', 'Релокация'] as const;
export const TOTAL_COMP_HINT =
  'Сравнение и торг считаются от двух офферов. Рыночный ориентир — только с источником, n и датой, иначе «мало данных».';
export const EMPTY_OFFERS_TEXT =
  'Офферов пока нет. Когда придёт первый, добавьте его: платформа соберёт total comp и покажет позицию на торге.';

const CURRENCY_SIGNS: Readonly<Record<string, string>> = { USD: '$', EUR: '€' };

export function OffersCard({
  count,
  isEmpty,
  actions,
  children,
}: {
  readonly count: number;
  readonly isEmpty: boolean;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      className={`career-offers-card${isEmpty ? ' is-empty' : ''}`}
      aria-labelledby="responses-offers-title"
    >
      <div className="career-offers-head">
        <h2 id="responses-offers-title">Офферы</h2>
        <span className="career-offers-tag">{count}</span>
      </div>
      {children}
      <div className="career-offers-actions">{actions}</div>
    </section>
  );
}

export function AddOfferButton({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="career-btn career-btn-primary career-offers-add-btn"
      onClick={onToggle}
    >
      {open ? null : <Plus aria-hidden="true" />}
      {open ? 'Отменить' : 'Добавить оффер'}
    </button>
  );
}

export function CompareOffersButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button type="button" className="career-btn career-btn-secondary" onClick={onClick}>
      <Scales aria-hidden="true" /> Сравнить офферы
    </button>
  );
}

export function TotalCompCard({ offersCount }: { readonly offersCount: number }) {
  return (
    <section className="career-offers-card" aria-labelledby="responses-total-comp-title">
      <div className="career-offers-head">
        <h2 id="responses-total-comp-title">Состав total comp</h2>
        <CareerTooltip content={TOTAL_COMP_HINT}>
          <button
            type="button"
            className="career-btn-icon career-offers-info"
            aria-label="Пояснение"
          >
            <Info aria-hidden="true" />
          </button>
        </CareerTooltip>
      </div>
      <div className="career-offers-chips">
        {TOTAL_COMP_ITEMS.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      {offersCount < 2 ? (
        <>
          <p className="career-offers-note">
            <Info aria-hidden="true" />
            <span>Сравнение двух офферов появится после добавления второго.</span>
          </p>
          <p className="career-offers-foot">
            Сравнение появится после второго оффера. Рыночный ориентир — только с источником, n и
            датой, иначе «мало данных».
          </p>
        </>
      ) : null}
    </section>
  );
}

export function AddOfferForm({
  state,
  onCreated,
}: {
  readonly state: UseApplications;
  readonly onCreated: (application: ApplicationView) => void;
}) {
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const input: CreateApplicationInput = {
        stage: 'offer',
        manualVacancy: { title: title.trim(), company: company.trim(), source: 'other' },
      };
      onCreated(await state.addManualCard(input));
    } catch {
      setError('Не удалось создать карточку оффера. Повторите запрос.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="career-offers-add" onSubmit={(event) => void submit(event)}>
      <AddOfferFields company={company} title={title} onCompany={setCompany} onTitle={setTitle} />
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="submit"
        className="career-btn career-btn-primary career-btn-sm"
        disabled={saving || !company.trim() || !title.trim()}
      >
        {saving ? 'Сохраняем' : 'Продолжить к условиям'}
      </button>
    </form>
  );
}

function AddOfferFields(props: {
  readonly company: string;
  readonly title: string;
  readonly onCompany: (value: string) => void;
  readonly onTitle: (value: string) => void;
}) {
  return (
    <>
      <label>
        Компания
        <input
          value={props.company}
          onChange={(event) => props.onCompany(event.currentTarget.value)}
          required
          maxLength={300}
        />
      </label>
      <label>
        Роль
        <input
          value={props.title}
          onChange={(event) => props.onTitle(event.currentTarget.value)}
          required
          maxLength={300}
        />
      </label>
    </>
  );
}

function formatAmount(application: ApplicationView): string {
  const terms = application.offer?.terms;
  if (terms?.baseSalary === undefined) return 'Условия не указаны';
  const total = calculateOfferCompensation(terms).totalAnnualCompensation;
  const sign = CURRENCY_SIGNS[terms.currency ?? ''] ?? '₽';
  return `${new Intl.NumberFormat('ru-RU').format(total)} ${sign} в год`;
}

function formatRespondBy(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `Ответить до ${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`;
}

export function OfferRow({
  application,
  onEdit,
}: {
  readonly application: ApplicationView;
  readonly onEdit: () => void;
}) {
  const respondBy = formatRespondBy(application.offer?.respondBy);
  return (
    <li className="career-offers-row">
      <div className="career-offers-main">
        <b>{application.vacancy?.company || 'Компания не указана'}</b>
        <p>{application.vacancy?.title || 'Роль не указана'}</p>
        <p>
          Совокупная компенсация: {formatAmount(application)}
          {respondBy ? ` · ${respondBy}` : ''}
        </p>
      </div>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        onClick={onEdit}
      >
        <PencilSimple aria-hidden="true" />
        <span className="career-offers-act-label">Изменить условия</span>
        <CaretRight className="career-offers-chev" aria-hidden="true" />
      </button>
    </li>
  );
}

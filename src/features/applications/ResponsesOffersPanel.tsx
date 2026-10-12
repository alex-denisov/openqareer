import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { ApplicationView, CreateApplicationInput } from './applicationsApi';
import { listApplicationsPage } from './applicationsApi';
import type { UseApplications } from './useApplications';
import { OfferEditModal } from './OfferEditModal';
import { OfferComparisonMatrix } from './OfferComparisonMatrix';
import { calculateOfferCompensation } from './offerCompensation';

export function ResponsesOffersPanel({ state }: { readonly state: UseApplications }) {
  const [applications, setApplications] = useState<readonly ApplicationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await listApplicationsPage({ stage: ['offer'], limit: 100, offset: 0 });
      setApplications(page.items);
    } catch {
      setError('Не удалось загрузить офферы. Повторите запрос.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const editingApplication = applications.find((application) => application.id === editingId) ?? null;
  return (
    <section className="career-responses-offers" aria-label="Офферы">
      <header className="career-responses-offers-header">
        <div><h2>Офферы</h2><p>{applications.length} сохранено</p></div>
        <div>
          <button type="button" className="career-btn career-btn-secondary career-btn-sm" onClick={() => setComparing(true)} disabled={applications.length < 2}>
            Сравнить офферы
          </button>
          <button type="button" className="career-btn career-btn-primary career-btn-sm" onClick={() => setAddOpen((open) => !open)}>
            {addOpen ? 'Отменить' : 'Добавить оффер'}
          </button>
        </div>
      </header>
      {error ? <p role="alert">{error} <button type="button" onClick={() => void reload()}>Повторить</button></p> : null}
      {loading ? <p role="status">Загружаем офферы…</p> : null}
      {!loading && applications.length === 0 ? <p role="status">Сохранённых офферов пока нет.</p> : null}
      {addOpen ? <AddOfferForm state={state} onCreated={(application) => { setApplications((items) => [...items, application]); setEditingId(application.id); setAddOpen(false); }} /> : null}
      <ul className="career-responses-offer-list">
        {applications.map((application) => (
          <OfferRow key={application.id} application={application} onEdit={() => setEditingId(application.id)} />
        ))}
      </ul>
      {editingApplication ? <OfferEditModal application={editingApplication} isOpen onClose={() => setEditingId(null)} onSave={async (id, terms, respondBy) => { await state.saveOffer(id, terms, respondBy); await reload(); }} /> : null}
      {comparing ? <OfferComparisonMatrix applications={applications} onClose={() => setComparing(false)} onEditOffer={(id) => { setComparing(false); setEditingId(id); }} /> : null}
      {!loading && applications.length > 0 ? <button type="button" className="career-btn career-btn-secondary career-btn-sm" onClick={() => void reload()}>Обновить офферы</button> : null}
    </section>
  );
}

function AddOfferForm({
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
      const application = await state.addManualCard(input);
      onCreated(application);
    } catch {
      setError('Не удалось создать карточку оффера. Повторите запрос.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="career-responses-add-offer" onSubmit={(event) => void submit(event)}>
      <label>Компания<input value={company} onChange={(event) => setCompany(event.currentTarget.value)} required maxLength={300} /></label>
      <label>Роль<input value={title} onChange={(event) => setTitle(event.currentTarget.value)} required maxLength={300} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" className="career-btn career-btn-primary career-btn-sm" disabled={saving || !company.trim() || !title.trim()}>
        {saving ? 'Сохраняем' : 'Продолжить к условиям'}
      </button>
    </form>
  );
}

function OfferRow({ application, onEdit }: { readonly application: ApplicationView; readonly onEdit: () => void }) {
  const terms = application.offer?.terms;
  const compensation = calculateOfferCompensation(terms ?? {});
  const amount = terms?.baseSalary === undefined
    ? 'Условия не указаны'
    : `${new Intl.NumberFormat('ru-RU').format(compensation.totalAnnualCompensation)} ${terms.currency === 'USD' ? '$' : terms.currency === 'EUR' ? '€' : '₽'} в год`;
  return (
    <li className="career-responses-offer-row">
      <div><strong>{application.vacancy?.company || 'Компания не указана'}</strong><span>{application.vacancy?.title || 'Роль не указана'}</span></div>
      <div><span>Совокупная компенсация</span><strong>{amount}</strong></div>
      <button type="button" onClick={onEdit}>Изменить условия</button>
    </li>
  );
}

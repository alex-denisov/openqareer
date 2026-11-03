import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { ApplicationView } from './applicationsApi';
import { listApplicationsPage } from './applicationsApi';
import type { UseApplications } from './useApplications';
import { OfferEditModal } from './OfferEditModal';
import { OfferComparisonMatrix } from './OfferComparisonMatrix';
import {
  AddOfferButton,
  AddOfferForm,
  CompareOffersButton,
  EMPTY_OFFERS_TEXT,
  OfferRow,
  OffersCard,
  TotalCompCard,
} from './ResponsesOffersParts';
import { usePublishConsultantSuggestion } from '../journey/consultantScreenSuggestion';
import { offersTabSuggestion } from './responsesTabSuggestions';
import './responses-offers.css';

function useOffers() {
  const [applications, setApplications] = useState<readonly ApplicationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  useEffect(() => {
    void reload();
  }, [reload]);
  return { applications, setApplications, loading, error, reload };
}

export function ResponsesOffersPanel({ state }: { readonly state: UseApplications }) {
  const { applications, setApplications, loading, error, reload } = useOffers();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const editing = applications.find((application) => application.id === editingId) ?? null;
  const toggleAdd = () => setAddOpen((open) => !open);
  useOffersSuggestion({ applications, loading, error }, setComparing, setEditingId, setAddOpen);
  return (
    <div className="career-offers-panel" aria-label="Офферы">
      <OffersListCard
        state={state}
        applications={applications}
        loading={loading}
        error={error}
        addOpen={addOpen}
        onToggleAdd={toggleAdd}
        onReload={() => void reload()}
        onCompare={() => setComparing(true)}
        onEdit={setEditingId}
        onCreated={(application) => {
          setApplications((items) => [...items, application]);
          setEditingId(application.id);
          setAddOpen(false);
        }}
      />
      <TotalCompCard offersCount={applications.length} />
      <div className="career-offers-cta">
        <button type="button" className="career-btn career-btn-primary" onClick={toggleAdd}>
          <Plus aria-hidden="true" /> {addOpen ? 'Отменить' : 'Добавить оффер'}
        </button>
      </div>
      <OfferDialogs
        editing={editing}
        comparing={comparing}
        applications={applications}
        onSave={async (id, terms, respondBy) => {
          await state.saveOffer(id, terms, respondBy);
          await reload();
        }}
        onCloseEdit={() => setEditingId(null)}
        onCloseCompare={() => setComparing(false)}
        onEditFromCompare={(id) => {
          setComparing(false);
          setEditingId(id);
        }}
      />
    </div>
  );
}

/** Макет 5 «Офферы»: предложение консультанта по загруженным офферам вкладки. */
function useOffersSuggestion(
  offers: {
    readonly applications: readonly ApplicationView[];
    readonly loading: boolean;
    readonly error: string;
  },
  setComparing: (comparing: boolean) => void,
  setEditingId: (id: string) => void,
  setAddOpen: (open: boolean) => void,
) {
  usePublishConsultantSuggestion(
    offersTabSuggestion({
      offers: offers.applications,
      loading: offers.loading,
      error: offers.error,
      actions: {
        compare: () => setComparing(true),
        edit: setEditingId,
        add: () => setAddOpen(true),
      },
    }),
  );
}

function OffersHero() {
  return (
    <div className="career-offers-hero">
      <h2>Офферов пока нет</h2>
      <p>Добавьте первый: платформа соберёт total comp и покажет позицию на торге.</p>
    </div>
  );
}

function OfferDialogs(props: {
  readonly editing: ApplicationView | null;
  readonly comparing: boolean;
  readonly applications: readonly ApplicationView[];
  readonly onSave: ComponentProps<typeof OfferEditModal>['onSave'];
  readonly onCloseEdit: () => void;
  readonly onCloseCompare: () => void;
  readonly onEditFromCompare: (id: string) => void;
}) {
  return (
    <>
      {props.editing ? (
        <OfferEditModal
          application={props.editing}
          isOpen
          onClose={props.onCloseEdit}
          onSave={props.onSave}
        />
      ) : null}
      {props.comparing ? (
        <OfferComparisonMatrix
          applications={props.applications}
          onClose={props.onCloseCompare}
          onEditOffer={props.onEditFromCompare}
        />
      ) : null}
    </>
  );
}

function OffersListCard(props: {
  readonly state: UseApplications;
  readonly applications: readonly ApplicationView[];
  readonly loading: boolean;
  readonly error: string;
  readonly addOpen: boolean;
  readonly onToggleAdd: () => void;
  readonly onReload: () => void;
  readonly onCompare: () => void;
  readonly onEdit: (id: string) => void;
  readonly onCreated: (application: ApplicationView) => void;
}) {
  const { applications, loading, error, addOpen } = props;
  const isEmpty = !loading && !error && applications.length === 0;
  return (
    <>
      {isEmpty ? <OffersHero /> : null}
      <OffersCard
        count={applications.length}
        isEmpty={isEmpty && !addOpen}
        actions={
          <>
            {applications.length >= 2 ? <CompareOffersButton onClick={props.onCompare} /> : null}
            <AddOfferButton open={addOpen} onToggle={props.onToggleAdd} />
          </>
        }
      >
        <OffersStatus loading={loading} error={error} onReload={props.onReload} />
        {isEmpty ? (
          <p className="career-offers-text" role="status">
            {EMPTY_OFFERS_TEXT}
          </p>
        ) : null}
        {addOpen ? <AddOfferForm state={props.state} onCreated={props.onCreated} /> : null}
        <ul className="career-offers-list">
          {applications.map((application) => (
            <OfferRow
              key={application.id}
              application={application}
              onEdit={() => props.onEdit(application.id)}
            />
          ))}
        </ul>
      </OffersCard>
    </>
  );
}

function OffersStatus({
  loading,
  error,
  onReload,
}: {
  readonly loading: boolean;
  readonly error: string;
  readonly onReload: () => void;
}) {
  return (
    <>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={onReload}>
            Повторить
          </button>
        </p>
      ) : null}
      {loading ? <p role="status">Загружаем офферы…</p> : null}
    </>
  );
}

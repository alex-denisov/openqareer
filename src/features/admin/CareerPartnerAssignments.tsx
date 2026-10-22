import { useEffect, useState } from 'react';
import {
  assignAdminCandidate,
  listAdminPartnerAssignments,
  listAdminUsers,
  removeAdminCandidateAssignment,
  type AdminUser,
} from './adminApi';

function extractError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Неизвестная ошибка';
}

function usePartnerAssignments(partnerId: string) {
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof listAdminPartnerAssignments>>['items']
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listAdminPartnerAssignments(partnerId)
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((reason: unknown) => {
        if (active) setError(extractError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [partnerId, revision]);

  const remove = async (candidateUserId: string) => {
    setError(null);
    setRemovingId(candidateUserId);
    try {
      await removeAdminCandidateAssignment(partnerId, candidateUserId);
      setRevision((current) => current + 1);
    } catch (reason: unknown) {
      setError(extractError(reason));
    } finally {
      setRemovingId(null);
    }
  };

  return {
    items,
    loading,
    error,
    removingId,
    remove,
    retry: () => setRevision((current) => current + 1),
    refresh: () => setRevision((current) => current + 1),
  };
}

export function CareerPartnerAssignments({ partnerId }: { partnerId: string }) {
  const assignments = usePartnerAssignments(partnerId);
  return (
    <section className="admin-rbac-section" aria-labelledby="partner-assignments-title">
      <h4 id="partner-assignments-title" className="admin-rbac-section__title">
        Закреплённые кандидаты
      </h4>
      <AssignmentSearch
        partnerId={partnerId}
        assignedIds={new Set(assignments.items.map((item) => item.userId))}
        onAssigned={assignments.refresh}
      />
      <AssignmentStatus assignments={assignments} />
      <AssignedCandidateRows
        items={assignments.items}
        removingId={assignments.removingId}
        onRemove={assignments.remove}
      />
      {assignments.error && (
        <div className="admin-alert admin-alert--error" role="alert">
          <span>{assignments.error}</span>
          <button type="button" className="admin-quiet-button" onClick={assignments.retry}>
            Повторить
          </button>
        </div>
      )}
    </section>
  );
}

function AssignmentStatus({
  assignments,
}: {
  assignments: ReturnType<typeof usePartnerAssignments>;
}) {
  if (assignments.loading) {
    return (
      <p className="admin-note" aria-busy="true">
        Загружаем закрепления…
      </p>
    );
  }
  if (!assignments.error && assignments.items.length === 0) {
    return <p className="admin-note">Пока нет закреплённых кандидатов.</p>;
  }
  return null;
}

function AssignedCandidateRows({
  items,
  removingId,
  onRemove,
}: {
  items: Awaited<ReturnType<typeof listAdminPartnerAssignments>>['items'];
  removingId: string | null;
  onRemove: (candidateUserId: string) => Promise<void>;
}) {
  return (
    <ul className="admin-assignment-list">
      {items.map((item) => (
        <li key={item.userId}>
          <span>
            {item.displayName ?? 'Имя не указано'}
            {item.headline ? ` · ${item.headline}` : ''}
          </span>
          <button
            type="button"
            className="admin-quiet-button"
            disabled={removingId !== null}
            onClick={() => void onRemove(item.userId)}
          >
            {removingId === item.userId ? 'Снимаем…' : 'Снять закрепление'}
          </button>
        </li>
      ))}
    </ul>
  );
}

function useAssignmentSearch({
  partnerId,
  assignedIds,
  onAssigned,
}: {
  partnerId: string;
  assignedIds: ReadonlySet<string>;
  onAssigned: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const search = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const page = await listAdminUsers({ query, role: 'candidate' });
      setResults(page.users.filter((candidate) => !assignedIds.has(candidate.id)));
    } catch (reason: unknown) {
      setError(extractError(reason));
    } finally {
      setLoading(false);
    }
  };

  const assign = async (candidateUserId: string) => {
    setError(null);
    setAssigningId(candidateUserId);
    try {
      await assignAdminCandidate(partnerId, candidateUserId);
      setResults((current) => current.filter((candidate) => candidate.id !== candidateUserId));
      onAssigned();
    } catch (reason: unknown) {
      setError(extractError(reason));
    } finally {
      setAssigningId(null);
    }
  };

  return { query, setQuery, results, error, loading, assigningId, search, assign };
}

function AssignmentSearch({
  partnerId,
  assignedIds,
  onAssigned,
}: {
  partnerId: string;
  assignedIds: ReadonlySet<string>;
  onAssigned: () => void;
}) {
  const { query, setQuery, results, error, loading, assigningId, search, assign } =
    useAssignmentSearch({ partnerId, assignedIds, onAssigned });

  return (
    <div className="admin-assignment-search">
      <label className="admin-label" htmlFor="admin-assignment-query">
        Найти кандидата
      </label>
      <div className="admin-assignment-search__controls">
        <input
          id="admin-assignment-query"
          type="search"
          className="admin-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="admin-quiet-button"
          disabled={loading}
          onClick={() => void search()}
        >
          {loading ? 'Поиск…' : 'Найти'}
        </button>
      </div>
      <AssignmentSearchResults
        query={query}
        results={results}
        error={error}
        loading={loading}
        assigningId={assigningId}
        onAssign={assign}
      />
    </div>
  );
}

function AssignmentSearchResults({
  query,
  results,
  error,
  loading,
  assigningId,
  onAssign,
}: {
  query: string;
  results: AdminUser[];
  error: string | null;
  loading: boolean;
  assigningId: string | null;
  onAssign: (candidateUserId: string) => Promise<void>;
}) {
  return (
    <>
      {results.map((candidate) => (
        <div className="admin-assignment-result" key={candidate.id}>
          <span>{candidate.displayName ?? candidate.username}</span>
          <button
            type="button"
            className="admin-quiet-button"
            disabled={assigningId !== null}
            onClick={() => void onAssign(candidate.id)}
          >
            {assigningId === candidate.id ? 'Закрепляем…' : 'Закрепить'}
          </button>
        </div>
      ))}
      {!loading && !error && query.trim() && results.length === 0 && (
        <p className="admin-note">Кандидаты не найдены.</p>
      )}
      {error && (
        <p className="admin-alert admin-alert--error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

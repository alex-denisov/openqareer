import { useCallback, useState } from 'react';
import type { B640Contact, B640ContactState } from '../../../../../shared/b640Contacts';
import { useToast } from '../../kit';
import { setB640ContactStatus } from './contactsApi';
import { STATE_LABELS } from './contactsFilters';

export interface ContactStatusControl {
  /** Контакты, чей статус сейчас сохраняется. */
  readonly pending: ReadonlySet<string>;
  /** Не сохранилось: контакт → желаемый статус, его повторяет «Повторить». */
  readonly failed: Readonly<Record<string, B640ContactState>>;
  readonly change: (contact: B640Contact, to: B640ContactState) => void;
}

type Patch = (id: string, from: B640ContactState, to: B640ContactState, at: string | null) => void;

const without = <T,>(record: Readonly<Record<string, T>>, id: string): Readonly<Record<string, T>> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));

/** Смена статуса: ожидание и ошибка на строке, после успеха тост с «Отменить». */
export function useContactStatus(patch: Patch): ContactStatusControl {
  const toast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Readonly<Record<string, B640ContactState>>>({});

  const run = useCallback(
    (contact: B640Contact, from: B640ContactState, to: B640ContactState, announce: boolean) => {
      setPending((before) => new Set([...before, contact.id]));
      setFailed((before) => without(before, contact.id));
      setB640ContactStatus(contact.id, to)
        .then((result) => {
          patch(contact.id, from, result.state, result.at);
          if (!announce) return;
          toast.show({
            text: `${contact.fullName}: ${STATE_LABELS[to].toLowerCase()}`,
            undo: { label: 'Отменить', onUndo: () => run(contact, to, from, false) },
          });
        })
        .catch(() => setFailed((before) => ({ ...before, [contact.id]: to })))
        .finally(() => setPending((before) => new Set([...before].filter((id) => id !== contact.id))));
    },
    [patch, toast],
  );

  const change = useCallback(
    (contact: B640Contact, to: B640ContactState) => {
      if (contact.status.state !== to) run(contact, contact.status.state, to, true);
    },
    [run],
  );

  return { pending, failed, change };
}

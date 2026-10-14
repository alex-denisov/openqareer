import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  CandidateConnectionContact,
  ConnectionContactInput,
  ConnectionContactStrength,
} from './connectionContactsApi';
import {
  deleteCandidateConnectionContact,
  listCandidateConnectionContacts,
  saveCandidateConnectionContact,
} from './connectionContactsApi';

export interface ContactForm {
  readonly fullName: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly relationship: string;
  readonly strength: ConnectionContactStrength;
  readonly linkedinUrl: string;
}

export interface ContactPageState {
  readonly contacts: readonly CandidateConnectionContact[];
  readonly loading: boolean;
  readonly error: string;
  readonly nextOffset: number | null;
  readonly loadContacts: (offset?: number, append?: boolean) => Promise<void>;
  readonly upsert: (contact: CandidateConnectionContact) => void;
  readonly remove: (id: string) => void;
}

export interface ContactFormState {
  readonly form: ContactForm;
  readonly editingId: string | null;
  readonly setForm: (form: ContactForm) => void;
  readonly setEditingId: (id: string | null) => void;
  readonly edit: (contact: CandidateConnectionContact) => void;
  readonly reset: () => void;
}

export interface ContactMutationState {
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly deletingId: string | null;
  readonly setDeletingId: (id: string | null) => void;
  readonly save: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

interface ContactMutationContext {
  readonly page: ContactPageState;
  readonly form: ContactFormState;
  readonly onChanged: () => void;
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (error: string) => void;
  readonly setNotice: (notice: string) => void;
  readonly setDeletingId: (id: string | null) => void;
}

export function emptyContactForm(companyName: string): ContactForm {
  return {
    fullName: '',
    companyName,
    roleTitle: '',
    relationship: '',
    strength: 'unknown',
    linkedinUrl: '',
  };
}

function contactForm(contact: CandidateConnectionContact): ContactForm {
  return {
    fullName: contact.fullName,
    companyName: contact.companyName,
    roleTitle: contact.roleTitle,
    relationship: contact.relationship,
    strength: contact.strength,
    linkedinUrl: contact.linkedinUrl ?? '',
  };
}

function contactPayload(form: ContactForm): ConnectionContactInput {
  return {
    fullName: form.fullName.trim(),
    companyName: form.companyName.trim(),
    roleTitle: form.roleTitle.trim(),
    relationship: form.relationship.trim(),
    strength: form.strength,
    ...(form.linkedinUrl.trim() ? { linkedinUrl: form.linkedinUrl.trim() } : {}),
    workplaces: [],
    knowsRecruiterIds: [],
  };
}

function messageForError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useConnectionContactPages(): ContactPageState {
  const [contacts, setContacts] = useState<readonly CandidateConnectionContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const loadContacts = useCallback(async (offset = 0, append = false) => {
    setLoading(true);
    setError('');
    try {
      const page = await listCandidateConnectionContacts(offset);
      setContacts((current) => (append ? [...current, ...page.items] : page.items));
      setNextOffset(page.nextOffset);
    } catch (reason: unknown) {
      setError(messageForError(reason, 'Не удалось загрузить контакты.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);
  const upsert = (contact: CandidateConnectionContact) => {
    setContacts((current) =>
      current.some((item) => item.id === contact.id)
        ? current.map((item) => (item.id === contact.id ? contact : item))
        : [contact, ...current],
    );
  };
  const remove = (id: string) => setContacts((current) => current.filter((item) => item.id !== id));
  return { contacts, loading, error, nextOffset, loadContacts, upsert, remove };
}

export function useConnectionContactForm(companyName: string): ContactFormState {
  const [form, setForm] = useState(() => emptyContactForm(companyName));
  const [editingId, setEditingId] = useState<string | null>(null);
  const edit = (contact: CandidateConnectionContact) => {
    setForm(contactForm(contact));
    setEditingId(contact.id);
  };
  const reset = () => {
    setForm(emptyContactForm(companyName));
    setEditingId(null);
  };
  return { form, editingId, setForm, setEditingId, edit, reset };
}

export function useConnectionContactMutations({
  page,
  form,
  onChanged,
}: {
  readonly page: ContactPageState;
  readonly form: ContactFormState;
  readonly onChanged: () => void;
}): ContactMutationState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await persistManualContact({
      page,
      form,
      onChanged,
      setBusy,
      setError,
      setNotice,
      setDeletingId,
    });
  };
  const remove = (id: string) =>
    removeManualContact(id, { page, form, onChanged, setBusy, setError, setNotice, setDeletingId });
  return { busy, error, notice, deletingId, setDeletingId, save, remove };
}

async function persistManualContact(context: ContactMutationContext): Promise<void> {
  context.setBusy(true);
  context.setError('');
  context.setNotice('');
  try {
    const id = context.form.editingId ?? crypto.randomUUID();
    const saved = await saveCandidateConnectionContact(id, contactPayload(context.form.form));
    context.page.upsert(saved);
    context.form.setEditingId(id);
    context.setDeletingId(null);
    context.setNotice('Контакт сохранён.');
    context.onChanged();
  } catch (reason: unknown) {
    context.setError(messageForError(reason, 'Не удалось сохранить контакт.'));
  } finally {
    context.setBusy(false);
  }
}

async function removeManualContact(id: string, context: ContactMutationContext): Promise<void> {
  context.setBusy(true);
  context.setError('');
  context.setNotice('');
  try {
    await deleteCandidateConnectionContact(id);
    context.page.remove(id);
    if (context.form.editingId === id) context.form.reset();
    context.setDeletingId(null);
    context.setNotice('Контакт удалён.');
    context.onChanged();
  } catch (reason: unknown) {
    context.setError(messageForError(reason, 'Не удалось удалить контакт.'));
  } finally {
    context.setBusy(false);
  }
}

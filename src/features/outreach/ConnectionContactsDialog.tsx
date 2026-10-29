import { useEffect, useId, useRef, type FormEvent } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import { CircleNotch, PencilSimple, Trash, WarningCircle, X } from '@phosphor-icons/react';
import type {
  CandidateConnectionContact,
  ConnectionContactStrength,
} from './connectionContactsApi';
import type {
  ContactForm,
  ContactFormState,
  ContactMutationState,
  ContactPageState,
} from './connectionContactsState';
import {
  useConnectionContactForm,
  useConnectionContactMutations,
  useConnectionContactPages,
} from './connectionContactsState';
import './connection-contacts.css';

interface ConnectionContactsDialogProps {
  readonly vacancyCompany: string;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}

function DeleteConfirmation({
  fullName,
  busy,
  onDelete,
  onCancelDelete,
}: {
  readonly fullName: string;
  readonly busy: boolean;
  readonly onDelete: () => void;
  readonly onCancelDelete: () => void;
}) {
  return (
    <div
      className="career-connection-dialog__confirm"
      role="group"
      aria-label={`Удалить контакт ${fullName}`}
    >
      <span>Удалить контакт?</span>
      <button type="button" className="career-btn is-danger" disabled={busy} onClick={onDelete}>
        Удалить контакт
      </button>
      <button
        type="button"
        className="career-btn career-btn-secondary"
        disabled={busy}
        onClick={onCancelDelete}
      >
        Отмена
      </button>
    </div>
  );
}

function ContactActions({
  contact,
  deleting,
  busy,
  onEdit,
  onAskDelete,
  onDelete,
  onCancelDelete,
}: {
  readonly contact: CandidateConnectionContact;
  readonly deleting: boolean;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onAskDelete: () => void;
  readonly onDelete: () => void;
  readonly onCancelDelete: () => void;
}) {
  if (contact.source !== 'manual') return <small>Импортированный контакт · только чтение</small>;
  return (
    <ManualContactActions
      contact={contact}
      deleting={deleting}
      busy={busy}
      onEdit={onEdit}
      onAskDelete={onAskDelete}
      onDelete={onDelete}
      onCancelDelete={onCancelDelete}
    />
  );
}

function ManualContactActions({
  contact,
  deleting,
  busy,
  onEdit,
  onAskDelete,
  onDelete,
  onCancelDelete,
}: {
  readonly contact: CandidateConnectionContact;
  readonly deleting: boolean;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onAskDelete: () => void;
  readonly onDelete: () => void;
  readonly onCancelDelete: () => void;
}) {
  if (deleting) {
    return (
      <DeleteConfirmation
        fullName={contact.fullName}
        busy={busy}
        onDelete={onDelete}
        onCancelDelete={onCancelDelete}
      />
    );
  }
  return (
    <div className="career-connection-dialog__contact-actions">
      <button
        type="button"
        className="career-btn career-btn-secondary"
        disabled={busy}
        aria-label={`Изменить контакт ${contact.fullName}`}
        onClick={onEdit}
      >
        <PencilSimple size={16} aria-hidden="true" /> Изменить
      </button>
      <button
        type="button"
        className="career-btn is-danger"
        disabled={busy}
        aria-label={`Удалить контакт ${contact.fullName}`}
        onClick={onAskDelete}
      >
        <Trash size={16} aria-hidden="true" /> Удалить
      </button>
    </div>
  );
}

function ConnectionContactRow({
  contact,
  deleting,
  busy,
  onEdit,
  onAskDelete,
  onDelete,
  onCancelDelete,
}: {
  readonly contact: CandidateConnectionContact;
  readonly deleting: boolean;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onAskDelete: () => void;
  readonly onDelete: () => void;
  readonly onCancelDelete: () => void;
}) {
  return (
    <li className="career-connection-dialog__contact">
      <div className="career-connection-dialog__contact-copy">
        <strong>{contact.fullName}</strong>
        <span>
          {[contact.roleTitle || 'Роль не указана', contact.companyName]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span>{contact.relationship}</span>
      </div>
      <ContactActions
        contact={contact}
        deleting={deleting}
        busy={busy}
        onEdit={onEdit}
        onAskDelete={onAskDelete}
        onDelete={onDelete}
        onCancelDelete={onCancelDelete}
      />
    </li>
  );
}

function ContactList({
  contacts,
  loading,
  nextOffset,
  deletingId,
  busy,
  onEdit,
  onAskDelete,
  onDelete,
  onCancelDelete,
  onLoadMore,
}: {
  readonly contacts: readonly CandidateConnectionContact[];
  readonly loading: boolean;
  readonly nextOffset: number | null;
  readonly deletingId: string | null;
  readonly busy: boolean;
  readonly onEdit: (contact: CandidateConnectionContact) => void;
  readonly onAskDelete: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onCancelDelete: () => void;
  readonly onLoadMore: () => void;
}) {
  return (
    <section aria-labelledby="career-connection-list-title">
      <h3 id="career-connection-list-title">Сохранённые контакты</h3>
      {contacts.length === 0 && !loading ? (
        <p className="career-connection-dialog__muted">Добавленных контактов пока нет.</p>
      ) : null}
      <ContactRows
        contacts={contacts}
        loading={loading}
        deletingId={deletingId}
        busy={busy}
        onEdit={onEdit}
        onAskDelete={onAskDelete}
        onDelete={onDelete}
        onCancelDelete={onCancelDelete}
      />
      <ContactListFooter loading={loading} nextOffset={nextOffset} onLoadMore={onLoadMore} />
    </section>
  );
}

function ContactListFooter({
  loading,
  nextOffset,
  onLoadMore,
}: {
  readonly loading: boolean;
  readonly nextOffset: number | null;
  readonly onLoadMore: () => void;
}) {
  return (
    <>
      {loading ? (
        <p className="career-connection-dialog__status" role="status">
          <CircleNotch size={16} aria-hidden="true" /> Загружаем контакты…
        </p>
      ) : null}
      {nextOffset !== null ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          disabled={loading}
          onClick={onLoadMore}
        >
          Показать ещё контакты
        </button>
      ) : null}
    </>
  );
}

function ContactRows({
  contacts,
  loading,
  deletingId,
  busy,
  onEdit,
  onAskDelete,
  onDelete,
  onCancelDelete,
}: {
  readonly contacts: readonly CandidateConnectionContact[];
  readonly loading: boolean;
  readonly deletingId: string | null;
  readonly busy: boolean;
  readonly onEdit: (contact: CandidateConnectionContact) => void;
  readonly onAskDelete: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onCancelDelete: () => void;
}) {
  return (
    <ul className="career-connection-dialog__list" aria-busy={loading || busy}>
      {contacts.map((contact) => (
        <ConnectionContactRow
          key={contact.id}
          contact={contact}
          deleting={deletingId === contact.id}
          busy={busy}
          onEdit={() => onEdit(contact)}
          onAskDelete={() => onAskDelete(contact.id)}
          onDelete={() => onDelete(contact.id)}
          onCancelDelete={onCancelDelete}
        />
      ))}
    </ul>
  );
}

function ContactTextField({
  label,
  value,
  required = false,
  maxLength,
  type = 'text',
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly required?: boolean;
  readonly maxLength: number;
  readonly type?: 'text' | 'url';
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        required={required}
        maxLength={maxLength}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function ConnectionContactForm({
  form,
  editing,
  busy,
  onChange,
  onReset,
  onSubmit,
}: {
  readonly form: ContactForm;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly onChange: (form: ContactForm) => void;
  readonly onReset: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="career-connection-dialog__form" onSubmit={onSubmit}>
      <h3>{editing ? 'Изменить контакт' : 'Добавить контакт'}</h3>
      <ConnectionContactFields form={form} onChange={onChange} />
      <p className="career-connection-dialog__muted">
        Сила связи — ваша отметка. Вероятность ответа не рассчитывается.
      </p>
      <ContactFormActions editing={editing} busy={busy} onReset={onReset} />
    </form>
  );
}

function ConnectionContactFields({
  form,
  onChange,
}: {
  readonly form: ContactForm;
  readonly onChange: (form: ContactForm) => void;
}) {
  return (
    <>
      <ConnectionContactIdentityFields form={form} onChange={onChange} />
      <ConnectionContactStrengthField
        value={form.strength}
        onChange={(strength) => onChange({ ...form, strength })}
      />
      <ContactTextField
        label="Ссылка LinkedIn, если есть"
        value={form.linkedinUrl}
        type="url"
        maxLength={500}
        onChange={(linkedinUrl) => onChange({ ...form, linkedinUrl })}
      />
    </>
  );
}

function ConnectionContactIdentityFields({
  form,
  onChange,
}: {
  readonly form: ContactForm;
  readonly onChange: (form: ContactForm) => void;
}) {
  return (
    <>
      <ContactTextField
        label="Имя"
        value={form.fullName}
        required
        maxLength={120}
        onChange={(fullName) => onChange({ ...form, fullName })}
      />
      <ContactTextField
        label="Компания"
        value={form.companyName}
        required
        maxLength={180}
        onChange={(companyName) => onChange({ ...form, companyName })}
      />
      <ContactTextField
        label="Роль"
        value={form.roleTitle}
        maxLength={160}
        onChange={(roleTitle) => onChange({ ...form, roleTitle })}
      />
      <ContactTextField
        label="Как вы знакомы"
        value={form.relationship}
        required
        maxLength={180}
        onChange={(relationship) => onChange({ ...form, relationship })}
      />
    </>
  );
}

function ConnectionContactStrengthField({
  value,
  onChange,
}: {
  readonly value: ConnectionContactStrength;
  readonly onChange: (strength: ConnectionContactStrength) => void;
}) {
  return (
    <label>
      Сила связи
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as ConnectionContactStrength)}
      >
        <option value="unknown">Неизвестно</option>
        <option value="strong">Сильная</option>
        <option value="weak">Слабая</option>
      </select>
    </label>
  );
}

function ContactFormActions({
  editing,
  busy,
  onReset,
}: {
  readonly editing: boolean;
  readonly busy: boolean;
  readonly onReset: () => void;
}) {
  return (
    <div className="career-connection-dialog__form-actions">
      {editing ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          disabled={busy}
          onClick={onReset}
        >
          Новая запись
        </button>
      ) : null}
      <button
        type="submit"
        className="career-btn career-btn-primary"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Сохраняем…' : 'Сохранить контакт'}
      </button>
    </div>
  );
}

function ContactDialogHeader({
  titleId,
  onClose,
}: {
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  return (
    <header className="career-modal-header">
      <div>
        <h2 id={titleId}>Контакты</h2>
        <p className="career-modal-intro">
          Ваши записи связей. Добавленные контакты можно изменить или удалить.
        </p>
      </div>
      <button
        type="button"
        className="career-modal-close"
        aria-label="Закрыть контакты"
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

function ContactDialogContent({
  page,
  form,
  mutations,
}: {
  readonly page: ContactPageState;
  readonly form: ContactFormState;
  readonly mutations: ContactMutationState;
}) {
  return (
    <div className="career-modal-body career-connection-dialog__body">
      <ContactDialogFeedback page={page} mutations={mutations} />
      <ContactList
        contacts={page.contacts}
        loading={page.loading}
        nextOffset={page.nextOffset}
        deletingId={mutations.deletingId}
        busy={mutations.busy}
        onEdit={form.edit}
        onAskDelete={mutations.setDeletingId}
        onDelete={(id) => void mutations.remove(id)}
        onCancelDelete={() => mutations.setDeletingId(null)}
        onLoadMore={() => {
          if (page.nextOffset !== null) void page.loadContacts(page.nextOffset, true);
        }}
      />
      <ConnectionContactForm
        form={form.form}
        editing={Boolean(form.editingId)}
        busy={mutations.busy}
        onChange={form.setForm}
        onReset={form.reset}
        onSubmit={(event) => void mutations.save(event)}
      />
    </div>
  );
}

function ContactDialogFeedback({
  page,
  mutations,
}: {
  readonly page: ContactPageState;
  readonly mutations: ContactMutationState;
}) {
  return (
    <>
      {page.error ? (
        <p className="career-modal-error" role="alert">
          <WarningCircle size={16} aria-hidden="true" /> {page.error}
          <button
            type="button"
            className="career-btn career-btn-secondary"
            onClick={() => void page.loadContacts()}
          >
            Повторить
          </button>
        </p>
      ) : null}
      {mutations.error ? (
        <p className="career-modal-error" role="alert">
          <WarningCircle size={16} aria-hidden="true" /> {mutations.error}
        </p>
      ) : null}
      {mutations.notice ? (
        <p className="career-connection-dialog__notice" role="status">
          {mutations.notice}
        </p>
      ) : null}
    </>
  );
}

export function ConnectionContactsDialog({
  vacancyCompany,
  onClose,
  onChanged,
}: ConnectionContactsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const page = useConnectionContactPages();
  const form = useConnectionContactForm(vacancyCompany);
  const mutations = useConnectionContactMutations({ page, form, onChanged });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const closeDialog = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    else onClose();
  };
  useEscapeLayer(closeDialog);
  return (
    <dialog
      ref={dialogRef}
      className="career-modal-card is-detail career-connection-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <ContactDialogHeader titleId={titleId} onClose={closeDialog} />
      <ContactDialogContent page={page} form={form} mutations={mutations} />
    </dialog>
  );
}

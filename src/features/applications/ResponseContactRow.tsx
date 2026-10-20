import { useEffect, useState, type FormEvent } from 'react';
import { UserCircle } from '@phosphor-icons/react';
import type { ApplicationContact } from './applicationContactApi';

interface ResponseContactRowProps {
  readonly load: () => Promise<ApplicationContact | null>;
  readonly save: (name: string | null) => Promise<ApplicationContact | null>;
}

const SOURCE_LABEL: Record<ApplicationContact['source'], string> = {
  vacancy: 'из вакансии',
  candidate: 'добавлен вами',
};

function useLoadedContact(load: ResponseContactRowProps['load']) {
  const state = useState<ApplicationContact | null | undefined>(undefined);
  const setContact = state[1];
  useEffect(() => {
    let active = true;
    load()
      .then((value) => active && setContact(value))
      .catch(() => active && setContact(null));
    return () => {
      active = false;
    };
  }, [load, setContact]);
  return state;
}

/** Строка досье «Рекрутер»: его называет напоминание на «Сегодня» (B542). */
export function ResponseContactRow({ load, save }: ResponseContactRowProps) {
  const [contact, setContact] = useLoadedContact(load);
  const [draft, setDraft] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (contact === undefined) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setContact(await save(draft?.trim() || null));
      setDraft(null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  if (draft !== null) {
    return (
      <ContactForm
        draft={draft}
        failed={failed}
        onChange={setDraft}
        onSubmit={submit}
        onCancel={() => setDraft(null)}
      />
    );
  }
  return (
    <p className="career-responses-contact">
      <UserCircle aria-hidden="true" />
      <span>
        {contact
          ? `Рекрутер: ${contact.name} · ${SOURCE_LABEL[contact.source]}`
          : 'Рекрутер не указан'}
      </span>
      <button
        type="button"
        className="career-btn is-sm is-ghost"
        onClick={() => setDraft(contact?.source === 'candidate' ? contact.name : '')}
      >
        {!contact ? 'Добавить' : contact.source === 'candidate' ? 'Изменить' : 'Указать другого'}
      </button>
    </p>
  );
}

function ContactForm({
  draft,
  failed,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly draft: string;
  readonly failed: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (event: FormEvent) => Promise<void>;
  readonly onCancel: () => void;
}) {
  return (
    <form className="career-responses-contact" onSubmit={(event) => void onSubmit(event)}>
      <label>
        Имя и фамилия рекрутера
        <input
          className="career-input"
          value={draft}
          maxLength={120}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button type="submit" className="career-btn is-sm">
        Сохранить
      </button>
      <button type="button" className="career-btn is-sm is-ghost" onClick={onCancel}>
        Отмена
      </button>
      {failed ? <p role="alert">Не удалось сохранить контакт. Попробуйте ещё раз.</p> : null}
    </form>
  );
}

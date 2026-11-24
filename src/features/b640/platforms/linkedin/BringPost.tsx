import { useState, type FormEvent } from 'react';
import { Button, StatusLine } from '../../kit';
import { LiError } from './LiError';
import { createFeedPost } from './linkedinQueueApi';
import { draftErrorText } from './useLinkedinDrafts';

type Phase = { readonly kind: 'idle' | 'busy' } | { readonly kind: 'error'; readonly text: string };

function Fields({
  text,
  url,
  setText,
  setUrl,
}: {
  readonly text: string;
  readonly url: string;
  readonly setText: (value: string) => void;
  readonly setUrl: (value: string) => void;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor="fp-text">Текст поста</label>
        <textarea
          id="fp-text"
          rows={4}
          maxLength={3000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="fp-url">Ссылка на пост, если есть</label>
        <input
          id="fp-url"
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
    </>
  );
}

/**
 * Пост приносит кандидат: текст обязателен (по ссылке одной мы пост не читаем), ссылка нужна
 * только для «Открыть в LinkedIn». Автора и причину выбора платформа не придумывает.
 */
export function BringPost({
  onCreated,
  primary = true,
}: {
  readonly onCreated: () => void;
  /** На a05h главная кнопка — «Изменить темы»: здесь обычная, вторую главную макет не допускает. */
  readonly primary?: boolean;
}) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!text.trim()) return;
    setPhase({ kind: 'busy' });
    try {
      await createFeedPost({ text: text.trim(), ...(url.trim() ? { url: url.trim() } : {}) });
      setText('');
      setUrl('');
      setPhase({ kind: 'idle' });
      onCreated();
    } catch (error) {
      setPhase({ kind: 'error', text: draftErrorText(error) });
    }
  }

  return (
    <section className="mod" aria-labelledby="fp-title">
      <h3 className="mod-title" id="fp-title">
        Добавить пост
      </h3>
      <form className="col" onSubmit={(event) => void submit(event)}>
        <Fields text={text} url={url} setText={setText} setUrl={setUrl} />
        {phase.kind === 'error' ? (
          <LiError text={phase.text} onRetry={() => void submit()} />
        ) : null}
        {phase.kind === 'busy' ? <StatusLine state="wait" text="Готовим комментарий…" /> : null}
        <div className="actions">
          <Button
            variant={primary ? 'primary' : 'default'}
            icon="plus"
            type="submit"
            disabled={!text.trim()}
            busy={phase.kind === 'busy'}
          >
            Подготовить комментарий
          </Button>
        </div>
      </form>
    </section>
  );
}

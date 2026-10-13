import { useState, type FormEvent, type ReactElement } from 'react';
import { PaperPlaneRight, Sparkle } from '@phosphor-icons/react';

export interface FirstRunConsultantProps {
  readonly onOpenConsultant: (prompt?: string) => void;
}

const STARTER_PROMPTS = [
  'С чего начать?',
  'Какие источники можно подключить?',
  'Можно без подключений?',
] as const;

function ConsultantStarters({
  onOpenConsultant,
}: FirstRunConsultantProps): ReactElement {
  return (
    <div className="first-run-starters">
      {STARTER_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          className="first-run-starter-btn"
          onClick={() => onOpenConsultant(prompt)}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

function ConsultantComposer({ onOpenConsultant }: FirstRunConsultantProps): ReactElement {
  const [text, setText] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = text.trim();
    if (!prompt) return;
    onOpenConsultant(prompt);
    setText('');
  };

  return (
    <form className="first-run-composer" onSubmit={handleSubmit}>
      <input
        type="text"
        className="first-run-input first-run-composer-input"
        placeholder="Спросите по этому разделу"
        aria-label="Сообщение консультанту"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="submit"
        className="first-run-btn-ghost first-run-composer-send"
        aria-label="Открыть диалог с консультантом"
        disabled={!text.trim()}
      >
        <PaperPlaneRight size={18} />
      </button>
    </form>
  );
}

export function FirstRunConsultant({ onOpenConsultant }: FirstRunConsultantProps): ReactElement {
  return (
    <aside className="first-run-consultant-sidebar" aria-label="Консультант">
      <header className="first-run-consultant-head">
        <span className="first-run-consultant-avatar">
          <Sparkle size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="first-run-consultant-name">Консультант</p>
          <p className="first-run-consultant-scope">Старт</p>
        </div>
      </header>
      <div className="first-run-consultant-thread">
        <p className="first-run-consultant-message">
          Можно подключить LinkedIn или hh.ru, загрузить PDF-резюме либо продолжить с целью и
          контекстом.
        </p>
        <ConsultantStarters onOpenConsultant={onOpenConsultant} />
      </div>
      <ConsultantComposer onOpenConsultant={onOpenConsultant} />
    </aside>
  );
}

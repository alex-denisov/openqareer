import { useState, type ReactElement, type FormEvent } from 'react';
import { Microphone, PaperPlaneRight, Sparkle } from '@phosphor-icons/react';
import { getConsultantReply } from './firstRunStorage';
import type { ConsultantTurn } from './firstRunTypes';

export interface FirstRunConsultantProps {
  readonly turns: readonly ConsultantTurn[];
  readonly onSendTurn: (text: string, isUser: boolean) => void;
  readonly isMobileChat?: boolean;
  readonly onBackFromMobileChat?: () => void;
}

const STARTER_PROMPTS = [
  'С чего начать?',
  'Что вы читаете в LinkedIn?',
  'Можно без LinkedIn?',
] as const;

function ConsultantHeader({
  isMobileChat,
  onBack,
}: {
  readonly isMobileChat: boolean;
  readonly onBack?: () => void;
}): ReactElement {
  return (
    <header className="first-run-consultant-head">
      {isMobileChat && onBack ? (
        <button
          type="button"
          className="first-run-btn-ghost"
          onClick={onBack}
          data-testid="consultant-back-btn"
        >
          Назад
        </button>
      ) : null}
      <div className="first-run-consultant-avatar">
        <Sparkle size={20} />
      </div>
      <div>
        <p className="first-run-consultant-name">Консультант</p>
        <p className="first-run-consultant-scope">Старт · с чего начать</p>
      </div>
    </header>
  );
}

function ConsultantThread({
  turns,
  onPickStarter,
}: {
  readonly turns: readonly ConsultantTurn[];
  readonly onPickStarter: (p: string) => void;
}): ReactElement {
  return (
    <div className="first-run-consultant-thread" data-testid="consultant-thread">
      {turns.map((turn) => (
        <div
          key={turn.id}
          className={`first-run-turn ${turn.isUser ? 'is-user' : 'is-expert'}`}
          data-testid={`consultant-turn-${turn.id}`}
        >
          {turn.text}
        </div>
      ))}
      <div className="first-run-starters">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="first-run-starter-btn"
            onClick={() => onPickStarter(prompt)}
            data-testid={`starter-${prompt}`}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConsultantComposer({
  onSend,
}: {
  readonly onSend: (text: string) => void;
}): ReactElement {
  const [inputText, setInputText] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = inputText.trim();
    if (clean) {
      onSend(clean);
      setInputText('');
    }
  };

  return (
    <form className="first-run-composer" onSubmit={onSubmit}>
      <input
        type="text"
        className="first-run-input"
        style={{ flex: 1 }}
        placeholder="Спросите по этому разделу"
        aria-label="Сообщение консультанту"
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        data-testid="consultant-composer-input"
      />
      <button
        type="button"
        className="first-run-btn-ghost"
        aria-label="Голосовое сообщение"
        data-testid="consultant-mic-btn"
      >
        <Microphone size={18} />
      </button>
      <button
        type="submit"
        className="first-run-btn-primary"
        style={{ padding: '8px 12px' }}
        aria-label="Отправить"
        data-testid="consultant-send-btn"
      >
        <PaperPlaneRight size={18} />
      </button>
    </form>
  );
}

export function FirstRunConsultant({
  turns,
  onSendTurn,
  isMobileChat = false,
  onBackFromMobileChat,
}: FirstRunConsultantProps): ReactElement {
  const handleSend = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    onSendTurn(clean, true);
    const reply = getConsultantReply(clean);
    setTimeout(() => {
      onSendTurn(reply, false);
    }, 50);
  };

  return (
    <aside
      className={isMobileChat ? 'first-run-mobile-chat' : 'first-run-consultant-sidebar'}
      aria-label="Консультант"
      data-testid="first-run-consultant"
    >
      <ConsultantHeader isMobileChat={isMobileChat} onBack={onBackFromMobileChat} />
      <ConsultantThread turns={turns} onPickStarter={handleSend} />
      <ConsultantComposer onSend={handleSend} />
    </aside>
  );
}

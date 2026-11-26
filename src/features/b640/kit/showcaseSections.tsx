import { useCallback, useEffect, useState } from 'react';
import { ActionDock } from './ActionDock';
import { Button } from './Button';
import { Composer } from './Composer';
import { Dialog } from './Dialog';
import { PagedList } from './PagedList';
import { ResultLine, StatusLine } from './ResultLine';
import { SettingsGroup, SettingsRow, Switch } from './Settings';
import { Section } from './Section';
import { useToast } from './Toast';

export function SettingsSection() {
  const [mail, setMail] = useState(true);
  const [push, setPush] = useState(false);
  return (
    <Section name="settings-row" title="Строки настроек">
      <SettingsGroup title="Уведомления">
        <SettingsRow
          id="kit-mail"
          title="Письма об откликах"
          value="m.sokolova@mail.ru · подтверждена"
          end={<Switch labelledBy="kit-mail" checked={mail} onChange={setMail} />}
        />
        <SettingsRow
          id="kit-push"
          title="Сообщения в Telegram"
          end={<Switch labelledBy="kit-push" checked={push} onChange={setPush} />}
        />
      </SettingsGroup>
    </Section>
  );
}

const CONTACTS = Array.from(
  { length: 45 },
  (_, index) => `Роман Лебедев, рекрутер · Контакт ${index + 1}`,
);

export function PagedSection() {
  return (
    <Section name="paged-list" title="Список порциями">
      <PagedList
        items={CONTACTS}
        listClassName="set-list"
        renderItem={(item) => <li className="set-row">{item}</li>}
      />
    </Section>
  );
}

export function ToastSection({ autoOpen }: { autoOpen: boolean }) {
  const toast = useToast();
  const { show: showToast } = toast;
  const show = useCallback(
    () => showToast({ text: 'Скрыто', undo: { label: 'Отменить', onUndo: () => undefined } }),
    [showToast],
  );
  useEffect(() => {
    if (autoOpen) show();
  }, [autoOpen, show]);
  return (
    <Section name="toast" title="Тост с «Отменить»">
      <div className="kit-row">
        <Button onClick={show}>Скрыть вакансию</Button>
      </div>
    </Section>
  );
}

export function ResultSection() {
  const [applied, setApplied] = useState(true);
  return (
    <Section name="result-line" title="Результат и состояние на месте действия">
      {applied ? (
        <ResultLine text="Применено" onUndo={() => setApplied(false)} />
      ) : (
        <ResultLine text="Правка отменена" />
      )}
      <StatusLine state="wait" text="Ждём, не попросит ли работодатель анкету · 0:42" />
      <StatusLine state="ok" text="Отклик отправлен" />
      <StatusLine
        state="err"
        text="Не отправлен · нужен вход в hh.ru"
        action={
          <Button size="sm" icon="out">
            Войти в hh.ru
          </Button>
        }
      />
    </Section>
  );
}

export function DialogSection({ autoOpen }: { autoOpen: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  return (
    <Section name="dialog" title="Окно и нижний лист">
      <div className="kit-row">
        <Button onClick={() => setOpen(true)}>Выбрать резюме</Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Какими резюме откликаться"
        footer={
          <>
            <Button variant="primary" icon="right" onClick={() => setOpen(false)}>
              Продолжить
            </Button>
            <Button onClick={() => setOpen(false)}>Отмена</Button>
          </>
        }
      >
        <div className="kit-dialog-row">
          <div className="pf-f">
            <label htmlFor="kit-d-name">Название</label>
            <input id="kit-d-name" type="text" defaultValue="Руководитель разработки" />
          </div>
          <div className="pf-f">
            <label htmlFor="kit-d-city">Город</label>
            <input id="kit-d-city" type="text" defaultValue="Санкт-Петербург" />
          </div>
        </div>
      </Dialog>
    </Section>
  );
}

/** Витрина: запись «идёт» всегда, кнопки её не меняют. */
const KIT_DICTATION = {
  supported: true,
  recording: true,
  settling: false,
  denied: false,
  start: () => undefined,
  stop: () => undefined,
};

function KitLimitLine() {
  return (
    <>
      <span className="cmp-line-t">
        Лимит сообщений исчерпан ·{' '}
        <span className="cmp-line-d">
          обновится <span className="num">20 ноября</span>
        </span>
      </span>
      <a className="cmp-line-a" href="/app/tariffs">
        Перейти на Basic
      </a>
    </>
  );
}

export type ComposerShowcaseState = 'ask' | 'closed' | 'recording';

function KitComposer({ state, onAsk }: { state: ComposerShowcaseState; onAsk: (t: string) => void }) {
  const [dictated, setDictated] = useState('Из 9 наняла 6, остальные перешли из другой команды.');
  const common = { label: 'Ваш вопрос консультанту', placeholder: 'Спросите своими словами' };
  if (state === 'closed') {
    const dictation = { ...KIT_DICTATION, recording: false };
    return <Composer {...common} onSubmit={onAsk} dictation={dictation} closed={<KitLimitLine />} />;
  }
  if (state === 'recording') {
    return (
      <Composer
        {...common}
        onSubmit={onAsk}
        text={dictated}
        onText={setDictated}
        dictation={KIT_DICTATION}
      />
    );
  }
  return <Composer {...common} onSubmit={onAsk} onVoice={() => Promise.reject(new Error('mic'))} />;
}

/** Панель ввода закреплена внизу; состояние выбирает адрес: `&state=closed`, `&state=recording`. */
export function ComposerSection({ state }: { readonly state: ComposerShowcaseState }) {
  const [asked, setAsked] = useState<string | null>(null);
  return (
    <Section name="composer" title="Панель ввода">
      <div className="chat kit-chat-log" aria-live="polite">
        <p className="msg me">Почему у Ладога Банка 86 %, а у Гринкода только 81?</p>
        <div className="msg bot">
          <p>В Ладога Банке 6 из 7 требований есть в вашем профиле. Не хватает одного.</p>
        </div>
        {asked ? <p className="msg me">{asked}</p> : null}
      </div>
      <div className="kit-chat-dock" data-kit-composer={state}>
        <KitComposer state={state} onAsk={setAsked} />
      </div>
    </Section>
  );
}

export function DockSection({ title }: { readonly title: string }) {
  return (
    <Section name="action-dock" title={title}>
      <ActionDock
        kind="commit"
        primary={
          <Button variant="primary" icon="check">
            Сохранить
          </Button>
        }
        secondary={<Button>Позже</Button>}
      />
    </Section>
  );
}

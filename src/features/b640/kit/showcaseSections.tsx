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
          <Button variant="primary" size="sm" icon="out">
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

export function ComposerSection() {
  const [last, setLast] = useState<string | null>(null);
  return (
    <Section name="composer" title="Панель ввода">
      {last ? <ResultLine text={`Отправлено: ${last}`} /> : null}
      <Composer
        label="Ваш вопрос консультанту"
        placeholder="Спросите своими словами"
        onSubmit={setLast}
        onVoice={() => Promise.reject(new Error('mic'))}
      />
    </Section>
  );
}

export function DockSection() {
  return (
    <Section name="action-dock" title="Закреплённая главная кнопка">
      <div className="kit-dock-stage">
        <ActionDock
          kind="commit"
          primary={
            <Button variant="primary" icon="check">
              Сохранить итог
            </Button>
          }
          secondary={<Button>Позже</Button>}
        />
      </div>
    </Section>
  );
}

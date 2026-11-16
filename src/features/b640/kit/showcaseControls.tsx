import { useState } from 'react';
import { Button } from './Button';
import { InfoTip } from './InfoTip';
import { RowAction } from './RowAction';
import { Section } from './Section';
import { SegControl } from './SegControl';
import { useShell } from '../shell/ShellContext';
import type { B640Theme } from '../theme';

const THEME_OPTIONS: readonly { value: B640Theme; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Системная' },
];

export function TipSection() {
  return (
    <Section name="info-tip" title="Подсказка ⓘ">
      <div className="kit-row">
        <span>Кому представить</span>
        <InfoTip
          label="Кому представить"
          text="Сергею Белову, CTO · Арка Холдинг · интервью 12 ноября"
        />
      </div>
    </Section>
  );
}

export function RowActionSection() {
  return (
    <Section name="row-action" title="Действия в строке">
      <div className="kit-row">
        <RowAction icon="right" href="/app/vacancies">
          Открыть: вакансия
        </RowAction>
        <RowAction icon="copy" small>
          Скопировать
        </RowAction>
        <RowAction icon="eyeoff" neutral>
          Скрыть
        </RowAction>
        <RowAction icon="trash" danger>
          Удалить
        </RowAction>
      </div>
    </Section>
  );
}

export function ButtonSection() {
  return (
    <Section name="buttons" title="Кнопки">
      <div className="kit-row">
        <Button variant="primary" icon="check">
          Сохранить
        </Button>
        <Button>Отмена</Button>
        <Button variant="quiet">Позже</Button>
        <Button size="sm" icon="down">
          Показать ещё
        </Button>
        <Button variant="danger" icon="trash">
          Удалить
        </Button>
        <Button variant="primary" busy>
          Отправляем
        </Button>
      </div>
    </Section>
  );
}

export function FormRowSection() {
  const [kind, setKind] = useState<'remote' | 'office'>('remote');
  return (
    <Section name="form-row" title="Ряд полей">
      <div className="kit-form-row">
        <div className="pf-f">
          <label htmlFor="kit-f-role">Должность</label>
          <input id="kit-f-role" type="text" defaultValue="Руководитель разработки" />
        </div>
        <div className="pf-f">
          <label htmlFor="kit-f-lvl">Уровень</label>
          <select id="kit-f-lvl" defaultValue="lead">
            <option value="mid">Специалист</option>
            <option value="lead">Руководитель</option>
          </select>
        </div>
        <SegControl
          label="Формат работы"
          name="kit-f-kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'remote', label: 'Удалённо' },
            { value: 'office', label: 'В офисе' },
          ]}
        />
      </div>
    </Section>
  );
}

export function ThemeSection() {
  const { theme, setTheme } = useShell();
  return (
    <Section name="theme" title="Тема">
      <SegControl
        label="Тема"
        name="kit-theme"
        value={theme}
        options={THEME_OPTIONS}
        onChange={setTheme}
      />
    </Section>
  );
}

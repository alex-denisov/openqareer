import { useState } from 'react';
import { Icon, Link, useToast } from '../kit';
import { skillCheckPath } from './skillCheckModel';
import { skillStripText } from './rolesModel';

const STORAGE_KEY = 'openqareer.b640.career.skill-strip-hidden';

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Хранилище закрыто: предложение скрыто до перезагрузки страницы.
  }
}

/** Место полосы, пока она читается: таблица ролей под ней не прыгает. */
export function SkillStripPlace() {
  const [hidden] = useState(readHidden);
  if (hidden) return null;
  return (
    <div className="gap-strip sk-strip sk-place" aria-hidden="true">
      <p>{skillStripText(1)}</p>
      <span className="btn">
        <Icon name="checkc" />
        Проверить
      </span>
      <span className="icon-btn sk-x">
        <Icon name="close" />
      </span>
    </div>
  );
}

/** «Проверьте N навыков — точнее подбор»: ведёт в проверку навыков, крестик скрывает. */
export function SkillStrip({ gap, role }: { readonly gap: number; readonly role?: string }) {
  const [hidden, setHidden] = useState(readHidden);
  const toast = useToast();
  if (gap <= 0 || hidden) return null;

  const hide = () => {
    writeHidden(true);
    setHidden(true);
    toast.show({
      text: 'Предложение скрыто',
      undo: {
        label: 'Отменить',
        onUndo: () => {
          writeHidden(false);
          setHidden(false);
        },
      },
    });
  };

  return (
    <section className="gap-strip sk-strip" aria-label="Проверка навыков">
      <p>{skillStripText(gap)}</p>
      <Link className="btn is-primary" to={skillCheckPath(role)}>
        <Icon name="checkc" />
        Проверить
      </Link>
      <button
        className="icon-btn sk-x"
        type="button"
        aria-label="Скрыть предложение"
        onClick={hide}
      >
        <Icon name="close" />
      </button>
    </section>
  );
}

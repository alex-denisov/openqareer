import { useRef, useState } from 'react';
import type { HiddenRow } from '../b640Api';
import { Icon } from '../../kit';
import { safeHttpUrl } from '../format';
import { ErrorLine, MenuButton, useMenuDismiss, useRunner } from './RowMenu';
import { sourceLinkLabel } from '../sourceLinkLabel';

export interface HiddenMenuProps {
  readonly item: HiddenRow;
  readonly onUnhide: () => Promise<void>;
  readonly onClose: () => void;
}

/** Окно действий скрытой строки: «Вернуть в подборку», сайт работодателя, ссылка. */
export function HiddenMenu({ item, onUnhide, onClose }: HiddenMenuProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const runner = useRunner();
  const [copied, setCopied] = useState(false);
  useMenuDismiss(dialog, 'list', onClose);
  const { cluster } = item;
  const href = safeHttpUrl(cluster.primaryUrl);
  const name = `${cluster.canonicalTitle}, ${cluster.canonicalCompany ?? ''}`;
  const copy = () =>
    runner.run(async () => {
      if (!href) throw new Error('У вакансии нет ссылки');
      await navigator.clipboard.writeText(href);
      setCopied(true);
    });
  return (
    <>
      <div className="va-m-back" aria-hidden="true" onClick={onClose} />
      <div ref={dialog} className="va-pop va-m is-list" id={`va-m-${cluster.id}`} role="dialog" tabIndex={-1} aria-label={`Действия: ${name}`}>
        <span className="grab" aria-hidden="true" />
        <ul className="va-m-list">
          <MenuButton icon="undo" label={runner.pending ? 'Возвращаем…' : 'Вернуть в подборку'} disabled={runner.pending} onClick={() => runner.run(onUnhide)} />
          {href ? (
            <li>
              <a className="va-mi" href={href} target="_blank" rel="noopener noreferrer">
                <Icon name="out" />
                {sourceLinkLabel(cluster)}
              </a>
            </li>
          ) : null}
          {href ? <MenuButton icon={copied ? 'check' : 'copy'} label={copied ? 'Ссылка скопирована' : 'Скопировать ссылку'} onClick={copy} /> : null}
        </ul>
        {runner.error ? <ErrorLine text={runner.error} onRetry={runner.retry} /> : null}
      </div>
    </>
  );
}

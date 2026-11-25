import { CtxHead } from './CtxHead';
import { useShell } from './ShellContext';
import { vacancyName } from './vacancyNames';

/** Шапка отклика стоит в пути с первого кадра: путь не перестраивается после загрузки (B798). */
export const CONTEXT_NODES: ReadonlySet<string> = new Set(['o02']);

/** Код отклика ещё грузится: название, известное из списка, стоит с первого кадра (B798). */
export function ScreenLoading({ code }: { readonly code: string }) {
  const { journey } = useShell();
  const vacancy = CONTEXT_NODES.has(code) ? journey?.vacancy : undefined;
  if (!vacancy) return <div className="page b640-loading" aria-busy="true" />;
  return (
    <div className="page two" data-b640-node={code} aria-busy="true">
      <CtxHead kind="Отклик" title={vacancyName(vacancy)} />
      <p className="ls-state" role="status">
        Загружаем отклик…
      </p>
    </div>
  );
}

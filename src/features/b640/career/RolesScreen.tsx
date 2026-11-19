import { useState, type ReactNode } from 'react';
import { useShell } from '../shell/ShellContext';
import { Icon, Link } from '../kit';
import type { B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { loadRoles, loadSkillStrip, type RolesData } from './careerApi';
import { conditionsPath, pageAttrs } from './careerPaths';
import { RolePickDialog } from './RolePickDialog';
import { RoleTable } from './RoleTable';
import { searchStrip } from './rolesModel';
import { SkillStrip } from './SkillStrip';

/** Ожидание и ошибка первого чтения ролей — на месте страницы. */
export function RolesLoad({
  node,
  state,
  children,
}: {
  readonly node: B640Node;
  readonly state?: string;
  readonly children: (data: RolesData, reload: () => void) => ReactNode;
}) {
  const load = useLoad(loadRoles);
  if (load.state === 'ready') return <>{children(load.data, load.retry)}</>;
  return (
    <div className="page" {...pageAttrs(node, state)}>
      {load.state === 'loading' ? (
        <BlockSkeleton label="Подбираем роли" rows={3} />
      ) : (
        <BlockError text="Не удалось загрузить роли." onRetry={load.retry} />
      )}
    </div>
  );
}

function SearchRoleStrip({
  data,
  onEdit,
}: {
  readonly data: RolesData;
  readonly onEdit: () => void;
}) {
  const strip = searchStrip(data.searchTitles, data.selectionTotal);
  return (
    <section className="role-strip" aria-labelledby="role-title">
      <p className="role-strip-t">
        <span className="role-strip-k">Роль поиска</span>
        <span className="role-strip-r" role="heading" aria-level={2} id="role-title">
          {strip?.title ?? 'не выбрана'}
        </span>
        {strip?.count ? <span className="role-strip-n num">{strip.count}</span> : null}
      </p>
      <button className="row-act role-strip-b" type="button" onClick={onEdit}>
        <Icon name="edit" />
        {strip ? 'Изменить' : 'Выбрать'}
      </button>
    </section>
  );
}

/** Полоса «Проверьте N навыков» читается отдельно: таблица ролей её не ждёт. */
function SkillStripLoad() {
  const strip = useLoad(loadSkillStrip);
  if (strip.state !== 'ready' || !strip.data) return null;
  return <SkillStrip gap={strip.data.gap} role={strip.data.role} />;
}

/** S9 «Карьера» при «Ищу работу»: роль поиска, проверка навыков, роли по профилю. */
export function RolesView({ node, data }: { readonly node: B640Node; readonly data: RolesData }) {
  const { search } = useShell();
  // «Выбрать роль» из проверки навыков открывает выбор роли поиска сразу (B645).
  const [picking, setPicking] = useState(() => new URLSearchParams(search).get('pick') === '1');
  return (
    <div className="page" {...pageAttrs(node)}>
      <SearchRoleStrip data={data} onEdit={() => setPicking(true)} />
      <SkillStripLoad />
      <RoleTable rows={data.rows} />
      <Link className="row-act is-sm" to={conditionsPath()}>
        <Icon name="sliders" />
        Условия поиска
      </Link>
      {picking ? (
        <RolePickDialog
          open
          onClose={() => setPicking(false)}
          rows={data.rows}
          campaign={data.campaign}
        />
      ) : null}
    </div>
  );
}

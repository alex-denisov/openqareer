import type { B640Node } from '../routes';
import { BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { loadStatusId } from './careerApi';
import { CompareView } from './CompareView';
import { pageAttrs } from './careerPaths';
import { RolesLoad, RolesView } from './RolesScreen';

/**
 * Корень «Карьеры» по статусу кандидата (B665): «Ищу, кем работать» — сравнение ролей (s10),
 * остальные — роль поиска и роли по профилю (s09).
 */
export function CareerRoot({ node }: { readonly node: B640Node }) {
  const status = useLoad(loadStatusId);
  if (status.state !== 'ready') {
    return (
      <div className="page" {...pageAttrs(node)}>
        <BlockSkeleton label="Подбираем роли" rows={3} />
      </div>
    );
  }
  if (status.data === 'choosing_role') {
    return (
      <RolesLoad node={node} state="s10">
        {(data, reload) => <CompareView node={node} state="s10" data={data} reload={reload} />}
      </RolesLoad>
    );
  }
  return <RolesLoad node={node}>{(data) => <RolesView node={node} data={data} />}</RolesLoad>;
}

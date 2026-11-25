import type { B640Node } from '../routes';
import { SECTION_CACHE_KEYS } from '../../shell/sectionCache';
import { BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { loadStatusId } from './careerApi';
import { CompareView } from './CompareView';
import { pageAttrs } from './careerPaths';
import { GrowthScreen } from './GrowthScreen';
import { ProfessionScreen } from './ProfessionScreen';
import { RolesLoad, RolesView } from './RolesScreen';

/**
 * Корень «Карьеры» по статусу кандидата (B665): «Ищу, кем работать» — сравнение ролей (s10),
 * «Меняю профессию» — путь в профессию (s11), «Работаю» — цель роста (s12), остальные — роль поиска и роли по профилю (s09).
 */
export function CareerRoot({ node }: { readonly node: B640Node }) {
  const status = useLoad(loadStatusId, SECTION_CACHE_KEYS.careerStatus);
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
  if (status.data === 'changing_profession') return <ProfessionScreen node={node} state="s11" />;
  if (status.data === 'working') return <GrowthScreen node={node} />;
  return <RolesView node={node} />;
}

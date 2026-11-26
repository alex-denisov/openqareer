import { startEarlyRead } from '../../shell/earlyRead';
import { NodeStub } from '../shell/NodeStub';
import { useShell } from '../shell/ShellContext';
import type { SectionProps } from '../sections';
import './career.css';
import { CareerRoot } from './CareerRoot';
import { loadCampaign, loadRoles, loadStatusId } from './careerApi';
import { isConditionsView } from './careerPaths';
import { CompareView } from './CompareView';
import { ConditionsScreen } from './ConditionsScreen';
import { GrowthScreen } from './GrowthScreen';
import { RelocationScreen } from './RelocationScreen';
import { RolesLoad } from './RolesScreen';
import { ProfessionScreen } from './ProfessionScreen';
import { SkillCheckScreen } from './SkillCheckScreen';
import { useB640Title } from '../kit/useB640Title';

/** B792: статус, роль поиска и роли — рядом с вопросом о сессии, а не друг за другом. */
export function preload(code: string, search: string): void {
  if (code === 's09' && !isConditionsView(search)) {
    startEarlyRead(loadStatusId);
    startEarlyRead(loadCampaign);
    startEarlyRead(loadRoles);
  }
  if (code === 's10') startEarlyRead(loadRoles);
}

/** Вход раздела «Карьера»: экран по коду узла (см. ../README.md). */
export default function Section({ node }: SectionProps) {
  useB640Title('Карьера');
  const { search } = useShell();
  if (node.code === 's09') {
    return isConditionsView(search) ? <ConditionsScreen node={node} /> : <CareerRoot node={node} />;
  }
  if (node.code === 's10') {
    return (
      <RolesLoad node={node}>
        {(data, reload) => <CompareView node={node} data={data} reload={reload} />}
      </RolesLoad>
    );
  }
  if (node.code === 's11') return <ProfessionScreen node={node} />;
  if (node.code === 's12') return <GrowthScreen node={node} />;
  if (node.code === 'c04') return <SkillCheckScreen node={node} />;
  if (node.code === 'c06') return <RelocationScreen node={node} />;
  return <NodeStub node={node} />;
}

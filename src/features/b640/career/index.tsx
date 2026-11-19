import { NodeStub } from '../shell/NodeStub';
import { useShell } from '../shell/ShellContext';
import type { SectionProps } from '../sections';
import './career.css';
import { CareerRoot } from './CareerRoot';
import { isConditionsView } from './careerPaths';
import { CompareView } from './CompareView';
import { ConditionsScreen } from './ConditionsScreen';
import { GrowthScreen } from './GrowthScreen';
import { RolesLoad } from './RolesScreen';
import { ProfessionScreen } from './ProfessionScreen';
import { SkillCheckScreen } from './SkillCheckScreen';

/** Вход раздела «Карьера»: экран по коду узла (см. ../README.md). */
export default function Section({ node }: SectionProps) {
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
  return <NodeStub node={node} />;
}

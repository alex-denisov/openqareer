import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ProfileScreen } from './ProfileScreen';
import { StatusChoiceScreen } from './StatusChoiceScreen';

/** Вход раздела «Профиль»: экран по коду узла (см. ../README.md). */
export default function Section({ node }: SectionProps) {
  if (node.code === 's01') return <ProfileScreen node={node} />;
  if (node.code === 's02') return <StatusChoiceScreen node={node} />;
  return <NodeStub node={node} />;
}

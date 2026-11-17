import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { StatusChoiceScreen } from './StatusChoiceScreen';

/** Вход раздела «Профиль»: экран по коду узла (см. ../README.md). */
export default function Section({ node }: SectionProps) {
  if (node.code === 's02') return <StatusChoiceScreen node={node} />;
  return <NodeStub node={node} />;
}

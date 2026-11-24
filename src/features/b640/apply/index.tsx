import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ApplyScreen } from './ApplyScreen';
import './apply.css';
import './resume.css';
import { useB640Title } from '../kit/useB640Title';

/** Вход раздела «Отклик»: единый экран отклика (см. ../README.md). */
export default function Section({ node, params }: SectionProps) {
  useB640Title('Отклики');
  if (node.code === 'o02' && params.responseId)
    return <ApplyScreen responseId={params.responseId} />;
  return <NodeStub node={node} />;
}

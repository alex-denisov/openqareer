import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';

/**
 * Вход раздела. Пока здесь заглушка: экран каждого узла раздела подключается
 * в этом каталоге по `node.code` (см. ../README.md).
 */
export default function Section({ node }: SectionProps) {
  return <NodeStub node={node} />;
}

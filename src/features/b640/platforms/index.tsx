import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ContactsScreen } from './contacts/ContactsScreen';

/** Вход раздела платформ: «Контакты» (a02); остальные узлы пока заглушки. */
export default function Section({ node }: SectionProps) {
  if (node.code === 'a02') return <ContactsScreen />;
  return <NodeStub node={node} />;
}

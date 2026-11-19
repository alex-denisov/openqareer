import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ContactsScreen } from './contacts/ContactsScreen';
import { HhScreen } from './hh/HhScreen';
import { JournalScreen } from './journal/JournalScreen';

/** Вход раздела: экран каждого узла подключается здесь по `node.code`. */
export default function Section(props: SectionProps) {
  const { node } = props;
  if (node.code === 'a02') return <ContactsScreen />;
  if (node.code === 'a11') return <HhScreen {...props} />;
  if (node.code === 'a05c') return <JournalScreen {...props} />;
  return <NodeStub node={node} />;
}

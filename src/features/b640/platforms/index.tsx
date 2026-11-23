import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { ContactsScreen } from './contacts/ContactsScreen';
import { HhScreen } from './hh/HhScreen';
import { JournalScreen } from './journal/JournalScreen';
import { FeedScreen } from './linkedin/FeedScreen';
import { PostsScreen } from './linkedin/PostsScreen';
import { ProfileScreen } from './linkedin/ProfileScreen';
import { PublishedScreen } from './linkedin/PublishedScreen';
import { useB640Title } from '../kit/useB640Title';

/** Вход раздела: экран каждого узла подключается здесь по `node.code`. */
export default function Section(props: SectionProps) {
  useB640Title('Профиль');
  const { node } = props;
  if (node.code === 'a02') return <ContactsScreen />;
  if (node.code === 'a11') return <HhScreen {...props} />;
  if (node.code === 'a05c') return <JournalScreen {...props} />;
  if (node.code === 'a03') return <ProfileScreen {...props} />;
  if (node.code === 'a03b') return <PostsScreen {...props} />;
  if (node.code === 'a03p') return <PublishedScreen {...props} />;
  if (node.code === 'a05') return <FeedScreen {...props} />;
  return <NodeStub node={node} />;
}

import type { SectionProps } from '../sections';
import { NodeStub } from '../shell/NodeStub';
import { ConnectionsScreen } from './ConnectionsScreen';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { SectionsScreen } from './SectionsScreen';
import { SecurityScreen } from './SecurityScreen';

/** Вход раздела «Аккаунт»: экран по коду узла (B661). */
export default function Section({ node }: SectionProps) {
  if (node.code === 'n00') return <SectionsScreen node={node} />;
  if (node.code === 'n03') return <ConnectionsScreen node={node} />;
  if (node.code === 'n02') return <NotificationSettingsScreen node={node} />;
  if (node.code === 'n04') return <SecurityScreen node={node} />;
  return <NodeStub node={node} />;
}

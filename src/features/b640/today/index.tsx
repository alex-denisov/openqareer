import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { NotificationsScreen } from './NotificationsScreen';
import { TodayScreen } from './TodayScreen';

/** Вход раздела «Сегодня и уведомления»: экран по коду узла (см. ../README.md). */
export default function Section({ node }: SectionProps) {
  if (node.code === 's03') return <TodayScreen node={node} />;
  if (node.code === 'n01b') return <NotificationsScreen node={node} />;
  return <NodeStub node={node} />;
}

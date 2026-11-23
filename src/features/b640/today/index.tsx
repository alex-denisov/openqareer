import { NodeStub } from '../shell/NodeStub';
import { useShell } from '../shell/ShellContext';
import type { SectionProps } from '../sections';
import { NotificationsScreen } from './NotificationsScreen';
import { TodayScreen } from './TodayScreen';
import { useB640Title } from '../kit/useB640Title';

/**
 * Заголовок вкладки: адреса консультанта открывают панель над «Сегодня», но вкладка
 * называет консультанта (B772).
 */
export function todayTitle(code: string, consultantOpen: boolean): string {
  if (consultantOpen) return 'Консультант';
  return code === 'n01b' ? 'Уведомления' : 'Сегодня';
}

/** Вход раздела «Сегодня и уведомления»: экран по коду узла (см. ../README.md). */
export default function Section({ node }: SectionProps) {
  const { consultantRoute } = useShell();
  useB640Title(todayTitle(node.code, consultantRoute !== null));
  if (node.code === 's03') return <TodayScreen node={node} />;
  if (node.code === 'n01b') return <NotificationsScreen node={node} />;
  return <NodeStub node={node} />;
}

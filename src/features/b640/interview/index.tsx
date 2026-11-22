import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { DebriefScreen } from './DebriefScreen';
import { MockScreen } from './MockScreen';
import { PracticeScreen } from './PracticeScreen';
import { PrepScreen } from './PrepScreen';

/** Вход раздела «Подготовка»: I1 — подготовка к интервью (I1d — интервью ещё не записано), I2 — пробное интервью, I3 — тренировка System Design. */
export default function Section({ node, params }: SectionProps) {
  switch (node.code) {
    case 'i01':
      return <PrepScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i02':
      return <MockScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
<<<<<<< HEAD
    case 'i03':
      return <PracticeScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
=======
    case 'i04':
      return <DebriefScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
>>>>>>> 21660d3c8 (feat(b751): экран i04 «Разбор после интервью» — меры, вопросы с цитатами, расшифровка, договорённости, заметки)
    default:
      return <NodeStub node={node} />;
  }
}

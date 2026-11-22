import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { DebriefScreen } from './DebriefScreen';
import { MockScreen } from './MockScreen';
import { PracticeScreen } from './PracticeScreen';
import { PrepScreen } from './PrepScreen';
import { RecordScreen } from './RecordScreen';
import { UploadScreen } from './UploadScreen';

/** Вход раздела «Подготовка»: I1 — подготовка к интервью (I1d — интервью ещё не записано), I2 — пробное интервью, I3 — тренировка System Design, I4 — разбор после интервью (I4b — запись, I4c — файл). */
export default function Section({ node, params }: SectionProps) {
  switch (node.code) {
    case 'i01':
      return <PrepScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i02':
      return <MockScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i03':
      return <PracticeScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i04':
      return <DebriefScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i04b':
      return <RecordScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i04c':
      return <UploadScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    default:
      return <NodeStub node={node} />;
  }
}

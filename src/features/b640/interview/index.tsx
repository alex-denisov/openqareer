import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { DebriefScreen } from './DebriefScreen';
import { MockScreen } from './MockScreen';
import { PracticeScreen } from './PracticeScreen';
import { PrepScreen } from './PrepScreen';
import { RecordScreen } from './RecordScreen';
import { UploadScreen } from './UploadScreen';
import { useInterviewRecording } from '../voice/recordingFeature';
import { useB640Title } from '../kit/useB640Title';

/** Вход раздела «Подготовка»: I1 — подготовка к интервью (I1d — интервью ещё не записано), I2 — пробное интервью, I3 — тренировка System Design, I4 — разбор после интервью (I4b — запись, I4c — файл). */
export default function Section({ node, params }: SectionProps) {
  useB640Title('Отклики');
  switch (node.code) {
    case 'i01':
      return <PrepScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i02':
      return <MockScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i03':
      return <PracticeScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
    case 'i04':
    case 'i04b':
    case 'i04c':
      return <DebriefSection node={node} params={params} />;
    default:
      return <NodeStub node={node} />;
  }
}

const DEBRIEF_SCREENS = { i04: DebriefScreen, i04b: RecordScreen, i04c: UploadScreen } as const;

/** I4: пока сервер не записывает разговоры (до редакции 1.3), экраны разбора не открываются. */
function DebriefSection({ node, params }: SectionProps) {
  const recording = useInterviewRecording();
  if (recording === null) return null;
  const Screen = DEBRIEF_SCREENS[node.code as keyof typeof DEBRIEF_SCREENS];
  if (!recording || !Screen) return <NodeStub node={node} />;
  return <Screen key={params.responseId} responseId={params.responseId ?? 'next'} />;
}

import { NodeStub } from '../shell/NodeStub';
import type { SectionProps } from '../sections';
import { DebriefScreen } from './DebriefScreen';
import { MockScreen } from './MockScreen';
import { PracticeScreen } from './PracticeScreen';
import { PrepScreen } from './PrepScreen';
import { RecordScreen } from './RecordScreen';
import { UploadScreen } from './UploadScreen';

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
<<<<<<< HEAD
>>>>>>> 21660d3c8 (feat(b751): экран i04 «Разбор после интервью» — меры, вопросы с цитатами, расшифровка, договорённости, заметки)
=======
    case 'i04b':
      return <RecordScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
<<<<<<< HEAD
>>>>>>> 443950ab3 (feat(b751): i04b — запись интервью в приложении по контракту D2: разрешения, индикатор, сбой с продолжением)
=======
    case 'i04c':
      return <UploadScreen key={params.responseId} responseId={params.responseId ?? 'next'} />;
>>>>>>> 3fef18444 (feat(b751): i04c — загрузка файла записи: моно 16 кГц, куски WAV по 5 минут, имя собеседника)
    default:
      return <NodeStub node={node} />;
  }
}

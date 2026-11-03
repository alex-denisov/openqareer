import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CoachTurnStage } from '../coach/coachApi';

/**
 * Тема текущей вкладки для консультанта: первая реплика и вопросы-подсказки.
 * Раздел «Отклики» одним этапом `responses` покрывает четыре вкладки; без темы
 * «Хочу», «Подготовка» и «Офферы» показывали вступление и вопросы «Воронки»
 * (B511 G3b п. 3). Тема живёт отдельно от предложения экрана: после «Добавить»
 * или «Не сейчас» предложение уходит, а вопросы вкладки остаются.
 */
export interface ConsultantScreenTopic {
  readonly id: string;
  readonly stages: readonly CoachTurnStage[];
  readonly intro: string;
  readonly prompts: readonly string[];
}

interface TopicStore {
  readonly topic: ConsultantScreenTopic | null;
  readonly publish: (topic: ConsultantScreenTopic | null, ownerId: string) => void;
}

const TopicContext = createContext<TopicStore>({ topic: null, publish: () => undefined });

export function ConsultantTopicProvider({ children }: { readonly children: ReactNode }) {
  const [published, setPublished] = useState<{
    readonly ownerId: string;
    readonly topic: ConsultantScreenTopic;
  } | null>(null);
  const publish = useCallback((topic: ConsultantScreenTopic | null, ownerId: string) => {
    setPublished((current) => {
      if (topic) return { ownerId, topic };
      return current?.ownerId === ownerId ? null : current;
    });
  }, []);
  const value = useMemo(() => ({ topic: published?.topic ?? null, publish }), [published, publish]);
  return <TopicContext.Provider value={value}>{children}</TopicContext.Provider>;
}

let nextOwnerId = 0;

/** Вкладка публикует тему, пока смонтирована; `null` — общая тема этапа. */
export function usePublishConsultantTopic(topic: ConsultantScreenTopic | null) {
  const { publish } = useContext(TopicContext);
  const ownerId = useRef('');
  if (!ownerId.current) ownerId.current = `topic-${(nextOwnerId += 1)}`;
  useEffect(() => {
    const owner = ownerId.current;
    publish(topic, owner);
    return () => publish(null, owner);
  }, [publish, topic]);
}

export function useConsultantScreenTopic(stage: CoachTurnStage): ConsultantScreenTopic | null {
  const { topic } = useContext(TopicContext);
  return topic && topic.stages.includes(stage) ? topic : null;
}

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
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';

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

/**
 * Объект, открытый на экране: письмо, строка вакансии, отклик. Живёт отдельно от темы:
 * вкладка задаёт разговор, объект — о чём именно ход. Без него на письме панель просила
 * «выбрать вакансию», а ход уходил без неё (B511 Д5).
 */
export interface ConsultantScreenObject {
  readonly id: string;
  readonly stages: readonly CoachTurnStage[];
  readonly subject: CoachTurnSubject;
  /** Экран занят объектом целиком: прежний объект панели уже неверен. */
  readonly fillsScreen?: boolean;
  readonly sendsLetterDraft?: boolean;
  readonly intro?: string;
  readonly prompts?: readonly string[];
  readonly placeholder?: string;
}

type Slot<T> = { readonly ownerId: string; readonly value: T } | null;

function nextSlot<T>(current: Slot<T>, value: T | null, ownerId: string): Slot<T> {
  if (value) return { ownerId, value };
  return current?.ownerId === ownerId ? null : current;
}

interface TopicStore {
  readonly topic: ConsultantScreenTopic | null;
  readonly publish: (topic: ConsultantScreenTopic | null, ownerId: string) => void;
  readonly object: ConsultantScreenObject | null;
  readonly publishObject: (object: ConsultantScreenObject | null, ownerId: string) => void;
  /** Текст письма читается при отправке: панели незачем перерисовываться на каждый символ. */
  readonly letterDraft: { current: string };
}

const TopicContext = createContext<TopicStore>({
  topic: null,
  publish: () => undefined,
  object: null,
  publishObject: () => undefined,
  letterDraft: { current: '' },
});

export function ConsultantTopicProvider({ children }: { readonly children: ReactNode }) {
  const [published, setPublished] = useState<Slot<ConsultantScreenTopic>>(null);
  const [publishedObject, setPublishedObject] = useState<Slot<ConsultantScreenObject>>(null);
  const letterDraft = useRef('');
  const publish = useCallback((topic: ConsultantScreenTopic | null, ownerId: string) => {
    setPublished((current) => nextSlot(current, topic, ownerId));
  }, []);
  const publishObject = useCallback((object: ConsultantScreenObject | null, ownerId: string) => {
    setPublishedObject((current) => nextSlot(current, object, ownerId));
  }, []);
  const value = useMemo(
    () => ({
      topic: published?.value ?? null,
      publish,
      object: publishedObject?.value ?? null,
      publishObject,
      letterDraft,
    }),
    [published, publish, publishedObject, publishObject],
  );
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

/** Экран публикует объект, пока смонтирован; значение должно быть стабильным между рендерами. */
export function usePublishConsultantObject(object: ConsultantScreenObject | null) {
  const { publishObject } = useContext(TopicContext);
  const ownerId = useRef('');
  if (!ownerId.current) ownerId.current = `object-${(nextOwnerId += 1)}`;
  useEffect(() => {
    const owner = ownerId.current;
    publishObject(object, owner);
    return () => publishObject(null, owner);
  }, [publishObject, object]);
}

export function useConsultantScreenObject(stage: CoachTurnStage): ConsultantScreenObject | null {
  const { object } = useContext(TopicContext);
  return object && object.stages.includes(stage) ? object : null;
}

export function usePublishConsultantLetterDraft(text: string) {
  const { letterDraft } = useContext(TopicContext);
  useEffect(() => {
    letterDraft.current = text;
  }, [letterDraft, text]);
  useEffect(
    () => () => {
      letterDraft.current = '';
    },
    [letterDraft],
  );
}

export function useConsultantLetterDraft(): () => string {
  const { letterDraft } = useContext(TopicContext);
  return useCallback(() => letterDraft.current, [letterDraft]);
}

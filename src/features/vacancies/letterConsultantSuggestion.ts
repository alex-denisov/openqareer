import { useEffect, useState } from 'react';
import type { StarStoryView } from '../../../shared/starStories';
import { getStarStories } from '../interview/starStoriesApi';
import {
  usePublishConsultantSuggestion,
  type ConsultantScreenSuggestion,
} from '../journey/consultantScreenSuggestion';

export interface LetterStarEdit {
  readonly storyId: string;
  readonly storyTitle: string;
  readonly sentence: string;
}

const CYRILLIC = /[а-яё]/i;

function normalize(text: string): string {
  return text
    .toLocaleLowerCase('ru-RU')
    .replace(/[«»"“”.,;:!?—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asSentence(result: string): string {
  const trimmed = result.trim().replace(/\s+/g, ' ');
  const capital = trimmed.charAt(0).toLocaleUpperCase('ru-RU') + trimmed.slice(1);
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * Макет 9: правка письма из подтверждённой STAR-истории, результата которой ещё нет в тексте.
 * Ничего не сочиняем: фраза — это результат истории, как его записал кандидат, а
 * «подтверждена» значит, что числа результата есть в связанных фактах профиля.
 */
export function letterStarEdit(
  letterText: string,
  stories: readonly StarStoryView[],
): LetterStarEdit | null {
  const text = normalize(letterText);
  if (!text) return null;
  const letterIsRussian = CYRILLIC.test(letterText);
  const candidate = [...stories]
    .filter((story) => story.confidence === 'confirmed' && story.fields.result.trim())
    .filter((story) => CYRILLIC.test(story.fields.result) === letterIsRussian)
    .filter((story) => !text.includes(normalize(story.fields.result)))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  if (!candidate) return null;
  return {
    storyId: candidate.id,
    storyTitle: candidate.title.trim() || 'STAR-история',
    sentence: asSentence(candidate.fields.result),
  };
}

/** Новая фраза встаёт отдельным абзацем перед подписью; у письма из одного абзаца — в конец. */
export function applyLetterStarEdit(letterText: string, sentence: string): string {
  const paragraphs = letterText.trimEnd().split(/\n\s*\n/);
  if (paragraphs.length < 2) return `${letterText.trimEnd()} ${sentence}`;
  return [...paragraphs.slice(0, -1), sentence, paragraphs[paragraphs.length - 1]].join('\n\n');
}

export function letterConsultantSuggestion(
  edit: LetterStarEdit,
  onAccept: () => void,
): ConsultantScreenSuggestion {
  return {
    id: `letter-star:${edit.storyId}`,
    stages: ['vacancies'],
    title: `Добавить фразу про «${edit.storyTitle}»`,
    detail: `«${edit.sentence}» Источник: STAR-история, подтверждена фактами профиля.`,
    acceptLabel: 'Принять',
    dismissLabel: 'Отклонить',
    onAccept,
  };
}

interface LetterDraftPort {
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly loading: boolean;
}

/** Тонкая связка экрана «Письмо» с панелью: правка применяется к черновику на экране. */
export function useLetterConsultantSuggestion(draft: LetterDraftPort, frozen: boolean): void {
  const [stories, setStories] = useState<readonly StarStoryView[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void getStarStories(controller.signal)
      .then((snapshot) => setStories(snapshot.stories))
      // Без историй предложить нечего: панель остаётся в общем состоянии.
      .catch(() => setStories([]));
    return () => controller.abort();
  }, []);
  const edit = frozen || draft.loading ? null : letterStarEdit(draft.text, stories);
  usePublishConsultantSuggestion(
    edit
      ? letterConsultantSuggestion(edit, () =>
          draft.setText(applyLetterStarEdit(draft.text, edit.sentence)),
        )
      : null,
  );
}

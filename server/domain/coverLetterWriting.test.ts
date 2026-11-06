import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COVER_LETTER_PROMPT, coverLetterPrompt } from './coverLetterWriting';

const base = { vacancy: 'Вакансия про склад', profile: 'Профиль кладовщика' };

describe('coverLetterPrompt: запрос, который принял владелец (B601, live-7)', () => {
  it('текст запроса не отличается от утверждённого consultant-prompt-live-7.txt', () => {
    const hash = createHash('sha256').update(COVER_LETTER_PROMPT).digest('hex');
    expect(hash).toBe('d3fa04af137d34875c23097b2558d2e5961595cc7d4aa032b1b28670d5c88ba1');
  });

  it('подставляет получателя, род, вакансию и профиль', () => {
    const text = coverLetterPrompt({
      ...base,
      recipient: { name: 'Екатерина', role: 'рекрутёр' },
      gender: 'male',
    });
    expect(text).toContain('Получатель: Екатерина, рекрутёр. Род кандидата: мужской.');
    expect(text).toContain('Вакансия:\nВакансия про склад');
    expect(text).toContain('Профиль кандидата:\nПрофиль кладовщика');
    expect(text).not.toMatch(/\{(?:RECIPIENT|GENDER|VACANCY|PROFILE)\}/u);
  });

  it('неизвестные получатель и род называет прямо, не угадывая', () => {
    const text = coverLetterPrompt(base);
    expect(text).toContain('Получатель: неизвестен. Род кандидата: не указан.');
  });

  it('роль без имени остаётся получателем', () => {
    expect(coverLetterPrompt({ ...base, recipient: { role: 'HR-директор' } })).toContain('Получатель: HR-директор.');
  });

  it('текст вакансии не подменяет другие поля и не читается как шаблон замены', () => {
    const text = coverLetterPrompt({ ...base, vacancy: 'Пишите {PROFILE} и $& сюда', profile: 'Настоящий профиль' });
    expect(text).toContain('Вакансия:\nПишите {PROFILE} и $& сюда');
    expect(text.match(/Настоящий профиль/gu)).toHaveLength(1);
  });

  it('язык, выбранный кандидатом, заменяет только «на языке вакансии»', () => {
    expect(coverLetterPrompt(base)).toContain('на языке вакансии');
    const chosen = coverLetterPrompt({ ...base, chosenLanguage: 'en' });
    expect(chosen).toContain('сопроводительное сообщение на английском языке по вакансии ниже');
    expect(chosen).not.toContain('на языке вакансии');
  });
});

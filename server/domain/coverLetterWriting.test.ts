import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COVER_LETTER_PROMPT, coverLetterPrompt } from './coverLetterWriting';

const base = { vacancy: 'Вакансия про склад', profile: 'Профиль кладовщика' };

describe('coverLetterPrompt: запрос, который принял владелец (B601, live-7)', () => {
  it('текст запроса: live-7 и правка длины B639 (150–180 слов, два-три места работы, короче при нехватке фактов)', () => {
    const hash = createHash('sha256').update(COVER_LETTER_PROMPT).digest('hex');
    expect(hash).toBe('257eef537a4d41cab2eb36dafc1c98ce86a5865de521396e4c47f4689371c3b3');
  });

  it('B639: работа в компании вакансии или её группе — во вводном абзаце сверх длины и числа мест', () => {
    const prompt = coverLetterPrompt({ ...base, companyLink: 'Корпоративный университет Сбера' });
    expect(prompt).toContain(
      'Кандидат работал в «Корпоративный университет Сбера»: это та же компания, что в вакансии, или её группа.',
    );
    expect(prompt).toContain('даже если письмо выйдет длиннее 180 слов или мест работы станет больше');
    expect(prompt.indexOf('Корпоративный университет Сбера')).toBeLessThan(prompt.indexOf('Вакансия:'));
    expect(coverLetterPrompt(base)).not.toContain('Кандидат работал в «');
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
    expect(text).toContain('Получатель: неизвестен. Род кандидата: не указан, пиши так, чтобы род кандидата не был виден.');
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

describe('coverLetterPrompt: опыта нет, резюме не приложится (B601, 08.11)', () => {
  const input = { vacancy: 'Platform Engineer', profile: 'Курс по Kubernetes.' };

  it('не просит сказать, что резюме приложено, и прямо запрещает упоминать его', () => {
    const prompt = coverLetterPrompt({ ...input, resumeAttached: false });
    expect(prompt).not.toMatch(/Резюме приложено к этому сообщению|скажи, что резюме приложено/u);
    expect(prompt).toContain('Резюме к сообщению не приложено, не упоминай его.');
    expect(prompt).toContain('В конце вежливо предложи обсудить');
  });

  it('с резюме запрос прежний, дословно утверждённый', () => {
    expect(coverLetterPrompt({ ...input, resumeAttached: true })).toBe(coverLetterPrompt(input));
    expect(coverLetterPrompt(input)).toContain('В конце скажи, что резюме приложено');
  });
});

describe('coverLetterPrompt: имя для подписи на языке письма (B624, 09.11)', () => {
  const input = { vacancy: 'Head of Data, Сбер', profile: 'Руководил данными.' };

  it('с именем просит вернуть его отдельной последней строкой на языке сообщения', () => {
    const prompt = coverLetterPrompt({ ...input, candidateName: 'Alexey Denisov' });
    expect(prompt).not.toContain('Верни только текст сообщения.');
    expect(prompt).toMatch(/Имя для подписи: .*Alexey Denisov.*на языке сообщения/su);
    expect(prompt.endsWith('.')).toBe(true);
  });

  it('без имени запрос прежний, дословно утверждённый', () => {
    expect(coverLetterPrompt({ ...input, candidateName: '  ' })).toBe(coverLetterPrompt(input));
    expect(coverLetterPrompt(input)).toContain('Верни только текст сообщения.');
  });
});

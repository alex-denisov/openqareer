import { describe, expect, it } from 'vitest';
import { vacancyAbout } from './resumeAbout';

const ABOUT = [
  'I build technology organizations that drive revenue — not just support the business.',
  'Over 15+ years, I have led IT and SaaS operations. My expertise combines P&L ownership with hands-on AI.',
  '🏆 KEY EXECUTIVE HIGHLIGHTS:',
  '• $90M Exit: Co-founded Seafarm (Malaysia) and scaled it from $50K. Built operations across 20 farms.',
  '• Growth: Restructured two divisions at Energo Digital, growing revenue from RUB 100M to RUB 300M',
  '💻 CORE COMPETENCIES:',
  'Leadership | P&L | ITIL 4 & DevOps',
  'Open to VP of Technology, VP of Operations, CTO, or COO roles in SaaS or AI scale-ups.',
  '📍 Dubai-based | Available for Global Remote & Executive Relocation.',
  '📫 Contact: a@b.example | Telegram: @mila_example',
].join('\n');

describe('«О себе» в резюме под вакансию', () => {
  const about = vacancyAbout(ABOUT);

  it('без эмодзи, заголовков, поиска работы и контактов', () => {
    expect(about).not.toMatch(
      /\p{Extended_Pictographic}|HIGHLIGHTS|COMPETENCIES|Open to|Available|@|\||•|\n/u,
    );
  });

  it('3–5 дословных предложений, не длиннее 700 знаков', () => {
    expect(about.length).toBeLessThanOrEqual(700);
    const sentences = about.split(/(?<=\.)\s+(?=[A-Z$])/u);
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    expect(sentences.length).toBeLessThanOrEqual(5);
    for (const sentence of sentences) expect(ABOUT).toContain(sentence.replace(/\.$/u, ''));
    expect(about).toContain('$90M Exit: Co-founded Seafarm');
  });

  it('русский текст: строки поиска и контактов уходят, факты остаются', () => {
    expect(
      vacancyAbout(
        '🚀 Руковожу поддержкой 10 лет.\nИщу позицию CIO.\nОткрыт к предложениям.\nГотов к переезду.\nПочта: a@b.example',
      ),
    ).toBe('Руковожу поддержкой 10 лет.');
    expect(vacancyAbout('Ищу работу')).toBe('');
  });

  it('перенос внутри фразы её не рвёт', () => {
    expect(
      vacancyAbout(
        'I build organizations that\ndrive revenue — not just\nsupport the business.\nLed IT.',
      ),
    ).toBe('I build organizations that drive revenue — not just support the business. Led IT.');
    expect(vacancyAbout('Отвечаю за\nСАП и склад.')).toBe('Отвечаю за САП и склад.');
    expect(vacancyAbout('• Grew revenue to $5M\n• Built a team')).toBe(
      'Grew revenue to $5M. Built a team.',
    );
  });

  it('минус у числа остаётся', () => {
    expect(vacancyAbout('-5% churn in a year')).toBe('-5% churn in a year.');
    expect(vacancyAbout('- Built a team')).toBe('Built a team.');
  });

  it.each([
    'Interested in VP roles',
    'Currently seeking work',
    'I am willing to relocate',
    'Based in Dubai, willing to relocate',
    'Рассмотрю предложения',
    'Мой телефон 8 916 123-45-67',
    'Call +7 (916) 123-45-67',
    'Готова рассмотреть предложения',
    'Интересуют позиции CIO',
  ])('«%s» в резюме не попадает', (line) => {
    expect(vacancyAbout(`Руковожу поддержкой.\n${line}`)).toBe('Руковожу поддержкой.');
  });

  it.each(['Interested in distributed systems since school.', 'Вела проект 01.2023 - 05.2024.'])(
    '«%s» остаётся',
    (line) => expect(vacancyAbout(line)).toBe(line),
  );

  it('длинное предложение не выходит за 700 знаков', () => {
    const long = 'Руковожу поддержкой и эксплуатацией, '.repeat(28);
    const result = vacancyAbout(long);
    expect(result.length).toBeLessThanOrEqual(700);
    expect(result).toMatch(/эксплуатацией\.$/u);
    expect(vacancyAbout('слово '.repeat(200)).length).toBeLessThanOrEqual(700);
  });
});

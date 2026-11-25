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
});

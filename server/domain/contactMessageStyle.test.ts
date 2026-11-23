import { describe, expect, it } from 'vitest';
import { dropCourtesyClosing, englishFallbackMessage } from './contactMessageStyle';

describe('B753: конец сообщения без подписи и лишней вежливости', () => {
  it('последняя строка «С уважением…» или «к вашему времени» снимается целиком', () => {
    expect(dropCourtesyClosing('Анна, привет!\n\nБуду рад обсудить.\n\nС уважением к вашему времени.')).toBe('Анна, привет!\n\nБуду рад обсудить.');
    expect(dropCourtesyClosing('Hello Ayesha!\n\nHappy to discuss.\n\nBest regards')).toBe('Hello Ayesha!\n\nHappy to discuss.');
  });

  it('просьба и «Буду рад обсудить» остаются; фраза внутри строки не режется', () => {
    const text = 'Анна, привет! Порекомендуете меня? Буду рад обсудить, с уважением отнесусь к ответу.';
    expect(dropCourtesyClosing(text)).toBe(text);
  });
});

describe('B753: запасной текст по-английски', () => {
  it('рекрутёру — вакансия и компания, без русских слов', () => {
    const text = englishFallbackMessage({ kind: 'recruiter', recipientName: 'Ayesha Azhar', recipientCompany: 'Capital One', targetRole: '', vacancyTitle: 'Senior Lead AI Engineer', vacancyCompany: 'Capital One' });
    expect(text).toContain('Ayesha');
    expect(text).toContain('Senior Lead AI Engineer');
    expect(text).not.toMatch(/\p{Script=Cyrillic}/u);
  });
});

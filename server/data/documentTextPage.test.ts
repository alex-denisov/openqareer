import { describe, expect, it } from 'vitest';
import { DOCUMENT_TEXT_PAGE_BYTE_BUDGET, buildDocumentTextPage } from './documentTextPage';

/**
 * Прод отдавал карточку документа на 20 469 байтах и обрывал её на середине
 * строки: невалидный JSON, `extractedText` не доезжал (INC-034). Текст обязан
 * читаться страницами внутри доказанного бюджета.
 */
describe('buildDocumentTextPage', () => {
  const text = 'Разработчик интерфейсов. Опыт восемь лет. '.repeat(2_000);

  it('держит страницу внутри байтового бюджета', () => {
    const page = buildDocumentTextPage(text, 0);
    expect(Buffer.byteLength(page.text, 'utf8')).toBeLessThanOrEqual(
      DOCUMENT_TEXT_PAGE_BYTE_BUDGET,
    );
    expect(page.text.length).toBeGreaterThan(0);
    expect(page.length).toBe(text.length);
    expect(page.nextOffset).toBe(page.offset + page.text.length);
  });

  it('страницы склеиваются в исходный текст', () => {
    let offset: number | null = 0;
    let joined = '';
    let pages = 0;
    while (offset !== null) {
      const page = buildDocumentTextPage(text, offset);
      joined += page.text;
      offset = page.nextOffset;
      pages += 1;
      expect(pages).toBeLessThan(500);
    }
    expect(joined).toBe(text);
    expect(pages).toBeGreaterThan(1);
  });

  it('не разрывает суррогатную пару на границе страницы', () => {
    const emoji = '👨‍💻'.repeat(4_000);
    const page = buildDocumentTextPage(emoji, 0);
    expect(Buffer.byteLength(page.text, 'utf8')).toBeLessThanOrEqual(
      DOCUMENT_TEXT_PAGE_BYTE_BUDGET,
    );
    expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/u);
    expect(emoji.startsWith(page.text)).toBe(true);
  });

  it('последняя страница не обещает продолжения', () => {
    const page = buildDocumentTextPage('короткий текст', 0);
    expect(page.text).toBe('короткий текст');
    expect(page.nextOffset).toBeNull();
  });

  it('пустой и вычитанный до конца текст отвечают пустой страницей', () => {
    expect(buildDocumentTextPage('', 0)).toMatchObject({ text: '', nextOffset: null, length: 0 });
    expect(buildDocumentTextPage('abc', 3)).toMatchObject({ text: '', nextOffset: null, offset: 3 });
    expect(buildDocumentTextPage('abc', 99)).toMatchObject({ text: '', nextOffset: null });
  });
});

import { describe, expect, it } from 'vitest';
import { LEGAL_CONTENT, LEGAL_OPERATOR, type LegalBlock } from './legalContent';
import {
  LEGAL_DOCS,
  LEGAL_DOC_SLUGS,
  LEGAL_PACK_VERSION_ID,
  legalDocMeta,
  legalPath,
  legalSlugFromPath,
} from '../../../shared/legalRegistry';

/**
 * B173 — a legal document that claims something the product does not do is
 * worse than no document. The owner's instruction is explicit: do not lean on
 * "data never reaches an LLM", and do not promise employment.
 */
const FORBIDDEN = [
  'не передаём данные третьим лицам',
  'не передаем данные третьим лицам',
  'данные не передаются третьим лицам',
  'гарантируем трудоустройство',
  'гарантирует трудоустройство',
  'не используем llm',
  'не используются llm',
  'данные не покидают',
  'персональные данные не обрабатываются',
];

function plainText(slug: (typeof LEGAL_DOC_SLUGS)[number]): string {
  return LEGAL_CONTENT[slug]
    .flatMap((section) => [section.heading, ...section.blocks.flatMap(blockText)])
    .join('\n')
    .toLowerCase();
}

function blockText(block: LegalBlock): string[] {
  if (block.kind === 'paragraph') return [block.text];
  if (block.kind === 'list') return [...block.items];
  return [block.head[0], block.head[1], ...block.rows.flatMap((row) => [row[0], row[1]])];
}

describe('published legal pack', () => {
  it('publishes a document for every registered slug', () => {
    expect(LEGAL_DOCS.map((doc) => doc.slug)).toEqual([...LEGAL_DOC_SLUGS]);
    for (const slug of LEGAL_DOC_SLUGS) {
      expect(LEGAL_CONTENT[slug].length).toBeGreaterThan(0);
    }
  });

  it('never claims something the product does not do', () => {
    for (const slug of LEGAL_DOC_SLUGS) {
      const text = plainText(slug);
      for (const claim of FORBIDDEN) {
        expect(text, `${slug} must not claim «${claim}»`).not.toContain(claim);
      }
    }
  });

  it('names the operator and the contact address in the personal-data policy', () => {
    const text = plainText('privacy');

    expect(text).toContain(LEGAL_OPERATOR.inn);
    expect(text).toContain(LEGAL_OPERATOR.ogrnip);
    expect(text).toContain(LEGAL_OPERATOR.privacyEmail);
  });

  it('states the retention periods rather than leaving them open', () => {
    const retention = LEGAL_CONTENT.privacy.find((section) => section.heading.includes('хранения'));

    expect(retention?.blocks.some((block) => block.kind === 'table')).toBe(true);
  });

  it('says plainly that the product does not guarantee a job', () => {
    expect(plainText('disclaimer')).toContain('не гарантирует');
    expect(plainText('disclaimer')).toContain('кадровым агентством');
  });

  it('carries the age boundary the owner set', () => {
    expect(plainText('terms')).toContain('16 лет');
  });

  it('routes only its own published slugs', () => {
    expect(legalSlugFromPath('/legal/privacy')).toBe('privacy');
    expect(legalSlugFromPath('/legal/privacy/')).toBe('privacy');
    expect(legalSlugFromPath('/legal/offer')).toBeUndefined();
    expect(legalSlugFromPath('/legal')).toBeUndefined();
    expect(legalSlugFromPath('/app')).toBeUndefined();
  });

  it('binds a consent record to one exact published text', () => {
    expect(LEGAL_PACK_VERSION_ID).toMatch(/^legal-v\d+\.\d+-\d{4}-\d{2}-\d{2}$/);
  });

  it('addresses every document by its own published path', () => {
    for (const slug of LEGAL_DOC_SLUGS) {
      expect(legalPath(slug)).toBe(`/legal/${slug}`);
      expect(legalSlugFromPath(legalPath(slug))).toBe(slug);
      expect(legalDocMeta(slug).title.length).toBeGreaterThan(0);
      expect(legalDocMeta(slug).description.length).toBeGreaterThan(0);
    }
  });
});

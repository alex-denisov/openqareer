import { describe, expect, it } from 'vitest';
import { publicPathViolation } from '../seoSlugPolicy';
import { GUIDES, GUIDES_ROOT, findGuide, guidePath, relatedHref } from '.';
import { guideStructuredData } from './structuredData';

const SITE_PATHS = new Set([
  '/signup',
  '/tariffs',
  '/tools/resume',
  '/tools/interview-questions',
  '/tools/salary-calculator',
  '/tools/relocation',
  '/tools/country-fit',
  '/salaries',
  '/salaries/germany',
  '/salaries/usa',
  '/vacancies',
  '/vacancies/remote',
  '/faq',
]);

function knownHref(href: string): boolean {
  const path = href.split(/[?#]/u)[0] ?? href;
  return SITE_PATHS.has(path) || /^\/vacancies\/[a-z-]+\/[a-z-]+$/u.test(path) || path.startsWith(`${GUIDES_ROOT}/`) || path === GUIDES_ROOT;
}

describe('B616 guides', () => {
  it('slugs are unique and follow the public URL policy', () => {
    const slugs = GUIDES.map((guide) => guide.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(publicPathViolation(GUIDES_ROOT)).toBeNull();
    for (const slug of slugs) expect(publicPathViolation(guidePath(slug))).toBeNull();
  });

  it.each(GUIDES.map((guide) => [guide.slug, guide] as const))('%s is complete', (_slug, guide) => {
    expect(guide.title.length).toBeLessThanOrEqual(70);
    expect(guide.description.length).toBeGreaterThanOrEqual(80);
    expect(guide.description.length).toBeLessThanOrEqual(180);
    expect(guide.h1.trim()).not.toBe('');
    expect(guide.lead.trim()).not.toBe('');
    expect(guide.updatedAt >= guide.publishedAt).toBe(true);
    expect(guide.faq.length).toBeGreaterThanOrEqual(3);
    expect(guide.sections.length).toBeGreaterThanOrEqual(3);
    const ids = guide.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  });

  it.each(GUIDES.map((guide) => [guide.slug, guide] as const))(
    '%s cites only listed sources and links only to live paths',
    (_slug, guide) => {
      const sourceIds = new Set(guide.sources.map((source) => source.id));
      for (const source of guide.sources) expect(source.url).toMatch(/^https:\/\//u);
      const actions = [
        guide.primaryAction,
        ...guide.sections.flatMap((s) => (s.action ? [s.action] : [])),
      ];
      for (const action of actions) expect(knownHref(action.href), action.href).toBe(true);
      for (const section of guide.sections)
        for (const block of section.blocks)
          if (block.kind === 'links')
            for (const item of block.items) expect(knownHref(item.href), item.href).toBe(true);
          else if (block.kind === 'paragraph')
            for (const id of block.sourceIds ?? []) expect(sourceIds.has(id), id).toBe(true);
      for (const entry of guide.related) {
        const href = relatedHref(entry);
        if (href.startsWith(`${GUIDES_ROOT}/`)) expect(findGuide(entry), entry).toBeDefined();
        else expect(knownHref(href), href).toBe(true);
      }
    },
  );

  it('structured data carries Article, BreadcrumbList and FAQPage', () => {
    const types = guideStructuredData(GUIDES[0]!).map((row) => row['@type']);
    expect(types).toEqual(['Article', 'BreadcrumbList', 'FAQPage']);
  });
});

/**
 * Certifications, Projects, Skills and Recommendations cards (B265 §2;
 * anatomy in docs/v1-release/tasks/work/B264/linkedin-profile-structure.md §2).
 */
import type {
  ParsedResumeCertification,
  ParsedResumeProject,
  ParsedResumeRecommendation,
} from '../workspace/resumeParserTypes';
import { paragraphsOf, parseFragment, textOf } from './linkedinDom';

function splitIssued(text: string): { issuedAt?: string; expiresAt?: string } {
  const [issuedPart, expiresPart] = text.split('·').map((part) => part.trim());
  return {
    issuedAt: issuedPart?.replace(/^Issued\s+/u, ''),
    expiresAt: expiresPart?.replace(/^Expires\s+/u, ''),
  };
}

/**
 * Certification items have no stable per-item wrapper (B264 §0): they are
 * read as `name, issuer, "Issued …"` triples in document order instead.
 */
export function parseCertificationsSection(html: string): ParsedResumeCertification[] {
  const paragraphs = paragraphsOf(parseFragment(html).body);
  const certifications: ParsedResumeCertification[] = [];
  for (const [index, text] of paragraphs.entries()) {
    if (!/^Issued\s/u.test(text) || index < 2) continue;
    const name = paragraphs[index - 2];
    const issuer = paragraphs[index - 1];
    if (!name) continue;
    certifications.push({ name, issuer, ...splitIssued(text) });
  }
  return certifications;
}

function findItemRoot(anchor: Element): Element {
  let node = anchor.parentElement;
  while (node) {
    const key = node.getAttribute('componentkey');
    if (key && !key.startsWith('auto-component')) return node;
    node = node.parentElement;
  }
  return anchor;
}

function descriptionTextOf(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[data-testid="expandable-text-button"]').forEach((button) => button.remove());
  return textOf(clone);
}

function readOneProject(anchor: Element): ParsedResumeProject | undefined {
  const [name, dates] = paragraphsOf(anchor);
  if (!name) return undefined;
  const item = findItemRoot(anchor);
  const [start, end] = (dates ?? '').split(/\s[-–]\s/u).map((part) => part.trim());
  const boxes = item.querySelectorAll('[data-testid="expandable-text-box"]');
  const description = boxes.length > 1 ? descriptionTextOf(boxes[1]) : undefined;
  const associated = Array.from(item.querySelectorAll('p'))
    .map((p) => textOf(p))
    .find((text) => text?.startsWith('Associated with '));
  return {
    name,
    startDate: start || undefined,
    endDate: end === 'Present' ? undefined : end || undefined,
    current: end === 'Present',
    description,
    employer: associated?.replace(/^Associated with\s+/u, ''),
  };
}

/** Reads every entry from a `projects.html`-shaped snapshot. */
export function parseProjectsSection(html: string): ParsedResumeProject[] {
  const doc = parseFragment(html);
  const anchors = Array.from(doc.querySelectorAll('a[href*="/details/projects/edit/forms/"]'));
  return anchors
    .map((anchor) => readOneProject(anchor))
    .filter((project): project is ParsedResumeProject => Boolean(project));
}

/** Reads the flat skill list from a `skills.html`-shaped snapshot (all 44, not the profile preview). */
export function parseSkillsSection(html: string): string[] {
  const doc = parseFragment(html);
  // jsdom's CSS engine rejects `^=` selectors whose value contains "(", so
  // this filters `[id]` nodes in JS instead of using an attribute selector.
  const skillIdPattern = /^com\.linkedin\.sdui\.profile\.skill\([^)]*\)$/u;
  const skillNodes = Array.from(doc.querySelectorAll('[id]')).filter((node) =>
    skillIdPattern.test(node.getAttribute('id') ?? ''),
  );
  return skillNodes
    .map((node) => textOf(node.querySelector('p')))
    .filter((name): name is string => Boolean(name));
}

function readOneRecommendation(item: Element): ParsedResumeRecommendation | undefined {
  const authorLink = item.querySelector('a[href*="/in/"]');
  const [recommender, position] = paragraphsOf(authorLink ?? item);
  if (!recommender) return undefined;
  const rest = paragraphsOf(item).filter((text) => text !== recommender && text !== position);
  const [date, relationship] = rest;
  const text = textOf(item.querySelector('[data-testid="expandable-text-box"]'));
  return { recommender, position, organization: undefined, text, date, relationship };
}

/** Reads every entry from a `recommendations.html`-shaped snapshot. */
export function parseRecommendationsSection(html: string): ParsedResumeRecommendation[] {
  const doc = parseFragment(html);
  const items = Array.from(doc.querySelectorAll('[componentkey^="entity-collection-item"]')).filter(
    (item) => item.querySelector('a[href*="/in/"]') !== null,
  );
  return items
    .map((item) => readOneRecommendation(item))
    .filter((rec): rec is ParsedResumeRecommendation => Boolean(rec));
}

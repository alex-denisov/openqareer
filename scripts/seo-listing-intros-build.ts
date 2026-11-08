/**
 * SEO P2 (08.11): builds server/seo/data/listingIntros.json from the drafts
 * (facts.jsonl + listings.jsonl, Vertex Gemini) and the period-split salary read
 * on prod by scripts/seo-listing-intro-salary.mjs (read-only).
 * usage: tsx scripts/seo-listing-intros-build.ts <draftsDir> <salary.jsonl>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gateIntro, type ListingIntro } from '../server/seo/listingIntroText';

const [draftsDir, salaryPath] = process.argv.slice(2);
if (!draftsDir || !salaryPath) throw new Error('usage: <draftsDir> <salary.jsonl>');
const lines = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const key = (o: { place: string; role: string }) => `${o.place}|${o.role}`;
const facts = new Map(lines(`${draftsDir}/facts.jsonl`).map((f) => [key(f), f]));
const salary = new Map(lines(salaryPath).map((s) => [key(s), s.salary]));
const out: ListingIntro[] = [];
const skipped: Array<{ id: string; reason: string }> = [];
for (const draft of lines(`${draftsDir}/listings.jsonl`)) {
  const fact = facts.get(key(draft));
  if (!fact) {
    skipped.push({ id: key(draft), reason: 'no facts' });
    continue;
  }
  const { salary: _modelSalary, ...withoutSalary } = fact;
  const gate = gateIntro(draft.intro, withoutSalary, draft.date);
  if (gate.unknownNumbers.length > 0 || gate.words < 40) {
    skipped.push({
      id: key(draft),
      reason: `numbers ${gate.unknownNumbers.join(',')} words ${gate.words}`,
    });
    continue;
  }
  out.push({
    place: draft.place,
    role: draft.role,
    date: draft.date,
    sample: fact.vacancies,
    paragraphs: gate.paragraphs,
    salary: salary.get(key(draft)) ?? [],
  });
}
out.sort((a, b) => key(a).localeCompare(key(b)));
writeFileSync('server/seo/data/listingIntros.json', `${JSON.stringify(out)}\n`);
console.log(
  JSON.stringify({
    published: out.length,
    withSalary: out.filter((o) => o.salary.length).length,
    skipped,
  }),
);

import * as fs from 'fs';
import * as path from 'path';

interface MeasuredPortal {
  companyKey: string;
  companyName: string;
  careersUrl: string;
  count: number;
  sampleTitle: string;
  sampleUrl: string;
}

const MEASURED_PATH = path.resolve(process.cwd(), 'scripts/corporate_portals_measured.json');
const SEED_PATH = path.resolve(process.cwd(), 'server/data/companyDirectorySeed.json');
const CORPORATE_SOURCES_PATH = path.resolve(process.cwd(), 'server/vacancies/defaultCorporateSources.ts');
const MEASUREMENTS_PATH = path.resolve(process.cwd(), 'server/vacancies/vacancySourceMeasurementData.ts');

function cleanBrandName(raw: string): string {
  let s = raw.replace(/^[A-ZА-Я0-9]\s+/u, '');
  s = s.replace(/\s*\([^)]*\)/g, '');
  const cut = s.match(/^([A-Za-z0-9.+& -]+?)(?:\s+[А-Яа-яЁё]|\s*\/|\s+[A-Za-z]+-[А-Яа-яЁё])/);
  if (cut && cut[1].trim().length >= 2) {
    s = cut[1].trim();
  }
  s = s.replace(/\s+(?:AI|SEO|Travel|Document|Smart security|Mobile|Cloud|ERP|SaaS|Gaming|POS|Platform|Software|Digital|App|Games|Lab|Labs)$/i, '');
  return s.trim();
}

async function main() {
  const measured: MeasuredPortal[] = JSON.parse(fs.readFileSync(MEASURED_PATH, 'utf8'));
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const seedMap = new Map(seed.map((s: any) => [s.companyKey, s]));

  // Read current defaultCorporateSources
  const currentSourcesFile = fs.readFileSync(CORPORATE_SOURCES_PATH, 'utf8');
  // Read current measurements
  const currentMeasFile = fs.readFileSync(MEASUREMENTS_PATH, 'utf8');

  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  // Extract existing IDs from current files
  for (const m of currentSourcesFile.matchAll(/id:\s*'([^']+)'/g)) {
    seenIds.add(m[1]);
  }
  for (const m of currentSourcesFile.matchAll(/targetUrl:\s*'([^']+)'/g)) {
    seenUrls.add(m[1]);
  }

  const newSources: any[] = [];
  const newMeasurements: Record<string, any[]> = {};

  for (const item of measured) {
    const id = `src-${item.companyKey}`;
    if (seenIds.has(id) || seenUrls.has(item.careersUrl)) {
      continue;
    }
    seenIds.add(id);
    seenUrls.add(item.careersUrl);

    const brand = cleanBrandName(item.companyName);
    const seedEntry = seedMap.get(item.companyKey);
    const geo = seedEntry?.geo || 'Global';

    newSources.push({
      id,
      name: `${brand} Careers`,
      type: 'career_site',
      accessClass: 'open_web',
      market: `${geo} (${brand} Careers Portal)`,
      addressStatus: 'live',
      enabled: true,
      targetUrl: item.careersUrl,
      refreshIntervalMinutes: 720,
      itemsFoundTotal: item.count,
      itemsActiveTotal: item.count,
    });

    const safeTitle = item.sampleTitle.replace(/'/g, "\\'").replace(/\n/g, ' ');
    newMeasurements[id] = [
      {
        items: item.count,
        observedAt: '2026-11-05',
        route: 'eu-prod',
        note: `${brand} corporate portal via genericCorporateSiteAdapter. Live sample: '${safeTitle}' (${item.sampleUrl})`,
      },
    ];
  }

  console.log(`Adding ${newSources.length} new corporate sources to defaultCorporateSources.ts`);

  // Build new code for defaultCorporateSources.ts
  const sourcesCodeBlocks = newSources.map((s) => `  {
    id: '${s.id}',
    name: '${s.name.replace(/'/g, "\\'")}',
    type: 'career_site',
    accessClass: 'open_web',
    market: '${s.market.replace(/'/g, "\\'")}',
    addressStatus: 'live',
    enabled: true,
    targetUrl: '${s.targetUrl}',
    refreshIntervalMinutes: 720,
    itemsFoundTotal: ${s.itemsFoundTotal},
    itemsActiveTotal: ${s.itemsActiveTotal},
  },`).join('\n');

  // Insert before trailing `];`
  const lastBracketIndex = currentSourcesFile.lastIndexOf('];');
  if (lastBracketIndex === -1) {
    throw new Error('Could not find ending ]; in defaultCorporateSources.ts');
  }
  const updatedSourcesFile =
    currentSourcesFile.slice(0, lastBracketIndex) +
    sourcesCodeBlocks +
    '\n];\n';
  fs.writeFileSync(CORPORATE_SOURCES_PATH, updatedSourcesFile, 'utf8');

  // Build new code for vacancySourceMeasurementData.ts
  const measCodeBlocks = Object.entries(newMeasurements).map(([id, measList]) => {
    const listEntries = measList.map((m) => `    {
      items: ${m.items},
      observedAt: '${m.observedAt}',
      route: '${m.route}',
      note: '${m.note.replace(/'/g, "\\'")}',
    },`).join('\n');
    return `  '${id}': [\n${listEntries}\n  ],`;
  }).join('\n');

  const lastBraceIndex = currentMeasFile.lastIndexOf('};');
  if (lastBraceIndex === -1) {
    throw new Error('Could not find ending }; in vacancySourceMeasurementData.ts');
  }
  const updatedMeasFile =
    currentMeasFile.slice(0, lastBraceIndex) +
    measCodeBlocks +
    '\n};\n';
  fs.writeFileSync(MEASUREMENTS_PATH, updatedMeasFile, 'utf8');

  console.log(`Successfully registered ${newSources.length} corporate sources with verified eu-prod measurements!`);
}

main().catch(console.error);

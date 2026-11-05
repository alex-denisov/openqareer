import { chromium, type Browser, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface CompanyRecord {
  companyKey: string;
  companyName: string;
  linkedinUrl: string | null;
  linkedinOrgId: string | number | null;
  sourceType: string;
  [key: string]: unknown;
}

const SEED_PATH = path.resolve(process.cwd(), 'server/data/companyDirectorySeed.json');

function extractSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/company\/([a-zA-Z0-9._%-]+)/i);
  return match ? match[1] : null;
}

async function resolveSlug(slug: string, context: BrowserContext): Promise<string | null> {
  const page = await context.newPage();
  try {
    const url = `https://www.linkedin.com/company/${slug}/`;
    await page.goto(url, { waitUntil: 'commit', timeout: 15000 });
    await page.waitForTimeout(2500);
    const content = await page.content();

    const matches = Array.from(
      content.matchAll(/urn:li:(?:organization|fsd_company|company):\(?(\d+)/gu),
    ).map((m) => m[1]);

    if (matches.length > 0) {
      // Find most frequent ID
      const counts = new Map<string, number>();
      for (const id of matches) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      let bestId = matches[0];
      let maxCount = 0;
      for (const [id, count] of counts) {
        if (count > maxCount) {
          maxCount = count;
          bestId = id;
        }
      }
      return bestId;
    }
    return null;
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

async function main() {
  const rawSeed = fs.readFileSync(SEED_PATH, 'utf8');
  const companies: CompanyRecord[] = JSON.parse(rawSeed);

  const targets = companies.filter(
    (c) => c.sourceType === 'linkedin_guest' && c.linkedinUrl && !c.linkedinOrgId,
  );

  console.log(`Found ${targets.length} targets without linkedinOrgId`);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  let resolved = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const company = targets[i];
    const slug = extractSlug(company.linkedinUrl!);
    if (!slug) {
      console.log(`[${i + 1}/${targets.length}] ${company.companyName}: no valid slug`);
      failed++;
      continue;
    }

    const orgId = await resolveSlug(slug, context);
    if (orgId) {
      console.log(`[${i + 1}/${targets.length}] ${company.companyName} (${slug}) -> Org ID: ${orgId}`);
      company.linkedinOrgId = orgId;
      resolved++;
    } else {
      console.log(`[${i + 1}/${targets.length}] ${company.companyName} (${slug}) -> NOT RESOLVED`);
      failed++;
    }

    // Save progress every 10 companies
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(SEED_PATH, JSON.stringify(companies, null, 2), 'utf8');
      console.log(`--- Checkpoint: ${resolved} resolved, ${failed} failed ---`);
    }

    // Gentle delay to respect rate limits
    await new Promise((r) => setTimeout(r, 1500));
  }

  await browser.close();

  fs.writeFileSync(SEED_PATH, JSON.stringify(companies, null, 2), 'utf8');
  console.log(`Final: ${resolved} resolved, ${failed} failed out of ${targets.length}`);
}

main().catch(console.error);

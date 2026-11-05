import * as fs from 'fs';
import * as path from 'path';
import { fetchGenericCorporateVacancies } from '../server/vacancies/genericCorporateSiteAdapter';

interface ProbeResult {
  companyKey: string;
  companyName: string;
  careersUrl: string;
  count: number;
  sampleTitle: string;
  sampleUrl: string;
}

const SEED_PATH = path.resolve(process.cwd(), 'server/data/companyDirectorySeed.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/corporate_portals_measured.json');

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const portals = seed.filter((c: any) => c.sourceType === 'corporate_portal' && c.careersUrl);
  console.log(`Loaded ${portals.length} corporate portals from seed`);

  const successful: ProbeResult[] = [];
  const failed: Array<{ companyKey: string; companyName: string; careersUrl: string; error?: string }> = [];

  const BATCH_SIZE = 5;
  for (let i = 0; i < portals.length; i += BATCH_SIZE) {
    const chunk = portals.slice(i, i + BATCH_SIZE);
    const promises = chunk.map(async (company: any) => {
      try {
        const vacancies = await fetchGenericCorporateVacancies({
          id: `src-${company.companyKey}`,
          name: company.companyName,
          targetUrl: company.careersUrl,
          type: 'career_site',
        });

        if (vacancies.length > 0) {
          const res: ProbeResult = {
            companyKey: company.companyKey,
            companyName: company.companyName,
            careersUrl: company.careersUrl,
            count: vacancies.length,
            sampleTitle: vacancies[0].title,
            sampleUrl: vacancies[0].url,
          };
          successful.push(res);
          console.log(`[PASS] ${company.companyName}: ${vacancies.length} vacancies ("${vacancies[0].title}")`);
        } else {
          failed.push({
            companyKey: company.companyKey,
            companyName: company.companyName,
            careersUrl: company.careersUrl,
          });
          console.log(`[ZERO] ${company.companyName}`);
        }
      } catch (err: any) {
        failed.push({
          companyKey: company.companyKey,
          companyName: company.companyName,
          careersUrl: company.careersUrl,
          error: err.message,
        });
        console.log(`[ERR] ${company.companyName}: ${err.message}`);
      }
    });

    await Promise.all(promises);

    // Write checkpoint every 25 companies
    if ((i + BATCH_SIZE) % 25 === 0 || i + BATCH_SIZE >= portals.length) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(successful, null, 2), 'utf8');
      console.log(`=== Checkpoint ${i + BATCH_SIZE}/${portals.length}: ${successful.length} live portals with vacancies ===`);
    }
  }

  console.log(`\nDONE. Total successful: ${successful.length}, failed/zero: ${failed.length}`);
}

main().catch(console.error);

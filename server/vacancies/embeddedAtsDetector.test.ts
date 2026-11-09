import { describe, expect, it } from 'vitest';
import { detectEmbeddedAts } from './embeddedAtsDetector';

/** Фрагменты сняты с пустых сайтов компаний на проде 10.11 (B628). */
describe('B628 — доски ATS по адресам на странице', () => {
  it.each([
    ['https://3ap.bamboohr.com/careers', 'bamboohr', '3ap'],
    ['<script src="https://aflacni.bamboohr.com/js/embed.js"></script>', 'bamboohr', 'aflacni'],
    ['<a href="https://approvalmax.teamtailor.com/jobs">', 'teamtailor', 'approvalmax'],
    ['https://accurids-gmbh.jobs.personio.com/xml?language=en', 'personio', 'accurids-gmbh'],
    ['https://agile-robots-se.jobs.personio.de/?language=en', 'personio', 'agile-robots-se'],
    ['https://jobs-aligntech.pinpointhq.com', 'pinpoint', 'jobs-aligntech'],
    ['https://careers.smartrecruiters.com/AnalysysMason1', 'smartrecruiters', 'AnalysysMason1'],
    [
      'https://api.smartrecruiters.com/v1/companies/ACCESA/postings/744000067914275',
      'smartrecruiters',
      'ACCESA',
    ],
  ])('%s → %s/%s', (html, provider, orgId) => {
    expect(detectEmbeddedAts(html)).toMatchObject({ provider, orgId });
  });

  it('Workday: локаль в пути не становится сайтом', () => {
    expect(detectEmbeddedAts('https://ag.wd3.myworkdayjobs.com/en-US/Airbus/job/x')).toMatchObject({
      provider: 'workday',
      orgId: 'ag/Airbus',
    });
  });

  it('служебные поддомены и упоминания без адреса доски не считаются', () => {
    expect(detectEmbeddedAts('https://app.teamtailor.com/companies/x/dashboard')).toBeNull();
    expect(detectEmbeddedAts('https://app.pinpointhq.com/rails/active_storage/x')).toBeNull();
    expect(detectEmbeddedAts('class="group-hover:text-teamtailor-pink" BambooHR')).toBeNull();
    expect(detectEmbeddedAts('https://www.bamboohr.com/')).toBeNull();
  });
});

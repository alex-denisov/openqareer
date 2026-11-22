import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness } from '../testHelpers/b640VacancyHarness';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** B746: the store with real migrations — the query must match the applications schema. */
async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const own = h.candidates.createApplication(h.candidateIds['flagged.test'], {
    stage: 'interview',
    manualVacancy: {
      title: 'Технический директор',
      company: 'Интач Груп',
      url: 'https://example.test/cto',
      source: 'other',
    },
  });
  const interview = h.candidates.createApplicationInterview(h.candidateIds['flagged.test'], own.id, {
    round: 2,
    scheduledAt: '2026-12-01T12:00:00.000Z',
  });
  return { ...h, own, interview };
}

describe('getInterviewSubject (B746)', () => {
  it('reads the interview with the decrypted vacancy title and company', async () => {
    const { candidates, candidateIds, own, interview } = await setup();

    const subject = candidates.getInterviewSubject(candidateIds['flagged.test'], interview.id);

    expect(subject).toEqual({
      id: interview.id,
      applicationId: own.id,
      round: 2,
      scheduledAt: '2026-12-01T12:00:00.000Z',
      stage: 'interview',
      vacancyTitle: 'Технический директор',
      vacancyCompany: 'Интач Груп',
    });
  });

  it('another candidate and a missing interview get null', async () => {
    const { candidates, candidateIds, interview } = await setup();

    expect(candidates.getInterviewSubject(candidateIds['other.test'], interview.id)).toBeNull();
    expect(candidates.getInterviewSubject(candidateIds['flagged.test'], 'missing')).toBeNull();
  });
});

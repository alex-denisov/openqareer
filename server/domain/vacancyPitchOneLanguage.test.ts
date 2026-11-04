import { describe, expect, it } from 'vitest';
import { checkPitchOutputFacts, generatedTextFactNotices } from './generatedTextFactGate';
import { generateVacancyPitch, type VacancyPitchInputFact } from './vacancyPitchService';

// Equivalent of the prod walk 03.11 (QA_CANDIDATE → Leidos, language «auto»):
// a Russian profile, imported skills only, an English vacancy whose
// "requirements" are title keys from the cluster.
const imported = (id: string, statement: string, domain: string): VacancyPitchInputFact => ({
  id: `imp0123456789-${id}`,
  statement,
  kind: 'fact',
  domain,
  sourceMessageIds: ['m'],
  status: 'proposed',
});
const facts = [
  imported('k8s', 'Kubernetes', 'skill'),
  imported('kafka', 'Kafka', 'skill'),
  imported('go', 'Go', 'skill'),
  imported('edu', 'Образование\nУчебное заведение: МГТУ им. Баумана\nНачало: 2008-09', 'other'),
];
const workplaces = [
  {
    employer: 'Маркет Софт',
    title: 'Директор по разработке',
    startDate: '2019-03',
    endDate: null,
    current: true,
    evidenceIds: ['wp1'],
  },
  {
    employer: 'Ритейл Системс',
    title: 'Руководитель разработки',
    startDate: '2014-01',
    endDate: '2019-02',
    current: false,
    evidenceIds: ['wp2'],
  },
];
const leidos = {
  id: 'v-leidos',
  title: 'Director, Technology Operations & Sustainment',
  company: 'Leidos',
  description: 'Leidos is seeking a Director to lead technology operations and sustainment.',
  requiredSkills: ['Director-Of-Technology', 'Technology-Director', 'IT-Director'],
};
const letter = () =>
  generateVacancyPitch({ vacancy: leidos, candidateName: 'Иван Петров', facts, workplaces });
const SLUG = /\b\p{L}+(?:-\p{Lu}\p{Ll}+)+\b/u;
const RAW_FIELD = /(Учебное заведение|Начало|Окончание|Уровень CEFR):/u;

describe('one language per letter (G3 L1)', () => {
  it('an English letter for a Russian profile has no Cyrillic anywhere the recruiter reads', () => {
    const pitch = letter();
    expect(pitch.language).toBe('en');
    for (const text of [
      pitch.emailPitch.subject,
      pitch.emailPitch.body,
      pitch.atsCoverLetter,
      pitch.linkedInNote,
      pitch.contactMessage,
    ]) {
      // Employers keep their own script inside quotes (G3b): never transliterated.
      expect(text.replace(/Маркет Софт|Ритейл Системс/gu, '')).not.toMatch(/\p{Script=Cyrillic}/u);
    }
    expect(pitch.emailPitch.body).toContain(
      'I currently work as Director of Engineering at Маркет Софт (2019–present)',
    );
    expect(pitch.emailPitch.body).toContain('Head of Engineering at Ритейл Системс (2014–2019)');
    expect(pitch.atsCoverLetter).toContain('Ivan Petrov');
  });

  it('a Russian letter keeps Russian titles and employers as written', () => {
    const pitch = generateVacancyPitch({
      vacancy: { id: 'v', title: 'Директор по ИТ', company: 'Вектор' },
      facts,
      workplaces,
    });
    expect(pitch.emailPitch.body).toContain('Директор по разработке в компании Маркет Софт');
  });
});

describe('results come from outcomes, not a skills list (G3 L1)', () => {
  it('bare skills never appear as results', () => {
    const pitch = letter();
    for (const text of [
      pitch.emailPitch.body,
      pitch.atsCoverLetter,
      pitch.linkedInNote,
      pitch.contactMessage,
    ]) {
      expect(text).not.toMatch(
        /Among my results|Key results|My experience: Kubernetes|Briefly on my background: Kubernetes/u,
      );
      expect(text).not.toMatch(/Kubernetes\. Kafka\. Go\./u);
    }
  });

  it('a title-like line is not a result because a verb hides inside a word', () => {
    const line = imported('exec', 'Executive committee member', 'other');
    const pitch = generateVacancyPitch({ vacancy: leidos, facts: [...facts, line], workplaces });
    expect(pitch.emailPitch.body).not.toContain('Executive committee member');
  });

  it('an outcome fact is still quoted as a result', () => {
    const outcome = imported('out', 'Cut the release cycle from 14 to 3 days', 'outcome');
    const pitch = generateVacancyPitch({ vacancy: leidos, facts: [...facts, outcome], workplaces });
    expect(pitch.emailPitch.body).toContain(
      'Among my results: cut the release cycle from 14 to 3 days.',
    );
    expect(pitch.emailPitch.body).not.toContain('Kubernetes.');
  });
});

describe('notes under the letter (G3 L2)', () => {
  it('at most one note, no slug keys or raw profile fields', () => {
    const pitch = letter();
    expect(pitch.notices.length).toBeLessThanOrEqual(1);
    for (const notice of pitch.notices) {
      expect(notice).not.toMatch(SLUG);
      expect(notice).not.toMatch(RAW_FIELD);
      expect(notice).toMatch(/\p{Script=Cyrillic}/u);
    }
  });

  it("the template's own sentences are not claims to check", () => {
    for (const tone of ['executive', 'confident', 'technical'] as const) {
      const pitch = generateVacancyPitch({
        vacancy: leidos,
        candidateName: 'Иван Петров',
        facts,
        workplaces,
        tone,
      });
      const checks = Object.values(checkPitchOutputFacts(pitch, pitch.atsCoverLetter, facts));
      expect(generatedTextFactNotices('en', checks)).toEqual([]);
    }
  });

  it('unconfirmed requirements come back as human labels', () => {
    expect(letter().unconfirmedRequirements).toEqual([
      'Director of technology',
      'Technology director',
      'IT director',
    ]);
  });

  it('real skill names are kept as they are', () => {
    const pitch = generateVacancyPitch({
      vacancy: { ...leidos, requiredSkills: ['T-SQL', 'CI-CD', 'Node.js'] },
      facts,
      workplaces,
    });
    expect(pitch.unconfirmedRequirements).toEqual(['T-SQL', 'CI-CD', 'Node.js']);
  });
});

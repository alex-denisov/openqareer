import { describe, expect, it } from 'vitest';
import { generateVacancyPitch, type VacancyPitchInputFact } from './vacancyPitchService';

const record = (id: string, statement: string): VacancyPitchInputFact => ({
  id, statement, kind: 'fact', domain: 'experience', sourceMessageIds: ['m'], status: 'confirmed',
});

const facts = [
  record('edu', 'Образование\nУчебное заведение: МГТУ им. Баумана\nНачало: 2008-09\nОкончание: 2013-06'),
  record('lang', 'Язык\nЯзык: Английский\nУровень CEFR: C1'),
  record('out', 'Сократил релизный цикл с 14 до 3 дней'),
];
const workplaces = [
  { employer: 'Финтех Лаб', title: 'Head of Engineering', startDate: '2024-01', endDate: null, current: true, evidenceIds: ['wp1'] },
  { employer: 'Маркет Софт', title: 'Директор по разработке', startDate: '2021-02', endDate: '2023-12', current: false, evidenceIds: ['wp2'] },
];
const RAW_FIELD = /(Учебное заведение|Уровень CEFR|Начало|Окончание):/u;

describe('letter text (B496/B528)', () => {
  it('Russian vacancy → Russian letter without raw profile fields, built from workplaces', () => {
    const pitch = generateVacancyPitch({
      vacancy: { id: 'v', title: 'Head of Platform', company: 'Вектор Банк', responsibilities: ['Развивать платформу'], requiredSkills: ['Kafka'] },
      facts, workplaces,
    });
    expect(pitch.language).toBe('ru');
    expect(pitch.atsCoverLetter).not.toMatch(RAW_FIELD);
    expect(pitch.emailPitch.body).not.toMatch(RAW_FIELD);
    expect(pitch.atsCoverLetter).toContain('Сейчас работаю на позиции Head of Engineering в компании Финтех Лаб');
    expect(pitch.usedEvidenceIds).toEqual(expect.arrayContaining(['wp1', 'wp2']));
    for (const notice of pitch.notices) expect(notice).toMatch(/\p{Script=Cyrillic}/u);
  });

  it('English vacancy → English letter, still no raw fields, notices stay Russian', () => {
    const pitch = generateVacancyPitch({
      vacancy: { id: 'v', title: 'Director, Technology Operations', company: 'Leidos', requiredSkills: ['ITIL'] },
      facts, workplaces,
    });
    expect(pitch.language).toBe('en');
    expect(pitch.atsCoverLetter).not.toMatch(RAW_FIELD);
    expect(pitch.atsCoverLetter).not.toMatch(/\p{Script=Cyrillic}{3,}\s*:/u);
    expect(pitch.atsCoverLetter).toContain('Head of Engineering at Финтех Лаб');
    expect(pitch.atsCoverLetter).not.toContain('Сократил');
    expect(pitch.notices.length).toBeGreaterThan(0);
    for (const notice of pitch.notices) expect(notice).toMatch(/\p{Script=Cyrillic}/u);
  });
});

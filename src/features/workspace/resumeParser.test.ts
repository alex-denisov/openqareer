import { describe, expect, it } from 'vitest';
import {
  parseResumeContent,
  parsedResumeToDraft,
  parsedResumeToFactDrafts,
} from './resumeParser';

const SYNTHETIC_4PAGE_RESUME = `
Иван Иванов
Руководитель продукта / Head of Product
Телефон: +7 (999) 123-45-67
Email: ivan.ivanov@example.com
Telegram: @ivan_lead
Проживает: Москва
https://linkedin.com/in/ivan-lead
https://github.com/ivan-lead

О себе
10+ лет в управлении технологическими продуктами и B2B/B2C платформами. Специализируюсь на поиске Product-Market Fit, юнит-экономике, масштабировании команд и трансформации процессов.

Ключевые навыки
Product Management, Unit Economics, Agile / Scrum, SQL, Python, Discovery, System Architecture, A/B Testing, User Research, Team Leadership

Опыт работы
Март 2021 — по настоящее время
TechCorp
Директор по продукту
• Управлял продуктовой линейкой из 4 B2B продуктов и командой из 25 человек (продакты, аналитики, дизайнеры).
• Увеличил годовую выручку (ARR) на 140% за счёт запуска нового тарифного плана и выхода на Enterprise сегмент.
• Сократил Time to Market с 4 месяцев до 3 недель благодаря внедрению непрерывного Discovery.

Январь 2017 — Февраль 2021
Fintech Solutions
Ведущий менеджер продукта
• Отвечал за мобильное приложение и платёжный шлюз с MAU 1.2M пользователей.
• Запустил сервис мгновенных переводов, что принесло рост транзакционного дохода на 85%.
• Провёл более 120 глубинных интервью с клиентами.

Высшее образование
2015
МГТУ им. Баумана
Информатика и системы управления, Магистр

Электронные сертификаты
2022
Reforge - Product Leadership
2020
Scrum.org - Professional Scrum Product Owner (PSPO II)

Тесты, экзамены
2021
GMAT 720

Рекомендации
Петров Петр, CTO в TechCorp (+7 999 000-00-00)

Знание языков
Русский — Родной
Английский — C1

График работы: Полный день, Удаленная работа
Готов к переезду: Рассматриваю релокацию
Гражданство: РФ
`;

describe('resumeParser', () => {
  it('extracts all resume sections from multi-page resume text', () => {
    const parsed = parseResumeContent(SYNTHETIC_4PAGE_RESUME);

    expect(parsed.fullName).toBe('Иван Иванов');
    expect(parsed.targetRole).toContain('Head of Product');
    expect(parsed.contact.email).toBe('ivan.ivanov@example.com');
    expect(parsed.contact.phone).toBe('+7 (999) 123-45-67');
    expect(parsed.contact.telegram).toBe('@ivan_lead');
    expect(parsed.contact.location).toBe('Москва');
    expect(parsed.contact.links).toContain('https://linkedin.com/in/ivan-lead');

    expect(parsed.about).toContain('10+ лет в управлении');

    expect(parsed.skills).toContain('Product Management');
    expect(parsed.skills).toContain('Unit Economics');

    expect(parsed.experience).toHaveLength(2);
    expect(parsed.experience[0].title).toBe('Директор по продукту');
    expect(parsed.experience[0].employer).toBe('TechCorp');
    expect(parsed.experience[0].current).toBe(true);
    expect(parsed.experience[0].achievements.length).toBeGreaterThan(0);

    expect(parsed.education).toHaveLength(1);
    expect(parsed.education[0].institution).toContain('Баумана');
    expect(parsed.education[0].endDate).toBe('2015');

    expect(parsed.courses).toHaveLength(2);
    expect(parsed.courses[0].name).toContain('Reforge');

    expect(parsed.tests).toHaveLength(1);
    expect(parsed.tests[0].name).toContain('GMAT');

    expect(parsed.recommendations).toHaveLength(1);
    expect(parsed.recommendations[0].recommender).toContain('Петров');

    expect(parsed.languages).toHaveLength(2);
    expect(parsed.languages.find((l) => l.name.includes('Английский'))?.cefr).toBe('C1');

    expect(parsed.additional?.workSchedule).toContain('Удаленная работа');
    expect(parsed.additional?.relocation).toContain('релокацию');
  });

  it('converts parsed resume into complete ResumeDraft with all sections', () => {
    const parsed = parseResumeContent(SYNTHETIC_4PAGE_RESUME);
    const draft = parsedResumeToDraft(parsed);

    expect(draft.candidate.fullName).toBe('Иван Иванов');
    expect(draft.candidate.about).toContain('10+ лет');
    expect(draft.candidate.contact?.telegram).toBe('@ivan_lead');
    expect(draft.experience.length).toBe(2);
    expect(draft.skills?.length).toBeGreaterThan(5);
    expect(draft.education.length).toBe(1);
    expect(draft.courses?.length).toBe(2);
    expect(draft.tests?.length).toBe(1);
    expect(draft.recommendations?.length).toBe(1);
    expect(draft.languages.length).toBe(2);
  });

  it('generates rich profile fact drafts for review in wizard', () => {
    const parsed = parseResumeContent(SYNTHETIC_4PAGE_RESUME);
    const factDrafts = parsedResumeToFactDrafts(parsed, 'resume-pdf');

    expect(factDrafts.length).toBeGreaterThan(5);
    expect(factDrafts.some((f) => f.fact.kind === 'headline')).toBe(true);
    expect(factDrafts.some((f) => f.fact.kind === 'position')).toBe(true);
    expect(factDrafts.some((f) => f.fact.kind === 'skill')).toBe(true);
    expect(factDrafts.some((f) => f.fact.kind === 'education')).toBe(true);
    expect(factDrafts.every((f) => f.decision === 'confirmed')).toBe(true);
  });
});

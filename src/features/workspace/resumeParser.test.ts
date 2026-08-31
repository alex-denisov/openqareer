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

const RESUME_WITHOUT_EDUCATION = `
Алексей Смирнов
Продуктовый аналитик

Опыт
2023 — настоящее время, FinCloud, продуктовый аналитик.
Запустил центр продуктовой аналитики для трёх продуктовых направлений. Автоматизировал отчётность в Mixpanel и SQL, сократив подготовку регулярного отчёта с двух дней до двадцати минут.

2021 — 2023, DataHub, аналитик данных.
Построил сквозную аналитику клиентского пути и когорт по каналам. Снизил стоимость лида на 22 процента после сегментации каналов и креативов.

Навыки
SQL, продуктовая аналитика, Mixpanel, A/B-тесты, Python, Tableau, когортный анализ.
`;

// The hh.ru PDF export arrives from pdf.js with a space before every
// punctuation mark and around in-word hyphens, because each token is its own
// text item. Synthetic person; shape copied from a real export (B178).
const HH_PDF_SPACED_PUNCTUATION = `
Иванова Мария
Женщина , 34 года , родилась 12 июля 1991
+7 (900) 1234567 — предпочитаемый способ связи
maria.ivanova@example.com
telegram: @maria_ivanova
Проживает : Казань
Гражданство : Россия , есть разрешение на работу : Россия
Готов к переезду , готов к командировкам
Желаемая должность и зарплата
Директор по маркетингу
Специализации :
— Директор по маркетингу
Тип занятости : полная занятость
Опыт работы — 7 лет
Май 2021 — ООО " Ромашка "
Август 2025 Казань , romashka.ru/
4 года 3 месяца
Информационные технологии , системная интеграция , интернет
• Разработка программного обеспечения
Директор по маркетингу ( CMO )
Руководила отделом из 20 человек . Отвечала за бизнес - процессы отдела .
Ключевые навыки
Управление командой Бюджетирование
Digital - маркетинг
Знание языков
Русский — Родной
Английский — C1
`;

// LinkedIn prints `April 2023 - October 2025`; an education block prints the
// level in its own column. Synthetic person (B178).
const LINKEDIN_PDF_SHAPE = `
Maria Ivanova
Head of Analytics | Data Leader
Kazan, Russia

Experience
Romashka
Head of Analytics
April 2023 - October 2025 (2 years 7 months)
• Led a team of 12 analysts

Education
Высшее
2010
Kazan Federal University
Высшее
Marketing, Master
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

  it('parses authentic LinkedIn PDF export format seamlessly', () => {
    const LINKEDIN_PDF_EXPORT = `
Contact
www.linkedin.com/in/marina-orlova-qa (LinkedIn)
Top Skills
Product Management
Engineering Management
System Architecture
Languages
English (Full Professional)
Russian (Native or Bilingual)
Certifications
Reforge Product Leadership
Marina Orlova
VP of Technology & Operations | Ex-COO | FinTech & AI Scaling
London, United Kingdom
Summary
Executive leader with 15+ years of experience transforming tech organizations, building scalable platforms, and driving rapid business growth across Europe and global markets.
Experience
OpenQareer
Chief Operating Officer
January 2022 - Present (4 years 7 months)
London, United Kingdom
• Built and launched candidate-first career operating system.
• Grew organic user base with high retention.
Global FinTech Corp
Head of Engineering
March 2018 - December 2021 (3 years 10 months)
London, United Kingdom
• Led engineering organization of 60+ engineers.
• Reduced platform latency by 65% and increased transaction throughput.
Education
Bauman Moscow State Technical University
Master's degree, Computer Science · (2008 - 2014)
`;

    const parsed = parseResumeContent(LINKEDIN_PDF_EXPORT);

    expect(parsed.fullName).toBe('Marina Orlova');
    expect(parsed.targetRole).toContain('VP of Technology');
    expect(parsed.contact.location).toBe('London');
    expect(parsed.contact.links).toContain('https://www.linkedin.com/in/marina-orlova-qa');
    expect(parsed.about).toContain('Executive leader with 15+ years');
    expect(parsed.skills).toContain('Product Management');
    expect(parsed.skills).toContain('Engineering Management');
    expect(parsed.skills).toContain('System Architecture');
    expect(parsed.experience.length).toBe(2);
    expect(parsed.experience[0].employer).toBe('OpenQareer');
    expect(parsed.experience[0].title).toBe('Chief Operating Officer');
    expect(parsed.experience[0].current).toBe(true);
    expect(parsed.experience[0].startDate).toBe('2022-01');
    expect(parsed.experience[1].employer).toBe('Global FinTech Corp');
    expect(parsed.experience[1].title).toBe('Head of Engineering');
    expect(parsed.experience[1].current).toBe(false);
    expect(parsed.experience[1].startDate).toBe('2018-03');
    expect(parsed.experience[1].endDate).toBe('2021-12');
    expect(parsed.education[0].institution).toContain('Bauman');
    expect(parsed.courses[0].name).toContain('Reforge');
    expect(parsed.languages[0].name).toBe('English');
    expect(parsed.languages[0].cefr).toBe('C2');
  });

  it('invents no education when the source has no education section (B178)', () => {
    const parsed = parseResumeContent(RESUME_WITHOUT_EDUCATION);

    expect(parsed.experience.length).toBe(2);
    expect(parsed.skills).toContain('SQL');
    expect(parsed.education).toEqual([]);
  });

  it('keeps a section heading and a whole sentence out of education (B178)', () => {
    const parsed = parseResumeContent(RESUME_WITHOUT_EDUCATION);
    const institutions = parsed.education.map((item) => item.institution);

    expect(institutions).not.toContain('Опыт');
    expect(institutions).not.toContain('Навыки');
    expect(institutions).not.toContain('Алексей Смирнов');
  });

  it('reads contacts, city and target role out of a spaced-punctuation hh.ru export (B178)', () => {
    const parsed = parseResumeContent(HH_PDF_SPACED_PUNCTUATION);

    expect(parsed.fullName).toBe('Иванова Мария');
    expect(parsed.contact.location).toBe('Казань');
    expect(parsed.contact.email).toBe('maria.ivanova@example.com');
    expect(parsed.contact.phone).toContain('900');
    expect(parsed.targetRole).toBe('Директор по маркетингу');
  });

  it('reads the real job title of an hh.ru position, not a placeholder (B178)', () => {
    const parsed = parseResumeContent(HH_PDF_SPACED_PUNCTUATION);

    expect(parsed.experience.length).toBe(1);
    expect(parsed.experience[0].employer).toContain('Ромашка');
    expect(parsed.experience[0].title).toContain('Директор по маркетингу');
    expect(parsed.experience[0].title).not.toBe('Специалист');
    expect(parsed.experience[0].startDate).toBe('2021-05');
    expect(parsed.experience[0].endDate).toBe('2025-08');
  });

  it('keeps section headings out of skills and languages (B178)', () => {
    const parsed = parseResumeContent(HH_PDF_SPACED_PUNCTUATION);

    expect(parsed.skills).not.toContain('Знание языков');
    expect(parsed.skills).not.toContain('Дополнительная информация');
    expect(parsed.languages.map((l) => l.name)).toEqual(['Русский', 'Английский']);
  });

  it('does not split October on the word "to" in a LinkedIn period (B178)', () => {
    const parsed = parseResumeContent(LINKEDIN_PDF_SHAPE);

    expect(parsed.experience[0].startDate).toBe('2023-04');
    expect(parsed.experience[0].endDate).toBe('2025-10');
  });

  it('never turns the level of education into a school or a degree (B178)', () => {
    const parsed = parseResumeContent(LINKEDIN_PDF_SHAPE);

    expect(parsed.education.length).toBe(1);
    expect(parsed.education[0].institution).toBe('Kazan Federal University');
    expect(parsed.education[0].qualification).toBe('Marketing, Master');
    expect(parsed.education[0].endDate).toBe('2010');
  });
});

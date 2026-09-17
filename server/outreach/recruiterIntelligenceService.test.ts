import { describe, expect, it } from 'vitest';
import {
  discoverRecruiterContacts,
  extractCompanyDomain,
  extractPhones,
  extractProfessionalProfiles,
  extractTelegramHandles,
  extractWhatsappLinks,
  generateEmailHypotheses,
  transliterateToLatin,
  type UnifiedVacancyInput,
} from './recruiterIntelligenceService';

describe('recruiterIntelligenceService', () => {
  describe('extractCompanyDomain', () => {
    it('извлекает домен компании из прямой ссылки на вакансию', () => {
      const domain = extractCompanyDomain({
        id: '1',
        url: 'https://careers.acmecorp.com/jobs/senior-frontend-engineer',
        company: 'Acme Corp',
      });
      expect(domain).toBe('acmecorp.com');
    });

    it('не считает агрегаторы (hh.ru, linkedin.com) доменом компании', () => {
      const domain = extractCompanyDomain({
        id: '2',
        url: 'https://hh.ru/vacancy/98765432',
        company: 'Яндекс',
      });
      expect(domain).not.toBe('hh.ru');
    });

    it('извлекает домен из email в тексте описания если URL — агрегатор', () => {
      const domain = extractCompanyDomain({
        id: '3',
        url: 'https://hh.ru/vacancy/123',
        company: 'InnoTech',
        description: 'Присылайте резюме на адрес jobs@innotech.dev',
      });
      expect(domain).toBe('innotech.dev');
    });

    it('извлекает домен из названия компании если оно содержит TLD', () => {
      const domain = extractCompanyDomain({
        id: '4',
        company: 'Ozon.ru',
      });
      expect(domain).toBe('ozon.ru');
    });
  });

  describe('extractPhones', () => {
    it('находит российские номера телефонов в разных форматах', () => {
      const text = 'Связь с HR: +7 (999) 123-45-67 или 8 (916) 987-65-43 доб 12';
      const phones = extractPhones(text);
      expect(phones).toContain('+7 (999) 123-45-67');
      expect(phones.some((p) => p.includes('916') && p.includes('987'))).toBe(true);
    });

    it('находит международные номера телефонов', () => {
      const text = 'Direct hiring manager: +49 151 23456789 and US office: +1 415 555 0199';
      const phones = extractPhones(text);
      expect(phones).toContain('+49 151 23456789');
      expect(phones).toContain('+1 415 555 0199');
    });

    it('не принимает даты и идентификаторы за телефоны', () => {
      const text = 'Опубликовано 2026-09-17, номер заявки 1234567890123';
      const phones = extractPhones(text);
      expect(phones).toHaveLength(0);
    });
  });

  describe('extractTelegramHandles', () => {
    it('извлекает прямые юзернеймы и t.me ссылки', () => {
      const text = 'Писать в TG: @elena_recruiter или t.me/tech_talent_lead';
      const tg = extractTelegramHandles(text);
      expect(tg).toContain('@elena_recruiter');
      expect(tg).toContain('t.me/tech_talent_lead');
    });

    it('игнорирует ключевые слова jsdoc и кода', () => {
      const text = '/** @param {string} name @returns {void} */';
      const tg = extractTelegramHandles(text);
      expect(tg).toHaveLength(0);
    });
  });

  describe('extractWhatsappLinks', () => {
    it('находит ссылки wa.me и whatsapp', () => {
      const text = 'WhatsApp: https://wa.me/79991234567 или wa.me/49151234567';
      const wa = extractWhatsappLinks(text);
      expect(wa.length).toBeGreaterThanOrEqual(1);
      expect(wa[0]).toContain('wa.me/79991234567');
    });
  });

  describe('extractProfessionalProfiles', () => {
    it('извлекает профили LinkedIn, GitHub и Twitter/X', () => {
      const text = 'Профиль: https://www.linkedin.com/in/elena-smirnova Github: https://github.com/elenasmirnova X: https://x.com/elena_hr';
      const profiles = extractProfessionalProfiles(text);
      expect(profiles.linkedinUrl).toBe('https://www.linkedin.com/in/elena-smirnova');
      expect(profiles.githubUrl).toBe('https://github.com/elenasmirnova');
      expect(profiles.twitterUrl).toBe('https://x.com/elena_hr');
    });
  });

  describe('transliterateToLatin & generateEmailHypotheses', () => {
    it('транслитерирует кириллические имена в латиницу', () => {
      expect(transliterateToLatin('Елена Смирнова')).toBe('elena smirnova');
      expect(transliterateToLatin('Алексей Щукин')).toBe('aleksey shchukin');
    });

    it('генерирует гипотезы корпоративной почты по стандартным формулам', () => {
      const hypotheses = generateEmailHypotheses('Елена Смирнова', 'acmecorp.com');
      expect(hypotheses).toContain('elena.smirnova@acmecorp.com');
      expect(hypotheses).toContain('e.smirnova@acmecorp.com');
      expect(hypotheses).toContain('elena@acmecorp.com');
    });
  });

  describe('discoverRecruiterContacts', () => {
    it('извлекает контакты рекрутера из текста описания вакансии', async () => {
      const vacancy: UnifiedVacancyInput = {
        id: 'vac-1',
        company: 'Starlight Tech',
        url: 'https://careers.starlight.io/jobs/101',
        description: `
          Мы ищем Senior QA Engineer.
          Контакты:
          Рекрутер: Дарья Соколова
          Telegram: @daria_talent
          Email: d.sokolova@starlight.io
          Телефон: +7 (999) 777-66-55
          LinkedIn: https://linkedin.com/in/daria-sokolova
        `,
      };

      const contacts = await discoverRecruiterContacts(vacancy, {
        mxResolver: async () => [{ exchange: 'mail.starlight.io', priority: 10 }],
        smtpValidator: async () => true,
      });

      expect(contacts.length).toBeGreaterThanOrEqual(1);
      const contact = contacts[0];
      expect(contact.fullName).toBe('Дарья Соколова');
      expect(contact.roleTitle).toBe('Рекрутер');
      expect(contact.telegram).toBe('@daria_talent');
      expect(contact.phone).toBe('+7 (999) 777-66-55');
      expect(contact.email).toBe('d.sokolova@starlight.io');
      expect(contact.emailStatus).toBe('verified');
      expect(contact.linkedinUrl).toBe('https://linkedin.com/in/daria-sokolova');
    });

    it('помечает гипотезы корпоративной почты статусом hypothesis при отсутствии прямого подтверждения', async () => {
      const vacancy: UnifiedVacancyInput = {
        id: 'vac-2',
        company: 'Fintech Orbit',
        url: 'https://fintechorbit.com/careers/lead',
        description: 'Нанимающий менеджер: Михаил Ковалев. Пишите на почту.',
      };

      const contacts = await discoverRecruiterContacts(vacancy, {
        mxResolver: async () => [{ exchange: 'mx.fintechorbit.com', priority: 10 }],
        smtpValidator: async () => false, // SMTP не подтвердил
      });

      expect(contacts.length).toBeGreaterThanOrEqual(1);
      const contact = contacts[0];
      expect(contact.fullName).toBe('Михаил Ковалев');
      expect(contact.emailStatus).toBe('hypothesis');
      expect(contact.email).toBe('mikhail.kovalev@fintechorbit.com');
    });

    it('соблюдает нулевые галлюцинации: если нет контактов и домена, возвращает пустой список', async () => {
      const vacancy: UnifiedVacancyInput = {
        id: 'vac-empty',
        company: 'Неизвестная Компания',
        description: 'Требуется разработчик. Обязанности: писать код.',
      };

      const contacts = await discoverRecruiterContacts(vacancy, {
        mxResolver: async () => [],
      });

      expect(contacts).toEqual([]);
    });
  });
});

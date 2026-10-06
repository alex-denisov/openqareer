import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from '../domain/resumeDraft';
import {
  buildCandidateFootprintQueryPlan,
  extractUnidentifiedEmployers,
  toPublicFootprintQueryPlan,
} from './candidateFootprintQueryPlan';

describe('candidate footprint query plan', () => {
  it('lists only candidate profile identifiers and lets the candidate review masked email use', () => {
    const draft: ResumeDraft = {
      candidate: {
        fullName: 'Maria Petrova',
        photoUrl: 'https://images.example/maria.jpg',
        contact: {
          email: 'maria@example.test',
          phone: '+44 20 7946 0958',
          location: 'London, UK',
          telegram: '@maria_dev',
          linkedinUrl: 'https://www.linkedin.com/in/maria-petrova/',
          links: [
            'https://github.com/maria-dev',
            'https://portfolio.example/about',
            'https://malformed.example/not-profile',
          ],
        },
      },
      experience: [
        {
          id: 'experience-1',
          chronologyMemoryId: 'memory-1',
          title: 'Engineer',
          employer: 'Analytical Engines',
          current: true,
          bulletMemoryIds: [],
        },
        {
          id: 'experience-2',
          chronologyMemoryId: 'memory-2',
          title: 'Consultant',
          employer: 'Difference Company',
          current: false,
          bulletMemoryIds: [],
        },
      ],
      education: [],
      languages: [],
    };

    const internalPlan = buildCandidateFootprintQueryPlan(draft);
    const publicPlan = toPublicFootprintQueryPlan(internalPlan);
    const usernames = internalPlan.filter(
      (item): item is typeof item & { input: { readonly username: string } } =>
        'username' in item.input,
    );
    const email = internalPlan.find((item) => item.adapterId === 'hibp');
    const contextSearches = internalPlan.filter((item) => item.kind === 'work_context');

    expect(usernames.map((item) => `${item.adapterId}:${item.input.username}`)).toContain(
      'sherlock:maria-dev',
    );
    expect(usernames.map((item) => `${item.adapterId}:${item.input.username}`)).toContain(
      'maigret:maria-dev',
    );
    expect(email?.input).toEqual({ email: 'maria@example.test' });
    expect(contextSearches).toHaveLength(3);
    expect(contextSearches.some((item) => item.preview.includes('Analytical Engines'))).toBe(true);
    expect(contextSearches.some((item) => item.preview.includes('Difference Company'))).toBe(true);
    expect(contextSearches.some((item) => item.preview.includes('London, UK'))).toBe(true);
    expect(contextSearches.every((item) => item.adapterId === 'exa')).toBe(true);
    expect(publicPlan.some((item) => item.preview.includes('maria@example.test'))).toBe(false);
    expect(publicPlan.some((item) => item.preview.includes('+44 20 7946 0958'))).toBe(false);
    expect(JSON.stringify(publicPlan)).not.toContain('https://images.example/maria.jpg');
    expect(publicPlan.every((item) => item.selectedByDefault)).toBe(true);
    expect(new Set(publicPlan.map((item) => item.id)).size).toBe(publicPlan.length);
  });

  it('does not create searches when the profile has no identifiers', () => {
    const draft: ResumeDraft = {
      candidate: {},
      experience: [],
      education: [],
      languages: [],
    };

    expect(buildCandidateFootprintQueryPlan(draft)).toEqual([]);
  });

  it('B375: если у кандидата есть ссылка LinkedIn или ник, создаются проверки Sherlock, Maigret и Wayback', () => {
    const draftWithNick: ResumeDraft = {
      candidate: {
        contact: {
          telegram: '@alexey_lead',
        },
      },
      experience: [],
      education: [],
      languages: [],
    };
    const planFromNick = buildCandidateFootprintQueryPlan(draftWithNick);
    expect(planFromNick.some((item) => item.adapterId === 'sherlock')).toBe(true);
    expect(planFromNick.some((item) => item.adapterId === 'maigret')).toBe(true);
    expect(planFromNick.some((item) => item.adapterId === 'wayback')).toBe(true);

    const draftWithLinkedin: ResumeDraft = {
      candidate: {
        contact: {
          linkedinUrl: 'https://linkedin.com/in/alexey-denisov',
        },
      },
      experience: [],
      education: [],
      languages: [],
    };
    const planFromLi = buildCandidateFootprintQueryPlan(draftWithLinkedin);
    expect(planFromLi.some((item) => item.adapterId === 'sherlock')).toBe(true);
    expect(planFromLi.some((item) => item.adapterId === 'maigret')).toBe(true);
    expect(planFromLi.some((item) => item.adapterId === 'wayback')).toBe(true);
  });

  it('B375: HIBP предлагается отдельным пунктом «Проверить утечки по почте» с пометкой, что нужно согласие', () => {
    const draft: ResumeDraft = {
      candidate: {
        fullName: 'Иван Иванов',
        contact: {
          email: 'ivan@example.com',
        },
      },
      experience: [],
      education: [],
      languages: [],
    };
    const plan = buildCandidateFootprintQueryPlan(draft);
    const hibpItem = plan.find((item) => item.adapterId === 'hibp');
    expect(hibpItem).toBeDefined();
    expect(hibpItem?.preview).toContain('Проверить утечки по почте');
    expect(hibpItem?.preview).toContain('согласие');
  });

  it('B375: не включает описания вместо компаний в план запросов и выделяет их как неопределённые', () => {
    const draft: ResumeDraft = {
      candidate: {
        fullName: 'Алексей Иванов',
      },
      experience: [
        {
          id: 'exp-1',
          chronologyMemoryId: 'mem-1',
          title: 'Architect',
          employer: 'Enterprise Public Cloud Platform (IaaS / PaaS)',
          current: true,
          bulletMemoryIds: [],
        },
        {
          id: 'exp-2',
          chronologyMemoryId: 'mem-2',
          title: 'Lead',
          employer: 'Corporate University of a Top-Tier Financial Institution',
          current: false,
          bulletMemoryIds: [],
        },
        {
          id: 'exp-3',
          chronologyMemoryId: 'mem-3',
          title: 'Senior Engineer',
          employer: 'Яндекс',
          current: false,
          bulletMemoryIds: [],
        },
      ],
      education: [],
      languages: [],
    };
    const plan = buildCandidateFootprintQueryPlan(draft);
    const employerSearches = plan.filter((item) => item.kind === 'work_context');
    // Яндекс должен быть в плане
    expect(employerSearches.some((item) => item.preview.includes('Яндекс'))).toBe(true);
    // Описания не должны попадать в план
    expect(
      employerSearches.some((item) =>
        item.preview.includes('Enterprise Public Cloud Platform'),
      ),
    ).toBe(false);
    expect(
      employerSearches.some((item) =>
        item.preview.includes('Corporate University of a Top-Tier'),
      ),
    ).toBe(false);

    // extractUnidentifiedEmployers возвращает неопределённые компании
    const unidentified = extractUnidentifiedEmployers(draft);
    expect(unidentified).toEqual([
      'Enterprise Public Cloud Platform (IaaS / PaaS)',
      'Corporate University of a Top-Tier Financial Institution',
    ]);

    // Ручной ввод добавляет компанию в план запросов
    const planWithManual = buildCandidateFootprintQueryPlan(draft, {
      manualEmployers: ['Acme Corp', 'Сбер'],
    });
    const manualSearches = planWithManual.filter((item) => item.kind === 'work_context');
    expect(manualSearches.some((item) => item.preview.includes('Acme Corp'))).toBe(true);
    expect(manualSearches.some((item) => item.preview.includes('Сбер'))).toBe(true);
  });
});


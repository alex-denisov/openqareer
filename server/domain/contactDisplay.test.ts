import { describe, expect, it } from 'vitest';
import { cleanPersonName, looksLikeOrganization, shortRoleTitle } from './contactDisplay';

describe('contact display (B645 a02)', () => {
  it('drops emoji and other non-letters around the name', () => {
    expect(cleanPersonName('🟠Ирена Иванова')).toBe('Ирена Иванова');
    expect(cleanPersonName('  ★ John Smith ✅ ')).toBe('John Smith');
    expect(cleanPersonName('Анна-Мария О’Нил')).toBe('Анна-Мария О’Нил');
  });

  it('recognises an organisation written in the name field', () => {
    expect(looksLikeOrganization("3G AGENT Co., Ltd (ASEAN) We're specializing in Recruitment")).toBe(true);
    expect(looksLikeOrganization('ООО Ромашка')).toBe(true);
    expect(looksLikeOrganization('Acme Inc')).toBe(true);
    expect(looksLikeOrganization('Ирена Иванова')).toBe(false);
    expect(looksLikeOrganization('Jean-Luc van der Berg')).toBe(false);
  });

  it('keeps the job title only, before « | » or « at »', () => {
    expect(
      shortRoleTitle('CPO at Positive Technologies | AppSec Product Portfolio $50M+ | Ex-Deputy CEO'),
    ).toBe('CPO');
    expect(shortRoleTitle('Head of Talent | Hiring engineers')).toBe('Head of Talent');
    expect(shortRoleTitle('Рекрутер @ Яндекс')).toBe('Рекрутер');
    expect(shortRoleTitle('Руководитель найма')).toBe('Руководитель найма');
  });

  it('cuts a long title at a word, with an ellipsis', () => {
    const out = shortRoleTitle('Senior Technical Recruiter for Data Science Machine Learning and Platform Engineering teams');
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith('…')).toBe(true);
  });
});

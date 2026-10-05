import { describe, expect, it } from 'vitest';
import {
  generateCompanyReminderDraft,
  type CompanyReminderDraftInput,
} from './companyReminderDraft';

describe('generateCompanyReminderDraft', () => {
  it('generates polite reminder mentioning company and position', () => {
    const input: CompanyReminderDraftInput = {
      company: 'ТехноСфера',
      positionTitle: 'Senior Frontend Developer',
      promisedDate: '2026-10-06',
    };
    const draft = generateCompanyReminderDraft(input);

    expect(draft).toContain('ТехноСфера');
    expect(draft).toContain('Senior Frontend Developer');
    expect(draft).toContain('06.10.2026');
    expect(draft).toContain('уточнить статус');
    const emojiPattern = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|\u{FE0F}/u;
    expect(draft).not.toMatch(emojiPattern);
    expect(draft.toLowerCase()).not.toContain('follow-up');
    expect(draft.toLowerCase()).not.toContain('followup');
  });

  it('handles empty company gracefully without breaking phrasing', () => {
    const input: CompanyReminderDraftInput = {
      positionTitle: 'Руководитель проектов',
    };
    const draft = generateCompanyReminderDraft(input);

    expect(draft).toContain('Руководитель проектов');
    expect(draft).toContain('уточнить статус');
    expect(draft).not.toContain('в компании undefined');
    expect(draft).not.toContain('в компании null');
  });

  it('includes promised deadline note when promisedDate is provided', () => {
    const input: CompanyReminderDraftInput = {
      company: 'Яндекс',
      positionTitle: 'QA Lead',
      promisedDate: '2026-10-10',
    };
    const draft = generateCompanyReminderDraft(input);
    expect(draft).toContain('10.10.2026');
    expect(draft).toContain('договаривались');
  });
});

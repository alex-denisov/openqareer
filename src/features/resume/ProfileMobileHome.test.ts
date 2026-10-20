import { describe, expect, it } from 'vitest';
import { suggestionTopics } from './ProfileMobileHome';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';

const item = (field?: InlineSuggestionItem['field']): InlineSuggestionItem => ({
  id: field ?? 'bullet',
  section: 'experience',
  proposedText: '1',
  field,
});

describe('mobile suggestions card topics (B540)', () => {
  it('names the team size before the dates', () => {
    expect(suggestionTopics([item('endDate'), item('teamSize')])).toBe('размер команды и даты');
  });

  it('keeps the existing bullet and date wording', () => {
    expect(suggestionTopics([item('startDate'), item()])).toBe('пункты опыта и даты');
  });
});

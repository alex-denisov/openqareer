import { describe, expect, it } from 'vitest';
import { summarizeSearchGeography } from './searchConditionsSummary';

describe('summarizeSearchGeography', () => {
  it('says nothing is set when the profile has neither places nor formats', () => {
    expect(summarizeSearchGeography({ citizenship: [], workFormats: [] })).toBeNull();
  });

  it('joins places and format labels from the stored profile', () => {
    expect(
      summarizeSearchGeography({
        citizenship: ['Москва'],
        workFormats: ['office', 'remote_home'],
      }),
    ).toBe('Москва · Удалёнка из РФ, Офис');
  });

  it('shows only formats when no place is stored', () => {
    expect(summarizeSearchGeography({ citizenship: [], workFormats: ['relocation'] })).toBe(
      'Релокация',
    );
  });
});

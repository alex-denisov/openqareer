import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  businessDaysBetween,
  computeFollowUpStatus,
} from './followUpPolicy';

// 2024-01-01 is a Monday; 01-06/01-07 and 01-13/01-14 are the surrounding
// weekends used across this table (architecture.md §6 QA: business-day table
// with weekends and overnight timezone crossings).
describe('businessDaysBetween / addBusinessDays', () => {
  it('skips weekends when counting business days', () => {
    expect(businessDaysBetween('2024-01-01T09:00:00Z', '2024-01-08T09:00:00Z')).toBe(5);
    expect(businessDaysBetween('2024-01-01T09:00:00Z', '2024-01-06T09:00:00Z')).toBe(4);
    expect(businessDaysBetween('2024-01-01T09:00:00Z', '2024-01-07T09:00:00Z')).toBe(4);
  });

  it('lands the 5th/8th/10th business day on the matching weekday, at local midnight', () => {
    expect(addBusinessDays('2024-01-01T09:00:00Z', 5)).toBe('2024-01-08T00:00:00.000Z');
    expect(addBusinessDays('2024-01-01T09:00:00Z', 8)).toBe('2024-01-11T00:00:00.000Z');
    expect(addBusinessDays('2024-01-01T09:00:00Z', 10)).toBe('2024-01-15T00:00:00.000Z');
  });

  it('shifts the local calendar day across midnight for a non-UTC timezone', () => {
    // 23:00 UTC Sunday is already 02:00 Monday in UTC+3: the anchor day
    // itself differs, so the next business day differs too.
    const contact = '2024-01-07T23:00:00Z';
    expect(addBusinessDays(contact, 1, 0)).toBe('2024-01-08T00:00:00.000Z');
    expect(addBusinessDays(contact, 1, 180)).toBe('2024-01-08T21:00:00.000Z');
  });
});

describe('computeFollowUpStatus — standard profile', () => {
  const lastContactAt = '2024-01-01T09:00:00Z';

  it('is upcoming before the 5th business day', () => {
    const status = computeFollowUpStatus({
      processProfile: 'standard',
      lastContactAt,
      now: '2024-01-03T09:00:00Z',
    });
    expect(status.urgency).toBe('upcoming');
    expect(status.source).toBe('standard_schedule');
    expect(status.dueAt).toBe('2024-01-08T00:00:00.000Z');
  });

  it('is due from the 5th business day', () => {
    const status = computeFollowUpStatus({
      processProfile: 'standard',
      lastContactAt,
      now: '2024-01-08T09:00:00Z',
    });
    expect(status.urgency).toBe('due');
    expect(status.businessDaysSinceContact).toBe(5);
  });

  it('is stale after the 10th business day', () => {
    const status = computeFollowUpStatus({
      processProfile: 'standard',
      lastContactAt,
      now: '2024-01-15T09:00:00Z',
    });
    expect(status.urgency).toBe('stale');
    expect(status.businessDaysSinceContact).toBe(10);
  });
});

describe('computeFollowUpStatus — executive profile', () => {
  const lastContactAt = '2024-01-01T09:00:00Z';

  it('opens the window on calendar day 7 and closes it on day 10', () => {
    const beforeWindow = computeFollowUpStatus({
      processProfile: 'executive',
      lastContactAt,
      now: '2024-01-06T09:00:00Z',
    });
    expect(beforeWindow.urgency).toBe('upcoming');

    const insideWindow = computeFollowUpStatus({
      processProfile: 'executive',
      lastContactAt,
      now: '2024-01-08T09:00:00Z',
    });
    expect(insideWindow.urgency).toBe('due');
    expect(insideWindow.source).toBe('executive_window');

    const afterWindow = computeFollowUpStatus({
      processProfile: 'executive',
      lastContactAt,
      now: '2024-01-12T09:00:00Z',
    });
    expect(afterWindow.urgency).toBe('stale');
  });
});

describe('computeFollowUpStatus — company deadline', () => {
  it('overrides the standard schedule even while it would otherwise be upcoming', () => {
    const status = computeFollowUpStatus({
      processProfile: 'standard',
      lastContactAt: '2024-01-01T09:00:00Z',
      companyDueAt: '2024-01-03T00:00:00Z',
      now: '2024-01-02T09:00:00Z',
    });
    expect(status.source).toBe('company_deadline');
    expect(status.urgency).toBe('upcoming');
    expect(status.dueAt).toBe('2024-01-03T00:00:00Z');
  });

  it('overrides the executive window and reports overdue once it has passed', () => {
    const status = computeFollowUpStatus({
      processProfile: 'executive',
      lastContactAt: '2024-01-01T09:00:00Z',
      companyDueAt: '2024-01-02T00:00:00Z',
      now: '2024-01-05T09:00:00Z',
    });
    expect(status.source).toBe('company_deadline');
    expect(status.urgency).toBe('due');
  });
});

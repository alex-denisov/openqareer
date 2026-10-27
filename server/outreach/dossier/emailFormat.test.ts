import { describe, expect, it } from 'vitest';
import { applyEmailFormat, inferEmailFormat, samplesFromText } from './emailFormat';

describe('email format from public examples', () => {
  it('finds the format that most public addresses follow', () => {
    const format = inferEmailFormat([
      { fullName: 'John Doe', email: 'j.doe@acme.com' },
      { fullName: 'Mary Major', email: 'm.major@acme.com' },
      { fullName: 'Ivan Petrov', email: 'ivan@acme.com' },
    ]);
    expect(format?.id).toBe('f.last');
    expect(format?.support).toBe(2);
  });

  it('gives no format without an address matching a name', () => {
    expect(inferEmailFormat([{ fullName: 'John Doe', email: 'info@acme.com' }])).toBeNull();
  });

  it('builds the address of a Cyrillic name in Latin letters', () => {
    expect(applyEmailFormat('firstlast', 'Анна Смирнова', 'acme.ru')).toBe('annasmirnova@acme.ru');
    expect(applyEmailFormat('last.first', 'Anna Smith', 'acme.com')).toBe('smith.anna@acme.com');
  });

  it('pairs company addresses with the names written next to them', () => {
    const text = 'Team\nJohn Doe, Head of Sales — john.doe@acme.com\nPress: press@acme.com\nMary Major mary.major@acme.com\nfoo@other.com';
    expect(samplesFromText(text, 'acme.com')).toEqual([
      { fullName: 'John Doe', email: 'john.doe@acme.com' },
      { fullName: 'Mary Major', email: 'mary.major@acme.com' },
    ]);
  });
});

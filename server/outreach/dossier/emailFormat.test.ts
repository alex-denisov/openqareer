import { describe, expect, it } from 'vitest';
import { applyEmailFormat, inferEmailFormat, samplesFromText } from './emailFormat';

describe('email format from public examples', () => {
  it('finds the format that most public addresses follow', () => {
    const format = inferEmailFormat([
      { fullName: 'John Carter', email: 'j.carter@acme.com' },
      { fullName: 'Mary Major', email: 'm.major@acme.com' },
      { fullName: 'Ivan Petrov', email: 'ivan@acme.com' },
    ]);
    expect(format?.id).toBe('f.last');
    expect(format?.support).toBe(2);
  });

  it('gives no format without an address matching a name', () => {
    expect(inferEmailFormat([{ fullName: 'John Carter', email: 'info@acme.com' }])).toBeNull();
  });

  it('builds the address of a Cyrillic name in Latin letters', () => {
    expect(applyEmailFormat('firstlast', 'Анна Смирнова', 'acme.ru')).toBe('annasmirnova@acme.ru');
    expect(applyEmailFormat('last.first', 'Anna Smith', 'acme.com')).toBe('smith.anna@acme.com');
  });

  it('pairs company addresses with the names written next to them', () => {
    const text = 'Team\nJohn Carter, Head of Sales — john.carter@acme.com\nPress: press@acme.com\nMary Major mary.major@acme.com\nfoo@other.com';
    expect(samplesFromText(text, 'acme.com')).toEqual([
      { fullName: 'John Carter', email: 'john.carter@acme.com' },
      { fullName: 'Mary Major', email: 'mary.major@acme.com' },
    ]);
  });
  it('ignores shared mailboxes and placeholder names', () => {
    const text = 'Recruiting Team recruiting@acme.com. Example: Jane Smith jane.smith@acme.com';
    expect(samplesFromText(text, 'acme.com')).toEqual([]);
  });
});

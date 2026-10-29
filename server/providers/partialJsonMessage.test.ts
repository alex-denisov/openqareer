import { describe, expect, it } from 'vitest';
import { partialJsonMessage } from './partialJsonMessage';

describe('partialJsonMessage', () => {
  it('reads the message while its string is still open', () => {
    expect(partialJsonMessage('{"message":"Уточним мас')).toBe('Уточним мас');
  });

  it('returns the whole message once the string is closed', () => {
    expect(partialJsonMessage('{"message":"Готово.","phase":"evid')).toBe('Готово.');
  });

  it('returns nothing before the message value starts', () => {
    expect(partialJsonMessage('')).toBeUndefined();
    expect(partialJsonMessage('{"mess')).toBeUndefined();
    expect(partialJsonMessage('{"message"')).toBeUndefined();
    expect(partialJsonMessage('{"message": ')).toBeUndefined();
  });

  it('decodes escapes and holds back an escape cut by the chunk boundary', () => {
    expect(partialJsonMessage('{"message":"a\\nb \\"c\\" \\u0434')).toBe('a\nb "c" д');
    expect(partialJsonMessage('{"message":"a\\')).toBe('a');
    expect(partialJsonMessage('{"message":"a\\u04')).toBe('a');
  });

  it('holds back a high surrogate until its pair arrives', () => {
    expect(partialJsonMessage('{"message":"x\\ud83d')).toBe('x');
    expect(partialJsonMessage('{"message":"x\\ud83d\\ude00')).toBe('x😀');
  });

  it('finds a top-level message after other fields and ignores nested ones', () => {
    const raw = '{"phase":"role","safety":{"message":"no"},"list":["message"],"message":"да';
    expect(partialJsonMessage(raw)).toBe('да');
  });

  it('skips a code fence or prose before the object', () => {
    expect(partialJsonMessage('```json\n{"message":"Привет')).toBe('Привет');
  });

  it('ignores a message that is not a string', () => {
    expect(partialJsonMessage('{"message":null,"phase":"role"}')).toBeUndefined();
  });
});

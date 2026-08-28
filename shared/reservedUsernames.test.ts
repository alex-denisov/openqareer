import { describe, expect, it } from 'vitest';
import { isReservedUsername } from './reservedUsernames';

describe('isReservedUsername', () => {
  it.each([
    ['admin', true],
    ['ADMIN', true],
    ['admin.test', true],
    [' support ', true],
    ['administrator2', false],
    ['alexey', false],
    ['', false],
    ['   ', false],
  ])('evaluates %s as %s', (username, expected) => {
    expect(isReservedUsername(username)).toBe(expected);
  });
});

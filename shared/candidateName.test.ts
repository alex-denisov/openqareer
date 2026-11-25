import { describe, expect, it } from 'vitest';
import { nameFact } from './candidateName';

describe('nameFact: похожие подписи «Name» в одной форме', () => {
  it.each([
    ['Name', ['Name', 'Email'], 'fullName'],
    ['Name', ['Name', 'Company name'], 'fullName'],
    ['Company name', ['Name', 'Company name'], null],
    ["Referee's name", ['Name', "Referee's name"], null],
    ['Name', ['Name', 'Last name'], 'firstName'],
    ['Name', ['Name', 'Email', 'Name'], null],
    ['name', ['Name', 'name'], null],
    ['Name', ['Name', 'Last name', 'Name'], null],
    ['Last name', ['Last name', 'Last name'], null],
    ['First name', ['First name', 'First name'], null],
    ['Name', ['Full name', 'Name'], null],
    ['Full name', ['Full name', 'Name'], 'fullName'],
    ['Имя', ['Имя', 'Name'], null],
    ['Имя', ['Имя', 'Имя рекомендателя'], 'fullName'],
  ] as const)('%s в форме %j — %s', (label, labels, fact) => {
    expect(nameFact(label, labels)).toBe(fact);
  });
});

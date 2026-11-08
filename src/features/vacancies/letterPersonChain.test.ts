import { describe, expect, it } from 'vitest';
import { personChain, shortPersonName } from './letterPersonChain';
import type { ConnectionCirclePath } from './vacancyLetterApi';

const person = (id: string, fullName: string) => ({ id, fullName, roleTitle: null, companyName: null });
const candidate = person('candidate-1', 'Андрей Лебедев');
const maria = person('p-maria', 'Мария Крылова');
const irina = person('p-irina', 'Ирина Соколова');

function path(chain: ReturnType<typeof person>[], recipient = irina): ConnectionCirclePath {
  return {
    id: 'path-1',
    circle: 2,
    recipient,
    path: chain,
    evidence: [],
    strength: 'strong',
    source: 'manual',
    nextStep: 'ask_for_introduction',
  } as ConnectionCirclePath;
}

describe('shortPersonName: «Имя Ф.» как в макете 9', () => {
  it('сокращает фамилию до инициала', () => {
    expect(shortPersonName('Мария Крылова')).toBe('Мария К.');
    expect(shortPersonName('John Smith')).toBe('John S.');
  });

  it('берёт последнее слово как фамилию, отчество выпадает', () => {
    expect(shortPersonName('Иван Петрович Сидоров')).toBe('Иван С.');
  });

  it('не трогает одно имя и название команды', () => {
    expect(shortPersonName('Мария')).toBe('Мария');
    expect(shortPersonName('Команда найма')).toBe('Команда найма');
    expect(shortPersonName('  ')).toBe('');
  });
});

describe('personChain: шапка Круга 2 без кандидата (макет 9)', () => {
  it('начинается с первого посредника: кандидат, которого сервер ставит первым, не показывается', () => {
    expect(personChain(path([candidate, maria, irina]))).toBe('Мария К. → Ирина С.');
  });

  it('дописывает получателя, если пути его не хватает', () => {
    expect(personChain(path([candidate, maria]))).toBe('Мария К. → Ирина С.');
  });

  it('путь без посредников даёт одного получателя', () => {
    expect(personChain(path([candidate]))).toBe('Ирина С.');
    expect(personChain(path([]))).toBe('Ирина С.');
  });
});

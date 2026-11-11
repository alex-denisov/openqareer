import { describe, expect, it } from 'vitest';
import { hhEmployerIds } from './hhEmployerLinks';

describe('B643 hh employer links on company pages', () => {
  it('reads employer ids from hh.ru, its regional hosts and hh.kz/uz/by', () => {
    const html = `<a href="https://hh.ru/employer/1740">hh</a>
      <a href="https://spb.hh.ru/employer/1740?hhtmFrom=x">again</a>
      <a href="//almaty.hh.kz/employer/3529">kz</a> https://hh.uz/employer/77`;
    expect(hhEmployerIds(html)).toEqual(['1740', '3529', '77']);
  });

  it('reads escaped links inside page scripts', () => {
    expect(hhEmployerIds(`{"hh":"https:\\/\\/hh.ru\\/employer\\/9498112"}`)).toEqual(['9498112']);
  });

  it('ignores vacancies, other hosts and look-alike domains', () => {
    const html = `https://hh.ru/vacancy/123 https://hh.ru/employer/ https://notahh.ru/employer/5
      https://hh.ru.evil.com/employer/6 https://hh.ru/employer/abc https://hh.com/employer/7`;
    expect(hhEmployerIds(html)).toEqual([]);
  });

  it('keeps nothing when a page links more than three employers: a list, not the company', () => {
    const html = [1, 2, 3, 4].map((n) => `https://hh.ru/employer/${n}`).join(' ');
    expect(hhEmployerIds(html)).toEqual([]);
  });
});

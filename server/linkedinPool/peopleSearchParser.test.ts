import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseLinkedinCompanyIdFromPageHtml,
  parseLinkedinPeopleSearchPageHtml,
} from './peopleSearchParser';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/people-search-company-recruiter.html', import.meta.url)),
  'utf8',
);

describe('parseLinkedinPeopleSearchPageHtml', () => {
  it('читает 10 скрытых карточек фикстуры: имя и ссылка пусты, есть должность и город', () => {
    const cards = parseLinkedinPeopleSearchPageHtml(fixture);
    expect(cards).toHaveLength(10);
    expect(cards[0]).toEqual({
      fullName: null,
      linkedinUrl: null,
      headline: 'Lead Recruiter',
      location: 'Amsterdam, North Holland, Netherlands',
    });
    expect(cards[2]?.headline).toContain('Trips & CS Business Units at Booking.com');
    expect(cards[2]?.location).toBe('Manchester, England, United Kingdom');
  });

  it('видимый человек 2-го круга сохраняет имя и ссылку /in/', () => {
    const html = `<p class="a"><a href="https://www.linkedin.com/in/jane-doe/?x=1"><span aria-hidden="true">Jane Doe</span></a></p>
      <div><p><span>Senior Recruiter at Acme</span></p></div><div><p><span>Berlin, Germany</span></p></div>`;
    expect(parseLinkedinPeopleSearchPageHtml(html)).toEqual([
      {
        fullName: 'Jane Doe',
        linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
        headline: 'Senior Recruiter at Acme',
        location: 'Berlin, Germany',
      },
    ]);
  });

  it('пустой и слишком большой документ дают пустой список', () => {
    expect(parseLinkedinPeopleSearchPageHtml('')).toEqual([]);
    expect(parseLinkedinPeopleSearchPageHtml('x'.repeat(3 * 1024 * 1024 + 1))).toEqual([]);
  });
});

describe('parseLinkedinCompanyIdFromPageHtml', () => {
  it('берёт самый частый fsd_company, а не «похожие компании»', () => {
    const html = [
      ...Array(3).fill('urn:li:fsd_company:(777)'),
      ...Array(5).fill('urn:li:fsd_company:(11348)'),
      ...Array(2).fill('urn:li:fsd_company:(42)'),
    ].join(' ');
    expect(parseLinkedinCompanyIdFromPageHtml(html)).toBe('11348');
  });

  it('без ID возвращает null', () => {
    expect(parseLinkedinCompanyIdFromPageHtml('<html></html>')).toBeNull();
  });
});

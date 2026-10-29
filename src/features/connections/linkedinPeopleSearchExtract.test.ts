// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  extractLinkedInPeopleSearch,
  linkedinPeopleSearchUrl,
} from './linkedinPeopleSearchExtract';

/**
 * One result card as the sanitized read returns it, rebuilt from the 29.10
 * capture of `/search/results/people/?keywords=…&network=["F"]` (B561). The
 * whole card is one profile link; the name paragraph links the person again,
 * and the mutual-connections line below the snippet links other people.
 * Names, slugs and ids are fictional.
 */
function card(input: {
  readonly slug: string;
  readonly name: string;
  readonly headline: string;
  readonly snippet?: string;
  readonly mutual?: readonly string[];
  readonly degree?: string;
}): string {
  const snippet =
    input.snippet === undefined
      ? '<div componentkey="SearchResultssnippet_ACoAAFAKE1"><div></div></div>'
      : `<div componentkey="SearchResultssnippet_ACoAAFAKE1"><div><p><span>${input.snippet}</span></p></div></div>`;
  const mutual = (input.mutual ?? [])
    .map((slug) => `<a href="/in/${slug}/">Общий Знакомый</a>,<span> </span>`)
    .join('');
  return `<div class="ajrlr8"><div><div><a componentkey="c1" href="/in/${input.slug}/">
<div componentkey="c1"><div><figure></figure><div>
<p componentkey="p1"><a href="/in/${input.slug}/">${input.name}</a><span><span> • ${input.degree ?? '1st'}</span></span></p>
<div><p><span>${input.headline}</span></p></div>
<div><p><span>Москва, Россия</span></p></div></div>
<div><div componentkey="SearchResultsACoAAFAKE1"><div><div componentkey="m1"><div><a componentkey="m2"><span><span>Message</span></span></a></div></div></div></div></div></div>
${snippet}
<div componentkey="d1"><ul><li><figure></figure></li></ul><div><p componentkey="p2"><span>${mutual}<span> </span>&amp;<span> </span><a>12 other mutual connections</a></span></p></div></div>
</div></a></div><hr></div></div>`;
}

const page = (cards: readonly string[]) => `<main><div><ul>${cards.join('')}</ul></div></main>`;

describe('extractLinkedInPeopleSearch (B561)', () => {
  it('reads the current role and company from the snippet, not the headline', () => {
    const html = page([
      card({
        slug: 'anna-test-1',
        name: 'Анна Тестова',
        headline: 'Product | Fintech | AI',
        snippet: 'Current: Head of Product at<span> </span><span><strong>Вектор</strong></span>',
        mutual: ['boris-test-2', 'vera-test-3'],
      }),
    ]);

    expect(extractLinkedInPeopleSearch(html)).toEqual({
      cards: 1,
      people: [
        {
          fullName: 'Анна Тестова',
          linkedinUrl: 'https://www.linkedin.com/in/anna-test-1/',
          roleTitle: 'Head of Product',
          companyName: 'Вектор',
        },
      ],
    });
  });

  it('keeps the words after the highlighted keyword as part of the company', () => {
    const html = page([
      card({
        slug: 'dmitry-test-4',
        name: 'Дмитрий Пробный',
        headline: 'Engineer',
        snippet:
          'Current: Lead of Search &amp; ML at<span> </span><span><strong>Вектор</strong></span><span> </span>Облако',
      }),
    ]);

    expect(extractLinkedInPeopleSearch(html).people[0]).toMatchObject({
      roleTitle: 'Lead of Search & ML',
      companyName: 'Вектор Облако',
    });
  });

  it('skips a card whose snippet is empty or names a past job', () => {
    const html = page([
      card({ slug: 'empty-test-5', name: 'Без Сниппета', headline: 'CTO at Арка' }),
      card({
        slug: 'past-test-6',
        name: 'Прошлое Место',
        headline: 'Consultant',
        snippet: 'Past: Analyst at<span> </span><span><strong>Вектор</strong></span>',
      }),
    ]);

    expect(extractLinkedInPeopleSearch(html)).toEqual({ cards: 2, people: [] });
  });

  it('never takes a mutual connection for the person on the card', () => {
    const html = page([
      card({
        slug: 'gleb-test-7',
        name: 'Глеб Образцов',
        headline: 'Designer',
        snippet: 'Current: Designer at<span> </span><span><strong>Вектор</strong></span>',
        mutual: ['zoya-test-8'],
      }),
      card({
        slug: 'zoya-test-8',
        name: 'Зоя Макетова',
        headline: 'Recruiter',
        snippet: 'Current: Recruiter at<span> </span><span><strong>Вектор</strong></span>',
        mutual: ['gleb-test-7'],
      }),
    ]);

    const people = extractLinkedInPeopleSearch(html).people;
    expect(people.map((person) => [person.fullName, person.linkedinUrl])).toEqual([
      ['Глеб Образцов', 'https://www.linkedin.com/in/gleb-test-7/'],
      ['Зоя Макетова', 'https://www.linkedin.com/in/zoya-test-8/'],
    ]);
  });

  it('takes only people marked as 1st-degree connections', () => {
    const html = page([
      card({
        slug: 'second-test-9',
        name: 'Второй Круг',
        headline: 'PM',
        degree: '2nd',
        snippet: 'Current: PM at<span> </span><span><strong>Вектор</strong></span>',
      }),
      card({
        slug: 'ru-test-10',
        name: 'Первый Круг',
        headline: 'PM',
        degree: '1-й',
        snippet: 'Current: PM at<span> </span><span><strong>Вектор</strong></span>',
      }),
    ]);

    expect(extractLinkedInPeopleSearch(html).people.map((person) => person.fullName)).toEqual([
      'Первый Круг',
    ]);
  });

  it('reads nothing from a page without result cards', () => {
    expect(extractLinkedInPeopleSearch('<main><p>No results found</p></main>')).toEqual({
      cards: 0,
      people: [],
    });
  });
});

describe('linkedinPeopleSearchUrl (B561)', () => {
  it('searches first-degree connections by the company name', () => {
    expect(linkedinPeopleSearchUrl('Вектор Банк', 1)).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=%D0%92%D0%B5%D0%BA%D1%82%D0%BE%D1%80+%D0%91%D0%B0%D0%BD%D0%BA&network=%5B%22F%22%5D',
    );
    expect(linkedinPeopleSearchUrl('Acme', 2)).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=Acme&network=%5B%22F%22%5D&page=2',
    );
  });
});

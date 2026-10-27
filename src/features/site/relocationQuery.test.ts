import { describe, expect, it } from 'vitest';
import { RELOCATION_EXAMPLE } from '../../../shared/countryFit/relocationEstimate';
import { parseRelocationQuery, relocationQuery } from './relocationQuery';

describe('relocation answers in the address (B354)', () => {
  it('a copied link opens the same answers', () => {
    expect(parseRelocationQuery(relocationQuery(RELOCATION_EXAMPLE))).toEqual(RELOCATION_EXAMPLE);
  });

  it.each([
    'c=XX&p=it&x=5&d=0&en=B2&f=partner&net=5000&cur=EUR&to=DE',
    'c=RU&p=it&x=5&d=0&en=B2&f=partner&net=0&cur=EUR&to=DE',
    'c=RU&p=it&x=5&d=0&en=B2&f=partner&net=5000&cur=EUR&to=US',
    'c=RU&p=it&x=5&d=0&en=B2&f=partner&net=5000&cur=EUR&to=DE,DE',
    'c=RU&p=it&x=5&d=2&en=B2&f=partner&net=5000&cur=EUR&to=DE',
    'c=RU&p=it&x=-1&d=0&en=B2&f=partner&net=5000&cur=USD&to=DE',
    'c=RU&p=it&x=5&d=0&en=B2&f=partner&net=5000&cur=EUR&to=DE,AE,GE,CY',
    '',
  ])('rejects an invalid link %s', (search) => {
    expect(parseRelocationQuery(search)).toBeUndefined();
  });
});

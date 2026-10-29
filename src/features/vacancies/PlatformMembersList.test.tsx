import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlatformMembersList } from './PlatformMembersList';

describe('PlatformMembersList (B561)', () => {
  it('names each member with a LinkedIn link, the person there and a ready first message', () => {
    const html = renderToStaticMarkup(
      <PlatformMembersList
        companyName="Northwind Labs"
        members={[
          {
            fullName: 'Ulla Member',
            linkedinUrl: 'https://www.linkedin.com/in/ulla-member/',
            personName: 'Jane Roe',
          },
          { fullName: 'Olga Nolink', linkedinUrl: null, personName: 'John Doe' },
        ]}
      />,
    );
    expect(html).toContain('Участники OpenQareer');
    expect(html).toContain('href="https://www.linkedin.com/in/ulla-member/"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('Ulla Member');
    expect(html).toContain('Jane Roe');
    expect(html).toContain(
      'Привет! Я тоже пользуюсь OpenQareer и хотел спросить про Northwind Labs',
    );
    expect(html).toContain('Скопировать сообщение');
    expect(html).toContain('Olga Nolink');
    expect(html).toContain('Профиль LinkedIn не указан');
  });

  it('renders nothing without members', () => {
    expect(renderToStaticMarkup(<PlatformMembersList companyName="X" members={[]} />)).toBe('');
  });
});

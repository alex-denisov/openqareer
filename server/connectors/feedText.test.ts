import { describe, expect, it } from 'vitest';
import { decodeFeedEntities, htmlToFeedText, unwrapCdata } from './feedText';

describe('feed text (B164)', () => {
  it('returns text that carries no CDATA wrapper unchanged', () => {
    expect(unwrapCdata('Senior Engineer')).toBe('Senior Engineer');
    expect(unwrapCdata('<![CDATA[Senior Engineer]]>')).toBe('Senior Engineer');
  });

  it('keeps an escape it does not know as the text the feed wrote', () => {
    expect(decodeFeedEntities('Rock &amp; Roll &unknownentity; end')).toBe(
      'Rock & Roll &unknownentity; end',
    );
  });

  it('drops a numeric escape that names no character instead of throwing', () => {
    expect(decodeFeedEntities('a&#0;b')).toBe('ab');
    expect(decodeFeedEntities('a&#99999999;b')).toBe('ab');
    expect(decodeFeedEntities('a&#xFFFFFFF;b')).toBe('ab');
  });

  it('reads hexadecimal and decimal escapes alike', () => {
    expect(decodeFeedEntities('TypeScript &#x26; React &#8212; remote')).toBe(
      'TypeScript & React — remote',
    );
  });
});

describe('feed HTML turned into readable text (B164)', () => {
  it('reads the markup a feed escapes into its description as text', () => {
    expect(
      htmlToFeedText(
        '<p><strong>About&nbsp;Us</strong></p><p>We build things.<br>Remote&nbsp;first.</p>',
      ),
    ).toBe('About Us We build things. Remote first.');
  });

  it('leaves text that carries no markup alone', () => {
    expect(htmlToFeedText('Senior Engineer, remote')).toBe('Senior Engineer, remote');
  });
});

describe('markup escaped more than once (B164)', () => {
  it('reads a description a board escaped on the way out', () => {
    expect(
      htmlToFeedText('&lt;p&gt;&lt;strong&gt;THE ROLE&amp;nbsp;&lt;/strong&gt;Build.&lt;/p&gt;'),
    ).toBe('THE ROLE Build.');
  });

  it('stops after two passes rather than eating text that mentions a tag', () => {
    expect(htmlToFeedText('Write &amp;lt;p&amp;gt; to show a paragraph tag')).toBe(
      'Write <p> to show a paragraph tag',
    );
  });
});

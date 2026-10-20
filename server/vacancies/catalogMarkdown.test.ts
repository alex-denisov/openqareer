import { describe, expect, it } from 'vitest';
import { renderDescriptionHtml, plainSummary } from './catalogMarkdown';

describe('renderDescriptionHtml', () => {
  it('renders headings, emphasis, lists and paragraphs', () => {
    const html = renderDescriptionHtml(
      '### You Will\n\n- Lead **strategy**\n- Ship *fast*\n\nPlain `code` text.',
    );
    expect(html).toBe(
      '<h2>You Will</h2><ul><li>Lead <strong>strategy</strong></li><li>Ship <em>fast</em></li></ul>' +
        '<p>Plain <code>code</code> text.</p>',
    );
  });

  it('escapes foreign markup before formatting', () => {
    const html = renderDescriptionHtml('<script>alert(1)</script> **x"y**');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>x&quot;y</strong>');
  });

  it('drops the generated preamble that repeats title, meta and skills', () => {
    const html = renderDescriptionHtml(
      '# Title\n**Co** · City\n🕒 **Статус:** x\n\n---\n\n### Top Skills & Match\n🎯 a\n\n---\n\n### About the Role\nBody text',
    );
    expect(html).toBe('<p>Body text</p>');
  });

  it('drops a preamble with no sections at all', () => {
    expect(renderDescriptionHtml('# Title\n**Co** · City\nСтатус: x')).toBe('');
  });

  it('removes emoji and horizontal rules, joins soft-wrapped lines', () => {
    const html = renderDescriptionHtml('🎯 Line one\nline two\n\n---\n\nNext');
    expect(html).toBe('<p>Line one line two</p><p>Next</p>');
  });

  it('turns safe links into nofollow anchors and drops unsafe schemes', () => {
    expect(renderDescriptionHtml('[site](https://a.example/x)')).toBe(
      '<p><a href="https://a.example/x" rel="nofollow noopener">site</a></p>',
    );
    expect(renderDescriptionHtml('[x](javascript:void)')).toBe('<p>x</p>');
  });

  it('renders ordered lists', () => {
    expect(renderDescriptionHtml('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
  });
});

describe('plainSummary', () => {
  it('strips markdown, preamble and emoji and cuts on a word', () => {
    const text = plainSummary(
      '# T\n\n---\n\n### About the Role\n**Bold** start with `code` and [link](https://x.y) words here',
      30,
    );
    expect(text).toBe('Bold start with code and link…');
  });
});

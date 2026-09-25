/**
 * The consultant's replies are written by a model and come with markdown
 * (**bold**, lists, «###» headings). This renders that small subset as React
 * elements — never as HTML — so the text cannot inject markup, and links stay
 * plain text (B266).
 */
import type { ReactNode } from 'react';

type Block =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'ul' | 'ol'; readonly items: readonly string[] };

const HEADING = /^#{1,6}\s+(.+)$/u;
const BULLET = /^\s*[-*•]\s+(.+)$/u;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/u;
// `code`, **bold** / __bold__, *italic* / _italic_ (the underscore form only
// at word boundaries, so snake_case words are left alone).
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(\S(?:.*?\S)?)\*|(?<![\p{L}\p{N}])_(\S(?:.*?\S)?)_(?![\p{L}\p{N}])/gu;

function blockOf(line: string): Block {
  const heading = HEADING.exec(line);
  if (heading) return { kind: 'heading', text: heading[1] };
  const bullet = BULLET.exec(line);
  if (bullet) return { kind: 'ul', items: [bullet[1]] };
  const numbered = NUMBERED.exec(line);
  if (numbered) return { kind: 'ol', items: [numbered[1]] };
  return { kind: 'paragraph', text: line.trim() };
}

/** Groups lines into blocks; consecutive list lines of one kind form one list. */
export function consultantBlocks(text: string): Block[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(blockOf)
    .reduce<Block[]>((blocks, block) => {
      const last = blocks.at(-1);
      if (last && (last.kind === 'ul' || last.kind === 'ol') && last.kind === block.kind) {
        const items = [...last.items, ...(block as { items: readonly string[] }).items];
        return [...blocks.slice(0, -1), { kind: last.kind, items }];
      }
      return [...blocks, block];
    }, []);
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const [, code, bold, boldAlt, italic, italicAlt] = match;
    if (code !== undefined) nodes.push(<code key={start}>{code}</code>);
    else if (bold !== undefined || boldAlt !== undefined)
      nodes.push(<strong key={start}>{bold ?? boldAlt}</strong>);
    else nodes.push(<em key={start}>{italic ?? italicAlt}</em>);
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function ConsultantMessage({ text }: { readonly text: string }) {
  return (
    <>
      {consultantBlocks(text).map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <p key={index} className="career-dialogue-heading">
              <strong>{inline(block.text)}</strong>
            </p>
          );
        }
        if (block.kind === 'paragraph') return <p key={index}>{inline(block.text)}</p>;
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>);
        return block.kind === 'ul' ? <ul key={index}>{items}</ul> : <ol key={index}>{items}</ol>;
      })}
    </>
  );
}

import type { ReactNode } from 'react';

/**
 * Minimal, dependency-free renderer for the two legal drafts (MDF-109). Only
 * supports the constructs those documents actually use: #/##/### headings,
 * a `---` divider, "- " list items, **bold**, *italic*, `code`, and
 * [OWNER DECISION: ...] placeholders. The last is rendered as a visibly
 * highlighted span rather than softened into prose -- the owner reviews
 * exactly those placeholders before this content can publish, so a
 * placeholder he cannot see is worse than no page (see the dispatch this
 * closes). Blank lines are block separators, not paragraph joins: both
 * source documents already put one sentence/thought per line, so each
 * non-blank line becomes its own block rather than being merged with its
 * neighbour.
 */

const INLINE = /\[OWNER DECISION:[^\]]*\]|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const [whole, bold, code, italic] = m;
    if (whole.startsWith('[OWNER DECISION')) {
      nodes.push(
        <mark
          key={key++}
          className="break-words rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-900 ring-1 ring-inset ring-amber-300"
        >
          {whole}
        </mark>,
      );
    } else if (bold !== undefined) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else if (code !== undefined) {
      nodes.push(
        <code key={key++} className="break-words rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-700">
          {code}
        </code>,
      );
    } else if (italic !== undefined) {
      nodes.push(<em key={key++}>{italic}</em>);
    }
    last = m.index + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function LegalDocument({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let blockKey = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={blockKey++} className="mt-3 list-disc space-y-1.5 break-words pl-5 text-sm leading-relaxed text-slate-600">
        {items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') continue;
    if (line.trim() === '---') {
      flushList();
      blocks.push(<hr key={blockKey++} className="my-6 border-slate-200" />);
      continue;
    }
    const h1 = /^#\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h3 = /^###\s+(.*)/.exec(line);
    const li = /^-\s+(.*)/.exec(line);
    if (h1) {
      flushList();
      blocks.push(
        <h1 key={blockKey++} className="bmpl-page-title mt-1 break-words">
          {renderInline(h1[1] ?? '')}
        </h1>,
      );
    } else if (h2) {
      flushList();
      blocks.push(
        <h2 key={blockKey++} className="mt-8 break-words text-xl font-semibold text-belize-navy">
          {renderInline(h2[1] ?? '')}
        </h2>,
      );
    } else if (h3) {
      flushList();
      blocks.push(
        <h3 key={blockKey++} className="mt-5 break-words text-base font-semibold text-belize-navy">
          {renderInline(h3[1] ?? '')}
        </h3>,
      );
    } else if (li) {
      listItems.push(li[1] ?? '');
    } else {
      flushList();
      blocks.push(
        <p key={blockKey++} className="mt-3 break-words text-sm leading-relaxed text-slate-600">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushList();

  return <div className="space-y-1">{blocks}</div>;
}

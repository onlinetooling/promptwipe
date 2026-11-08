import { diagnostic } from './diagnostic';
import { DISPLAY_LIMIT, cut, formatBytes } from './format';
import { LINKS } from './links';
import { type Lang, type Messages, lookup, messages } from './messages';
import type { Failure, Outcome } from './process';
import { type Item, LONG_VALUE, type Report, type ValueItem, buildReport } from './report';

// Builds the result panel. Every string, including values read from the file,
// goes into the page through text nodes (`append(string)`, `textContent`):
// nothing here parses HTML. tests/ui/safety.test.ts keeps it that way.

/** Lines of the "all blocks" list; the rest is summed up. */
export const LISTED_BLOCKS = 500;

export interface RenderContext {
  lang: Lang;
  /** Object URL of the cleaned file, or null when nothing is offered. */
  url: string | null;
  copy: (text: string) => Promise<void>;
  /** Extra line under the verdict ("one image at a time"…). */
  note?: string | null;
}

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

function copyButton(label: string, text: () => string, select: () => Node, ctx: RenderContext, m: Messages): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'copy' }, label);
  button.addEventListener('click', () => {
    ctx.copy(text()).then(
      () => {
        button.textContent = m.copied;
      },
      () => {
        button.textContent = m.copyFailed;
        const selection = document.getSelection();
        if (selection) selection.selectAllChildren(select());
      },
    );
  });
  return button;
}

function valueBlock(item: ValueItem, ctx: RenderContext, m: Messages): HTMLElement {
  const shown = cut(item.value);
  const pre = h('pre', { class: 'value' }, shown);
  const notes = h(
    'p',
    { class: 'value-notes' },
    m.chars(item.value.length),
    shown.length < item.value.length ? ` · ${m.shownFirst(DISPLAY_LIMIT)}` : null,
    item.fileTruncated ? ` · ${m.fileTruncated}` : null,
  );
  const copy = copyButton(m.copy, () => item.value, () => pre, ctx, m);
  const summary = h('summary', null, h('span', { class: 'value-label' }, item.label), item.hint ? h('span', { class: 'hint' }, ` — ${item.hint}`) : null);
  const details = h('details', { class: 'value-item' }, summary, pre, h('div', { class: 'value-actions' }, copy, notes));
  details.open = !item.folded;
  return details;
}

function itemNode(item: Item, ctx: RenderContext, m: Messages): HTMLElement {
  if (item.type === 'note') return h('li', { class: 'note' }, item.text);
  if (item.value.length > LONG_VALUE || item.value.includes('\n') || item.fileTruncated) {
    return h('li', { class: 'long' }, valueBlock(item, ctx, m));
  }
  return h(
    'li',
    { class: 'row' },
    h('span', { class: 'value-label' }, item.label, item.hint ? h('span', { class: 'hint' }, ` (${item.hint})`) : null),
    h('span', { class: 'value-inline' }, item.value),
  );
}

/** `full`: also what was removed and kept (only when a clean file was produced). */
function reportNodes(report: Report, outcome: Outcome, ctx: RenderContext, m: Messages, full: boolean): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const contained = h('section', { class: 'report-part' }, h('h3', null, m.contained));
  if (!report.sections.length) {
    contained.append(h('p', null, m.nothingReadable));
    if (outcome.file.source === 'paste') contained.append(h('p', { class: 'note' }, m.pastedNote));
  }
  for (const section of report.sections) {
    contained.append(h('h4', null, section.title), h('ul', { class: 'items' }, ...section.items.map((i) => itemNode(i, ctx, m))));
  }
  if (report.warnings.length) contained.append(h('ul', { class: 'warnings' }, ...report.warnings.map((w) => h('li', null, w))));
  nodes.push(contained);
  if (!full) return nodes;

  if (report.removed.length) {
    nodes.push(
      h(
        'section',
        { class: 'report-part' },
        h('h3', null, m.removedTitle),
        h(
          'ul',
          { class: 'groups' },
          ...report.removed.map((g) => h('li', null, `${g.label} · ${m.blockCount(g.count)} · ${formatBytes(g.bytes, ctx.lang)}`)),
        ),
      ),
    );
  }

  nodes.push(h('section', { class: 'report-part' }, h('h3', null, m.keptTitle), h('ul', { class: 'kept' }, ...report.kept.map((k) => h('li', null, k)))));

  const listed = report.blocks.slice(0, LISTED_BLOCKS).map((b) =>
    h(
      'li',
      { class: `block block-${b.action}` },
      `${b.name}${b.label ? ` (${b.label})` : ''} · ${lookup(m.kinds, b.kind) ?? b.kind} · ${formatBytes(b.size, ctx.lang)} · ${lookup(m.actions, b.action) ?? b.action}`,
    ),
  );
  const more = report.blocks.length > LISTED_BLOCKS ? h('li', null, m.moreBlocks(report.blocks.length - LISTED_BLOCKS)) : null;
  nodes.push(h('details', { class: 'all-blocks' }, h('summary', null, m.allBlocks), h('ol', null, ...listed, more)));
  return nodes;
}

function errorMessage(f: Failure, m: Messages): string {
  switch (f.code) {
    case 'too-large':
      return m.errTooLarge;
    case 'unsupported-format':
      if (f.format === 'gif') return m.errGif;
      if (f.format === 'avif') return m.errAvif;
      if (f.format === 'heic') return m.errHeic;
      return m.errUnknown;
    case 'malformed':
      return m.errMalformed;
    case 'unknown-critical-chunk':
    case 'unknown-marker':
      return m.errVariant;
    case 'verification-failed':
      return m.errVerification;
    case 'decode-mismatch':
      return m.errDecode;
    case 'read-failed':
      return m.errRead;
    case 'internal':
      return m.errInternal;
  }
}

/** Failures that point at a PromptWipe bug: the panel asks for a report. */
function isBug(f: Failure): boolean {
  return f.code === 'verification-failed' || f.code === 'decode-mismatch' || f.code === 'internal';
}

function diagnosticNode(outcome: Outcome, ctx: RenderContext, m: Messages, open: boolean): HTMLElement {
  const text = diagnostic(outcome);
  const pre = h('pre', { class: 'diagnostic-text' }, text);
  const details = h(
    'details',
    { class: 'diagnostic' },
    h('summary', null, m.diagTitle),
    h('p', null, m.diagNote),
    pre,
    h('p', { class: 'value-actions' }, copyButton(m.copyDiag, () => text, () => pre, ctx, m), ' ', h('a', { href: LINKS.bugReport, target: '_blank', rel: 'noopener noreferrer' }, m.reportBug)),
  );
  details.open = open;
  return details;
}

/** Replaces the content of `panel` with the result of one file; returns the verdict line. */
export function renderOutcome(panel: HTMLElement, outcome: Outcome, ctx: RenderContext): string {
  const m = messages[ctx.lang];
  const nodes: Node[] = [];

  if (outcome.kind === 'done') {
    const report = buildReport(outcome.inspection, outcome.result, ctx.lang);
    const head = h('div', { class: 'verdict verdict-ok' });
    head.append(h('p', { class: 'verdict-text' }, report.removedCount ? m.removedBlocks(report.removedCount) : m.nothingRemoved));
    if (ctx.note) head.append(h('p', { class: 'note' }, ctx.note));
    if (outcome.unchanged) {
      head.append(h('p', null, m.alreadyClean));
    } else if (ctx.url) {
      head.append(
        h('p', null, h('a', { class: 'button', href: ctx.url, download: outcome.downloadName }, m.download)),
        h('p', { class: 'small' }, m.fileName(outcome.downloadName), ' ', m.nameTip),
        h('p', { class: 'small' }, m.sizes(formatBytes(outcome.file.size, ctx.lang), formatBytes(outcome.result.bytes.length, ctx.lang))),
      );
      if (outcome.check === 'skipped-large') head.append(h('p', { class: 'small' }, m.checkSkippedLarge));
      if (outcome.check === 'skipped-undecodable') head.append(h('p', { class: 'small' }, m.checkSkippedUndecodable));
      if (outcome.check === 'decoded') head.append(h('img', { class: 'preview', src: ctx.url, alt: m.previewAlt, decoding: 'async' }));
    }
    nodes.push(head, ...reportNodes(report, outcome, ctx, m, true), diagnosticNode(outcome, ctx, m, false));
  } else {
    const f = outcome.failure;
    const head = h('div', { class: 'verdict verdict-error' }, h('p', { class: 'verdict-text' }, errorMessage(f, m)));
    if (ctx.note) head.append(h('p', { class: 'note' }, ctx.note));
    if (f.code === 'unsupported-format') {
      head.append(h('p', null, h('a', { href: LINKS.discussions, target: '_blank', rel: 'noopener noreferrer' }, m.requestFormat)));
    }
    nodes.push(head);
    if (outcome.inspection) nodes.push(...reportNodes(buildReport(outcome.inspection, null, ctx.lang), outcome, ctx, m, false));
    if (f.code !== 'too-large' && f.code !== 'unsupported-format') nodes.push(diagnosticNode(outcome, ctx, m, isBug(f)));
  }
  panel.replaceChildren(...nodes);
  return panel.querySelector('.verdict-text')?.textContent ?? '';
}

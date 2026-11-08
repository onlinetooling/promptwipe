import { type Lang, messages } from './messages';
import { type Decoder, type Outcome, type Source, browserDecode, crashed, processFile } from './process';
import { renderOutcome } from './render';

// Wires the tool markup (src/components/Tool.astro) to the engine: drop,
// choose or paste one image, show the report, offer the clean file. Nothing
// leaves the page: no request is made (CSP connect-src 'none' enforces it).

export interface ToolDeps {
  decode: Decoder;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  copy: (text: string) => Promise<void>;
}

export const browserDeps: ToolDeps = {
  decode: browserDecode,
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  copy: async (text) => {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
  },
};

export interface Tool {
  /** Processes one file; resolves once its result is shown (or dropped for a newer file). */
  handle(file: File, source: Source, note?: string | null): Promise<void>;
}

function part<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const el = root.querySelector<T>(`[data-${name}]`);
  if (!el) throw new Error(`tool markup is missing [data-${name}]`);
  return el;
}

function firstFile(list: FileList | null | undefined): { file: File | null; more: boolean } {
  const files = list ? Array.from(list) : [];
  return { file: files[0] ?? null, more: files.length > 1 };
}

export function mountTool(root: HTMLElement, deps: ToolDeps = browserDeps): Tool {
  const lang: Lang = root.dataset['lang'] === 'fr' ? 'fr' : 'en';
  const m = messages[lang];
  const input = part<HTMLInputElement>(root, 'input');
  const drop = part<HTMLElement>(root, 'drop');
  const status = part<HTMLElement>(root, 'status');
  const panel = part<HTMLElement>(root, 'result');

  // Job counter (design §3): a file dropped while another is being read wins;
  // the older result is thrown away when it arrives.
  let job = 0;
  let url: string | null = null;

  async function handle(file: File, source: Source, note: string | null = null): Promise<void> {
    const id = ++job;
    const isCurrent = (): boolean => id === job;
    if (url) {
      deps.revokeUrl(url);
      url = null;
    }
    panel.hidden = true;
    panel.replaceChildren();
    root.classList.add('busy');
    status.textContent = m.reading(file.name);
    let outcome: Outcome | null;
    try {
      outcome = await processFile(file, source, deps.decode, isCurrent);
    } catch (e) {
      outcome = crashed(file, source, e);
    }
    if (!outcome || !isCurrent()) return;
    let verdict: string;
    try {
      if (outcome.kind === 'done' && !outcome.unchanged) url = deps.createUrl(outcome.blob);
      verdict = renderOutcome(panel, outcome, { lang, url, copy: deps.copy, note });
    } catch (e) {
      // Never leave the page on "Reading…", nor a link to a file that was not shown.
      if (url) deps.revokeUrl(url);
      url = null;
      verdict = renderOutcome(panel, crashed(file, source, e), { lang, url: null, copy: deps.copy, note });
      outcome = null;
    }
    panel.hidden = false;
    root.classList.remove('busy');
    // The live region reads the verdict out, not just "Done".
    status.textContent = `${outcome?.kind === 'done' ? m.done : m.failed} ${verdict}`;
  }

  const take = (list: FileList | null | undefined, source: Source): void => {
    const { file, more } = firstFile(list);
    if (file) void handle(file, source, more ? m.oneAtATime : null);
  };

  input.addEventListener('change', () => {
    take(input.files, 'file');
    input.value = ''; // choosing the same file again fires "change" again
  });

  // Drop anywhere on the page: a file dropped next to the zone must not make
  // the browser leave the page to open it.
  let depth = 0;
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    drop.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) drop.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove('dragging');
    take(e.dataTransfer?.files, 'drop');
  });

  document.addEventListener('paste', (e) => {
    const { file, more } = firstFile(e.clipboardData?.files);
    if (!file) return;
    e.preventDefault();
    void handle(file, 'paste', more ? m.oneAtATime : null);
  });

  return { handle };
}

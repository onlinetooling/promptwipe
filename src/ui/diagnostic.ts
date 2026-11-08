import type { Block } from '../engine';
import type { Outcome } from './process';

// "Copy the diagnostic" (design §3): what a bug report needs, and nothing a
// user would not want to post. Structure only: format, sizes, block names,
// kinds and lengths, the error code. Never a value read from the file, nor
// the file name (it can be revealing too).

/** Bump with user-visible changes to the engine or the tool. */
export const TOOL_VERSION = '0.2.0';

/** Lines of the block list; a file can hold up to 100 000 blocks. */
export const DIAGNOSTIC_BLOCKS = 300;

function blockLine(b: Block): string {
  const label = b.label ? ` [${b.label}]` : '';
  return `  @${b.offset} ${b.name}${label} ${b.kind} ${b.action} ${b.size}`;
}

export function diagnostic(outcome: Outcome): string {
  const lines = [`PromptWipe diagnostic (structure only, no values from the file)`, `tool: ${TOOL_VERSION}`];
  const { file } = outcome;
  const structure = outcome.inspection?.structure ?? null;
  const format = structure?.format ?? (outcome.kind === 'error' ? outcome.detected : null) ?? 'not read';
  lines.push(`input: ${format}, ${file.size} bytes, source ${file.source}`);
  if (structure) {
    lines.push(
      `image: ${structure.width}x${structure.height}, animated ${structure.animated ? 'yes' : 'no'}, orientation ${structure.orientation}`,
    );
  }
  if (outcome.kind === 'done') {
    lines.push(`result: ${outcome.unchanged ? 'unchanged' : 'cleaned'}, ${outcome.result.bytes.length} bytes, check ${outcome.check}`);
  } else {
    lines.push(`error: ${outcome.failure.code}: ${outcome.failure.detail}`);
  }
  const warnings = outcome.inspection?.warnings ?? [];
  if (warnings.length) lines.push(`warnings: ${warnings.join(', ')}`);
  if (structure) {
    const { blocks } = structure;
    lines.push(`blocks (${blocks.length}):`);
    for (const b of blocks.slice(0, DIAGNOSTIC_BLOCKS)) lines.push(blockLine(b));
    if (blocks.length > DIAGNOSTIC_BLOCKS) lines.push(`  … ${blocks.length - DIAGNOSTIC_BLOCKS} more`);
  }
  return lines.join('\n');
}

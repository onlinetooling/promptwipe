/** Largest file accepted (design §3). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Most blocks (chunks, segments, sub-chunks) in one file. Real files have a few
 * thousand at most (8 KB IDAT chunks of a 50 MB PNG: ~6 400); a file made of
 * millions of empty blocks would otherwise exhaust the tab's memory.
 */
export const MAX_BLOCKS = 100_000;

/** Largest decompressed ICC profile accepted in a PNG iCCP (real profiles: a few KB to ~4 MB). */
export const MAX_ICC_BYTES = 8 * 1024 * 1024;

/** Most text entries read for the report (code review M2). */
export const MAX_TEXTS = 1000;

/** Budget charged per text block, so many empty blocks still use it up. */
export const TEXT_BLOCK_COST = 64;

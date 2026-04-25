/**
 * Ingest a math textbook PDF into the MongoDB Atlas vector store.
 *
 * Usage:
 *   npm run ingest -- ./algebra-and-trigonometry-2e.pdf [--source <id>] [--reset] [--batch <n>]
 *
 * The script:
 *   1. Extracts text per page from the PDF (pdf-parse).
 *   2. Detects chapter/section headings.
 *   3. Splits each section into ~1200-char chunks with 200-char overlap.
 *   4. Embeds chunks via Gemini text-embedding-004 in batches.
 *   5. Upserts into the `textbook_chunks` collection (idempotent by chunkId).
 *   6. Ensures the Atlas Vector Search index exists.
 *
 * .env requirements: GEMINI_API_KEY, MONGODB_URI, optional MONGODB_DB.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import type { AnyBulkWriteOperation, Collection } from 'mongodb';
import { PDFParse } from 'pdf-parse';
import { getDb } from '../src/lib/mongodb';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  TEXTBOOK_CHUNKS_COLLECTION,
  TEXTBOOK_VECTOR_INDEX,
  type TextbookChunk,
} from '../src/lib/rag';

dotenv.config();

type Args = {
  pdfPath: string;
  source: string;
  reset: boolean;
  batch: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let pdfPath: string | null = null;
  let source: string | null = null;
  let reset = false;
  let batch = 32;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reset') {
      reset = true;
    } else if (a === '--source') {
      source = argv[++i];
    } else if (a === '--batch') {
      batch = Math.max(1, parseInt(argv[++i] ?? '32', 10));
    } else if (!pdfPath) {
      pdfPath = a;
    }
  }

  if (!pdfPath) {
    console.error(
      'Usage: npm run ingest -- <path-to-pdf> [--source <id>] [--reset] [--batch <n>]',
    );
    process.exit(1);
  }
  if (!source) {
    source = path.basename(pdfPath, path.extname(pdfPath));
  }
  return { pdfPath, source, reset, batch };
}

type PageText = { page: number; text: string };

async function extractPagesFromPdf(pdfPath: string): Promise<PageText[]> {
  const buffer = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({
      lineEnforce: true,
      pageJoiner: '',
    });
    return result.pages.map((p) => ({ page: p.num, text: p.text }));
  } finally {
    await parser.destroy();
  }
}

type SectionText = {
  source: string;
  chapter: string;
  section: string;
  page: number;
  text: string;
};

const CHAPTER_RE = /^\s*Chapter\s+(\d+)\b[^\n]*/i;
const SECTION_RE = /^\s*(\d+\.\d+)(?:\s*\|\s*|\s+)([A-Z][^\n]{2,})/;

function detectHeadings(pages: PageText[], source: string): SectionText[] {
  let chapter = 'Front matter';
  let section = 'Front matter';
  let sectionPage = pages[0]?.page ?? 1;
  let buffer: string[] = [];
  const out: SectionText[] = [];

  function flush() {
    const text = buffer.join('\n').trim();
    if (text.length === 0) return;
    out.push({ source, chapter, section, page: sectionPage, text });
    buffer = [];
  }

  for (const { page, text } of pages) {
    const lines = text.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        buffer.push('');
        continue;
      }
      const chMatch = CHAPTER_RE.exec(line);
      if (chMatch) {
        flush();
        chapter = line;
        section = line;
        sectionPage = page;
        continue;
      }
      const secMatch = SECTION_RE.exec(line);
      if (secMatch) {
        flush();
        section = `${secMatch[1]} ${secMatch[2]}`.trim();
        sectionPage = page;
        continue;
      }
      buffer.push(line);
    }
    buffer.push('');
  }
  flush();
  return out;
}

const TARGET_CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 200;
const MIN_CHUNK_CHARS = 100;

function recursiveSplit(text: string, separators: string[]): string[] {
  if (text.length <= TARGET_CHUNK_CHARS) return [text];
  if (separators.length === 0) {
    // Hard window fallback.
    const out: string[] = [];
    for (let i = 0; i < text.length; i += TARGET_CHUNK_CHARS - CHUNK_OVERLAP) {
      out.push(text.slice(i, i + TARGET_CHUNK_CHARS));
    }
    return out;
  }
  const [sep, ...rest] = separators;
  const pieces = text.split(sep);
  const merged: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? current + sep + piece : piece;
    if (candidate.length <= TARGET_CHUNK_CHARS) {
      current = candidate;
    } else {
      if (current) merged.push(current);
      if (piece.length > TARGET_CHUNK_CHARS) {
        merged.push(...recursiveSplit(piece, rest));
        current = '';
      } else {
        current = piece;
      }
    }
  }
  if (current) merged.push(current);
  // Add overlap by carrying the tail of each chunk into the next.
  const withOverlap: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    if (i === 0) {
      withOverlap.push(merged[i]);
    } else {
      const prevTail = merged[i - 1].slice(-CHUNK_OVERLAP);
      withOverlap.push(prevTail + merged[i]);
    }
  }
  return withOverlap;
}

type ChunkInput = {
  chunkId: string;
  source: string;
  chapter: string;
  section: string;
  page: number;
  ordinal: number;
  text: string;
};

function chunkSection(input: SectionText): ChunkInput[] {
  const pieces = recursiveSplit(input.text, ['\n\n', '\n', '. ']);
  const out: ChunkInput[] = [];
  let ordinal = 0;
  for (const piece of pieces) {
    const text = piece.trim();
    if (text.length < MIN_CHUNK_CHARS) continue;
    const chunkId = crypto
      .createHash('sha1')
      .update(`${input.source}:${input.section}:${ordinal}`)
      .digest('hex');
    out.push({
      chunkId,
      source: input.source,
      chapter: input.chapter,
      section: input.section,
      page: input.page,
      ordinal,
      text,
    });
    ordinal += 1;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== 'string') return null;
  const m = /retry in ([\d.]+)s/i.exec(msg);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  const r = /"retryDelay":\s*"(\d+)s"/.exec(msg);
  if (r) return parseInt(r[1], 10) * 1000;
  return null;
}

type AiPool = {
  clients: GoogleGenAI[];
  cursor: number;
};

function buildPool(): AiPool {
  const multi = process.env.GEMINI_API_KEYS;
  const keys: string[] = [];
  if (multi) {
    for (const k of multi.split(',')) {
      const t = k.trim();
      if (t) keys.push(t);
    }
  }
  if (keys.length === 0) {
    const single = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (single) keys.push(single);
  }
  if (keys.length === 0) {
    throw new Error(
      'No API keys found. Set GEMINI_API_KEYS (comma-separated) or GEMINI_API_KEY in .env.',
    );
  }
  return {
    clients: keys.map((apiKey) => new GoogleGenAI({ apiKey })),
    cursor: 0,
  };
}

async function embedBatch(pool: AiPool, texts: string[]): Promise<number[][]> {
  const n = pool.clients.length;
  const maxCycles = 4;
  let lastErr: unknown;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    let longestRetryHint = 0;
    for (let i = 0; i < n; i++) {
      const idx = pool.cursor % n;
      const ai = pool.clients[idx];
      pool.cursor = (pool.cursor + 1) % n;
      try {
        const resp = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: texts.map((text) => ({ parts: [{ text }] })),
          config: { outputDimensionality: EMBEDDING_DIMENSIONS },
        });
        const embeddings = resp.embeddings ?? [];
        if (embeddings.length !== texts.length) {
          throw new Error(
            `Embedding count mismatch: requested ${texts.length}, got ${embeddings.length}.`,
          );
        }
        return embeddings.map((e, j) => {
          const values = e.values;
          if (!values || values.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(
              `Embedding ${j} has wrong dimensions: ${values?.length ?? 'undefined'}`,
            );
          }
          return values;
        });
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number }).status;
        if (status !== 429) throw err;
        const hinted = parseRetryDelayMs(err) ?? 0;
        if (hinted > longestRetryHint) longestRetryHint = hinted;
        console.log(
          `Key #${idx + 1} rate-limited; switching to next key…`,
        );
      }
    }
    // All keys 429 in this cycle. Back off using the longest hint we saw.
    const backoff = Math.max(longestRetryHint, Math.min(60000, 5000 * 2 ** cycle));
    const wait = backoff + 2000;
    console.log(
      `All ${n} keys rate-limited; sleeping ${Math.round(wait / 1000)}s ` +
        `before retry cycle ${cycle + 2}/${maxCycles}…`,
    );
    await sleep(wait);
  }
  throw lastErr;
}

async function ensureVectorIndex(
  col: Collection<TextbookChunk>,
): Promise<void> {
  const existing = await col
    .listSearchIndexes()
    .toArray()
    .catch(() => []);
  if (existing.some((idx) => idx.name === TEXTBOOK_VECTOR_INDEX)) {
    console.log(
      `Vector index "${TEXTBOOK_VECTOR_INDEX}" already exists; not recreating.`,
    );
    return;
  }
  console.log(`Creating vector index "${TEXTBOOK_VECTOR_INDEX}"…`);
  await col.createSearchIndex({
    name: TEXTBOOK_VECTOR_INDEX,
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: EMBEDDING_DIMENSIONS,
          similarity: 'cosine',
        },
        { type: 'filter', path: 'source' },
      ],
    },
  });
  console.log(
    `Vector index requested. Atlas builds it asynchronously — check the ` +
      `Atlas UI or run db.${TEXTBOOK_CHUNKS_COLLECTION}.getSearchIndexes() to ` +
      `confirm "queryable: true".`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  let pool: AiPool;
  try {
    pool = buildPool();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  console.log(
    `Loaded ${pool.clients.length} API key${pool.clients.length === 1 ? '' : 's'} for rotation.`,
  );

  console.log(`Reading PDF: ${args.pdfPath}`);
  const pages = await extractPagesFromPdf(args.pdfPath);
  console.log(`Extracted ${pages.length} pages.`);

  const sections = detectHeadings(pages, args.source);
  console.log(`Detected ${sections.length} sections.`);

  const chunks = sections.flatMap(chunkSection);
  console.log(`Produced ${chunks.length} chunks.`);

  const db = await getDb();
  const col = db.collection<TextbookChunk>(TEXTBOOK_CHUNKS_COLLECTION);

  if (args.reset) {
    console.log(`--reset: dropping collection "${TEXTBOOK_CHUNKS_COLLECTION}"…`);
    await col.drop().catch(() => undefined);
  }

  await col.createIndex({ chunkId: 1 }, { unique: true });
  await col.createIndex({ source: 1 });

  const existing = await col
    .find({ source: args.source }, { projection: { chunkId: 1 } })
    .toArray();
  const existingIds = new Set(existing.map((d) => d.chunkId));

  const toEmbed = chunks.filter((c) => !existingIds.has(c.chunkId));
  console.log(
    `Need to embed ${toEmbed.length} new chunks (${existingIds.size} already present).`,
  );

  let processed = 0;

  for (let i = 0; i < toEmbed.length; i += args.batch) {
    const batch = toEmbed.slice(i, i + args.batch);
    const embeddings = await embedBatch(pool, batch.map((c) => c.text));
    const ops: AnyBulkWriteOperation<TextbookChunk>[] = batch.map((c, j) => ({
      updateOne: {
        filter: { chunkId: c.chunkId },
        update: {
          $set: {
            chunkId: c.chunkId,
            source: c.source,
            chapter: c.chapter,
            section: c.section,
            page: c.page,
            ordinal: c.ordinal,
            text: c.text,
            embedding: embeddings[j],
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }));
    await col.bulkWrite(ops, { ordered: false });
    processed += batch.length;
    console.log(`Embedded ${processed}/${toEmbed.length}`);
  }

  console.log('Ensuring vector index…');
  await ensureVectorIndex(col);

  console.log(
    `Done. Total chunks for source "${args.source}": ${await col.countDocuments(
      { source: args.source },
    )}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

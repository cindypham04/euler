import type { Collection, ObjectId } from "mongodb";
import { GoogleGenAI } from "@google/genai";
import { getDb } from "./mongodb";

export const TEXTBOOK_CHUNKS_COLLECTION = "textbook_chunks";
export const TEXTBOOK_VECTOR_INDEX = "textbook_chunks_vector";
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export const TEXTBOOK_SOURCE =
  process.env.UNBLIND_TEXTBOOK_SOURCE ?? "openstax-algebra-trig-2e";

export type TextbookChunk = {
  _id: ObjectId;
  chunkId: string;
  source: string;
  chapter: string;
  section: string;
  page: number;
  ordinal: number;
  text: string;
  embedding: number[];
  createdAt: Date;
};

export type RagHit = {
  text: string;
  chapter: string;
  section: string;
  page: number;
  score: number;
};

let aiSingleton: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (aiSingleton) return aiSingleton;
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env and restart the server.",
    );
  }
  aiSingleton = new GoogleGenAI({ apiKey });
  return aiSingleton;
}

export async function chunksCollection(): Promise<Collection<TextbookChunk>> {
  const db = await getDb();
  return db.collection<TextbookChunk>(TEXTBOOK_CHUNKS_COLLECTION);
}

export async function embedText(text: string): Promise<number[]> {
  const resp = await ai().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ parts: [{ text }] }],
    config: { outputDimensionality: EMBEDDING_DIMENSIONS },
  });
  const values = resp.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error("Embedding API returned no values.");
  }
  return values;
}

export async function searchTextbook(
  query: string,
  k: number = 4,
): Promise<RagHit[]> {
  const limit = Math.min(8, Math.max(1, Math.floor(k)));
  const queryVector = await embedText(query);
  const col = await chunksCollection();

  const cursor = col.aggregate<RagHit>([
    {
      $vectorSearch: {
        index: TEXTBOOK_VECTOR_INDEX,
        path: "embedding",
        queryVector,
        numCandidates: Math.max(50, limit * 40),
        limit,
        filter: { source: TEXTBOOK_SOURCE },
      },
    },
    {
      $project: {
        _id: 0,
        text: 1,
        chapter: 1,
        section: 1,
        page: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ]);

  return cursor.toArray();
}

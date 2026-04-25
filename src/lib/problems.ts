import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

const COLLECTION = "problems";

export type Role = "user" | "assistant" | "system";

export type FileMessage = {
  role: Role;
  type: "file";
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: Date;
};

export type TextMessage = {
  role: Role;
  type: "text";
  content: string;
  model?: string;
  kind?: string;
  createdAt: Date;
};

export type Message = FileMessage | TextMessage;

export type Problem = {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  messages: Message[];
};

export type ProblemSummary = Pick<Problem, "_id" | "title" | "createdAt">;

async function collection() {
  const db = await getDb();
  return db.collection<Problem>(COLLECTION);
}

export async function uploadDir(): Promise<string> {
  const dir = path.join(process.cwd(), "data", "uploads");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function createProblem(
  id: ObjectId,
  title: string,
  messages: Message[],
): Promise<ObjectId> {
  const now = new Date();
  const col = await collection();
  await col.insertOne({
    _id: id,
    createdAt: now,
    updatedAt: now,
    title,
    messages,
  });
  return id;
}

export async function getProblem(id: string): Promise<Problem | null> {
  if (!ObjectId.isValid(id)) return null;
  const col = await collection();
  return col.findOne({ _id: new ObjectId(id) });
}

export async function listProblems(): Promise<ProblemSummary[]> {
  const col = await collection();
  const docs = await col
    .find({}, { projection: { title: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map((d) => ({
    _id: d._id,
    title: d.title,
    createdAt: d.createdAt,
  }));
}

export async function deleteProblem(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const col = await collection();
  const doc = await col.findOne(
    { _id: new ObjectId(id) },
    { projection: { messages: 1 } },
  );
  if (!doc) return false;

  for (const msg of doc.messages) {
    if (msg.type === "file") {
      const abs = path.join(process.cwd(), msg.path);
      await rm(abs, { force: true });
    }
  }

  const result = await col.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount === 1;
}

export async function getFirstFileMessage(
  id: string,
): Promise<FileMessage | null> {
  if (!ObjectId.isValid(id)) return null;
  const col = await collection();
  const doc = await col.findOne(
    { _id: new ObjectId(id), "messages.type": "file" },
    { projection: { "messages.$": 1 } },
  );
  const msg = doc?.messages?.[0];
  return msg && msg.type === "file" ? msg : null;
}

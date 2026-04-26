import { ObjectId, Binary } from "mongodb";
import { getDb } from "@/lib/mongodb";

const COLLECTION = "problems";
const FILES_COLLECTION = "problem_files";

export type Role = "user" | "assistant" | "system";

export type FileMessage = {
  role: Role;
  type: "file";
  filename: string;
  mimeType: string;
  size: number;
  fileId: ObjectId;
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

export type ProblemFile = {
  _id: ObjectId;
  problemId: ObjectId;
  filename: string;
  mimeType: string;
  size: number;
  data: Binary;
  createdAt: Date;
};

async function collection() {
  const db = await getDb();
  return db.collection<Problem>(COLLECTION);
}

async function filesCollection() {
  const db = await getDb();
  const col = db.collection<ProblemFile>(FILES_COLLECTION);
  // Idempotent index for cleanup-by-problem.
  await col.createIndex({ problemId: 1 });
  return col;
}

export async function saveProblemFile(input: {
  problemId: ObjectId;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<ObjectId> {
  const col = await filesCollection();
  const id = new ObjectId();
  await col.insertOne({
    _id: id,
    problemId: input.problemId,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.bytes.byteLength,
    data: new Binary(input.bytes),
    createdAt: new Date(),
  });
  return id;
}

export async function getProblemFile(
  fileId: string,
): Promise<ProblemFile | null> {
  if (!ObjectId.isValid(fileId)) return null;
  const col = await filesCollection();
  return col.findOne({ _id: new ObjectId(fileId) });
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

export async function appendMessages(
  id: string,
  messages: Message[],
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  if (messages.length === 0) return true;
  const col = await collection();
  const result = await col.updateOne(
    { _id: new ObjectId(id) },
    {
      $push: { messages: { $each: messages } },
      $set: { updatedAt: new Date() },
    },
  );
  return result.matchedCount === 1;
}

export async function deleteProblem(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const objectId = new ObjectId(id);
  const col = await collection();
  const doc = await col.findOne({ _id: objectId }, { projection: { _id: 1 } });
  if (!doc) return false;

  const files = await filesCollection();
  await files.deleteMany({ problemId: objectId });

  const result = await col.deleteOne({ _id: objectId });
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

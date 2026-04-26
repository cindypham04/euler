"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { GoogleGenAI } from "@google/genai";
import {
  createProblem,
  deleteProblem as deleteProblemFromDb,
  saveProblemFile,
  type Message,
} from "@/lib/problems";

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const OCR_SYSTEM_PROMPT =
  "You transcribe math problem statements from images. " +
  "Output the problem statement exactly as shown, preserving the original " +
  "wording and order. Use $...$ for inline math and $$...$$ for display " +
  "equations, in standard LaTeX. Do not solve the problem. Do not add " +
  "preamble, commentary, or any text that is not part of the problem " +
  "statement itself.";

const OCR_USER_PROMPT =
  "Transcribe the math problem statement from this image.";

const RESPOND_SYSTEM_PROMPT =
  "You are a helpful assistant. Respond to the math problem(s) below.";

const DEFAULT_MODEL = "gemini-2.5-flash";

export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function submitProblem(
  formData: FormData,
): Promise<SubmitResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "GEMINI_API_KEY is not set on the server. Add it to .env and restart the dev server.",
    };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No image was provided." };
  }
  const ext = SUPPORTED_MIME_TYPES[file.type];
  if (!ext) {
    const supported = Object.keys(SUPPORTED_MIME_TYPES).join(", ");
    return {
      ok: false,
      error: `Unsupported image type: ${file.type || "unknown"}. Supported: ${supported}.`,
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");
  const model = process.env.UNBLIND_MODEL ?? DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  let statement: string;
  try {
    const ocr = await ai.models.generateContent({
      model,
      contents: [
        { inlineData: { mimeType: file.type, data: base64 } },
        { text: OCR_USER_PROMPT },
      ],
      config: {
        systemInstruction: OCR_SYSTEM_PROMPT,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    statement = (ocr.text ?? "").trim();
  } catch (err) {
    return {
      ok: false,
      error: `OCR call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!statement) {
    return { ok: false, error: "OCR step returned no text." };
  }

  let response: string;
  try {
    const reply = await ai.models.generateContent({
      model,
      contents: [{ text: statement }],
      config: {
        systemInstruction: RESPOND_SYSTEM_PROMPT,
        maxOutputTokens: 4096,
      },
    });
    response = (reply.text ?? "").trim();
  } catch (err) {
    return {
      ok: false,
      error: `Responder call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response) {
    return { ok: false, error: "Responder step returned no text." };
  }

  const id = new ObjectId();

  let fileId: ObjectId;
  try {
    fileId = await saveProblemFile({
      problemId: id,
      filename: file.name,
      mimeType: file.type,
      bytes,
    });
  } catch (err) {
    return {
      ok: false,
      error: `Failed to save upload to MongoDB: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const now = new Date();
  const messages: Message[] = [
    {
      role: "user",
      type: "file",
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      fileId,
      createdAt: now,
    },
    {
      role: "assistant",
      type: "text",
      content: statement,
      model,
      kind: "extraction",
      createdAt: now,
    },
    {
      role: "assistant",
      type: "text",
      content: response,
      model,
      kind: "response",
      createdAt: now,
    },
  ];

  try {
    await createProblem(id, file.name, messages);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to save problem: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  revalidatePath("/", "layout");
  return { ok: true, id: id.toHexString() };
}

export async function deleteProblemAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const deleted = await deleteProblemFromDb(id);
    if (!deleted) {
      return { ok: false, error: "Problem not found." };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to delete problem: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

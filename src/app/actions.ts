"use server";

import { GoogleGenAI } from "@google/genai";

const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

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

export type ExtractResult =
  | { ok: true; problem: string; response: string }
  | { ok: false; error: string };

export async function extractAndRespond(
  formData: FormData,
): Promise<ExtractResult> {
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
  if (!SUPPORTED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: `Unsupported image type: ${file.type || "unknown"}. Supported: png, jpeg, webp, gif.`,
    };
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const model = process.env.UNBLIND_MODEL ?? DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  let problem: string;
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
    problem = (ocr.text ?? "").trim();
  } catch (err) {
    return {
      ok: false,
      error: `OCR call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!problem) {
    return { ok: false, error: "OCR step returned no text." };
  }

  let response: string;
  try {
    const reply = await ai.models.generateContent({
      model,
      contents: [{ text: problem }],
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

  return { ok: true, problem, response };
}

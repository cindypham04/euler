import { ElevenLabsClient } from "elevenlabs";
import { GoogleGenAI } from "@google/genai";

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const TTS_MODEL = "eleven_turbo_v2";
const GEMINI_MODEL = "gemini-2.5-flash";

const SPOKEN_SYSTEM_PROMPT =
  "You convert written math text into natural spoken English for a text-to-speech engine. " +
  "Rules: " +
  "Replace ALL LaTeX (inline $...$ and display $$...$$) with how a teacher would say it aloud. " +
  "For example: $x^2$ → 'x squared', $\\frac{a}{b}$ → 'a over b', $\\sqrt{x}$ → 'square root of x', " +
  "$\\lim_{x \\to 2}$ → 'the limit as x approaches 2', $\\int_a^b$ → 'the integral from a to b'. " +
  "Remove all markdown formatting (**, #, *, backticks). " +
  "Output only the spoken text — no preamble, no explanation, no quotes around it.";

let geminiSingleton: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (geminiSingleton) return geminiSingleton;
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set.");
  geminiSingleton = new GoogleGenAI({ apiKey });
  return geminiSingleton;
}

async function toSpoken(text: string): Promise<string> {
  try {
    const resp = await gemini().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ text }],
      config: {
        systemInstruction: SPOKEN_SYSTEM_PROMPT,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return (resp.text ?? "").trim() || text;
  } catch {
    return text;
  }
}

export async function POST(request: Request) {
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) {
    return Response.json({ error: "ELEVENLABS_API_KEY not set." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const text =
    body && typeof body === "object" && "text" in body
      ? (body as { text: unknown }).text
      : undefined;
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Field `text` is required." }, { status: 400 });
  }

  const spoken = await toSpoken(text);

  const client = new ElevenLabsClient({ apiKey: elevenKey });
  const audioStream = await client.textToSpeech.convert(VOICE_ID, {
    text: spoken,
    model_id: TTS_MODEL,
    output_format: "mp3_44100_128",
  });

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": "audio/mpeg" },
  });
}

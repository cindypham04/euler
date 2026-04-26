import { GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import {
  appendMessages,
  getProblem,
  type Message,
  type TextMessage,
} from "@/lib/problems";
import { searchTextbook, type RagHit } from "@/lib/rag";

export const AGENT_MODEL = "gemini-2.5-flash";
const MAX_TOOL_ROUNDS = 4;

const AGENT_SYSTEM_PROMPT =
  "You are a math tutor helping a student understand a problem they uploaded. " +
  "The original problem statement and your earlier response are above in the " +
  "conversation. You have one tool, `searchTextbook`, that looks up passages " +
  "from a math textbook. Call it ONLY when the student asks about a math " +
  "concept the textbook would explain — definitions, theorems, formulas, or " +
  "worked examples. Do NOT call it for simple arithmetic, for restating the " +
  'problem, or for chit-chat. When you do use textbook results, cite them as ' +
  '"(see Section 5.3, p.412)" using `section` and `page` from the tool result. ' +
  "Keep math in LaTeX: $...$ inline, $$...$$ display.";

const TOOL_DECLARATION = {
  functionDeclarations: [
    {
      name: "searchTextbook",
      description:
        "Look up definitions, theorems, formulas, or worked examples from " +
        "the math textbook. Use only when the user asks about a math concept " +
        "a textbook would explain (e.g. 'what is the chain rule', 'state the " +
        "law of cosines'). Do NOT call for simple arithmetic, restating the " +
        "problem, or chit-chat.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The concept or phrase to look up.",
          },
          k: {
            type: "integer",
            description: "Number of passages to return.",
            minimum: 1,
            maximum: 8,
          },
        },
        required: ["query"],
      },
    },
  ],
};

export class ProblemNotFoundError extends Error {
  constructor(id: string) {
    super(`Problem ${id} not found.`);
    this.name = "ProblemNotFoundError";
  }
}

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

function buildContents(messages: Message[]): Content[] {
  const out: Content[] = [];
  for (const msg of messages) {
    if (msg.type === "file") {
      out.push({
        role: "user",
        parts: [
          {
            text:
              "[User uploaded an image. The transcribed problem statement " +
              "follows in the next message.]",
          },
        ],
      });
      continue;
    }
    if (msg.kind === "tool_call" || msg.kind === "tool_result") continue;
    out.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }
  return out;
}

type ToolTrace = {
  call: { name: string; args: Record<string, unknown> };
  hits: RagHit[];
};

export async function runAgent(
  problemId: string,
  userMessage: string,
): Promise<TextMessage[]> {
  const trimmed = userMessage.trim();
  if (!trimmed) throw new Error("Message must not be empty.");

  const problem = await getProblem(problemId);
  if (!problem) throw new ProblemNotFoundError(problemId);

  const contents = buildContents(problem.messages);
  contents.push({ role: "user", parts: [{ text: trimmed }] });

  const toolTrace: ToolTrace[] = [];
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await ai().models.generateContent({
      model: AGENT_MODEL,
      contents,
      config: {
        systemInstruction: AGENT_SYSTEM_PROMPT,
        tools: [TOOL_DECLARATION],
        maxOutputTokens: 4096,
      },
    });

    const calls: FunctionCall[] = resp.functionCalls ?? [];
    const candidateContent = resp.candidates?.[0]?.content;

    if (calls.length === 0) {
      finalText = (resp.text ?? "").trim();
      break;
    }

    if (candidateContent) contents.push(candidateContent);

    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      let response: Record<string, unknown>;

      if (name === "searchTextbook") {
        const query = typeof args.query === "string" ? args.query : "";
        const kRaw = typeof args.k === "number" ? args.k : 4;
        const hits = query
          ? await searchTextbook(query, kRaw)
          : ([] as RagHit[]);
        toolTrace.push({ call: { name, args }, hits });
        response = { hits };
      } else {
        toolTrace.push({ call: { name, args }, hits: [] });
        response = { error: `Unknown tool: ${name}` };
      }

      contents.push({
        role: "user",
        parts: [{ functionResponse: { name, response } }],
      });
    }
  }

  if (!finalText) {
    const recovery = await ai().models.generateContent({
      model: AGENT_MODEL,
      contents,
      config: {
        systemInstruction: AGENT_SYSTEM_PROMPT,
        maxOutputTokens: 4096,
      },
    });
    finalText = (recovery.text ?? "").trim();
  }

  if (!finalText) {
    finalText = "(The model returned no text. Please try again.)";
  }

  const now = new Date();
  const newMessages: TextMessage[] = [];

  newMessages.push({
    role: "user",
    type: "text",
    content: trimmed,
    kind: "chat",
    createdAt: now,
  });

  for (const trace of toolTrace) {
    newMessages.push({
      role: "assistant",
      type: "text",
      kind: "tool_call",
      content: JSON.stringify(trace.call),
      model: AGENT_MODEL,
      createdAt: now,
    });
    newMessages.push({
      role: "system",
      type: "text",
      kind: "tool_result",
      content: JSON.stringify(
        trace.hits.map((h) => ({
          section: h.section,
          chapter: h.chapter,
          page: h.page,
          score: h.score,
          snippet: h.text.slice(0, 240),
        })),
      ),
      createdAt: now,
    });
  }

  newMessages.push({
    role: "assistant",
    type: "text",
    content: finalText,
    model: AGENT_MODEL,
    kind: "chat",
    createdAt: now,
  });

  await appendMessages(problemId, newMessages);
  return newMessages;
}

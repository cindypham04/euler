# euler

Upload an image of a math problem, get a tutor that explains the answer and can keep talking — with retrieval-augmented grounding from a real math textbook.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, MongoDB Atlas (vector search), and the [Google GenAI SDK](https://www.npmjs.com/package/@google/genai). Gemini 2.5 Flash drives the OCR pass, the responder pass, and the chat agent loop. The agent has one tool — `searchTextbook` — that runs Atlas `$vectorSearch` over an OpenStax textbook and decides on its own when to use it.

## Features

- **Image → transcribed problem + first response** in one server action (Gemini 2.5 Flash, OCR pass with thinking disabled, then a separate responder pass)
- **Phone-camera capture** — `npm run dev:phone` opens an HTTPS tunnel; visit `/capture` on the laptop to see a QR, scan it with your phone, point at a problem, tap once, and the result page opens automatically
- **Per-problem chat** — keep asking follow-ups on each problem page; the agent has full conversation memory within that problem
- **Strict cross-problem isolation** — the agent only ever reads/writes the current problem document; messages from other problems are structurally unreachable
- **Agentic RAG** — the agent decides per-turn whether to call `searchTextbook` (Atlas Vector Search over a CC-BY-licensed OpenStax textbook). Concept questions trigger retrieval; arithmetic and chit-chat skip it.
- **Retrieval traces** — every tool call and result is persisted as a debug message and rendered in a collapsible "Show retrieval trace" `<details>` so you can see exactly what the model looked up
- **Persistent history sidebar** — every problem you've worked on, listed for one-click resume
- **Multi-key ingestion** — optional comma-separated key pool rotates around per-key Gemini rate limits when embedding the textbook

## Prerequisites

- **Node.js 20+** and **npm**
- A free **Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey)
- A free **MongoDB Atlas** cluster (M0 — 512 MB at no cost; vector search is included on the free tier)

## Setup

```bash
git clone https://github.com/Khangdang1690/unblind.git
cd unblind
npm install
```

### MongoDB Atlas

1. Sign in at <https://www.mongodb.com/cloud/atlas> and create a free **M0** cluster.
2. Under **Database Access**, create a user with a password.
3. Under **Network Access**, allow your current IP (or `0.0.0.0/0` for development).
4. Click **Connect → Drivers** on the cluster and copy the `mongodb+srv://...` connection string.

### `.env`

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your-key-here
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority
MONGODB_DB=euler
```

Optional:

```
# Override the LLM model (defaults to gemini-2.5-flash)
UNBLIND_MODEL=gemini-2.5-flash

# Override the textbook source id used for RAG queries (defaults to
# openstax-algebra-trig-2e). Useful only if you ingest a different textbook.
UNBLIND_TEXTBOOK_SOURCE=openstax-algebra-trig-2e

# Comma-separated pool of Gemini API keys used by the ingest script ONLY,
# to rotate around per-key rate limits. Falls back to GEMINI_API_KEY.
GEMINI_API_KEYS=key1,key2,key3
```

## Ingest the textbook

The agent's `searchTextbook` tool queries an OpenStax math textbook stored in MongoDB. **Algebra and Trigonometry 2e** is the recommended default — broadest school-math coverage and CC-BY 4.0 licensed.

1. Download the PDF from <https://openstax.org/details/books/algebra-and-trigonometry-2e>. Save it to the project root (the file is ignored by git, so the filename can be anything; the default OpenStax filename is `algebra-and-trigonometry-2e_-_WEB.pdf`).
2. Run:
   ```bash
   npm run ingest -- ./algebra-and-trigonometry-2e_-_WEB.pdf
   ```

What the script does:
- Extracts text per page (`pdf-parse` v2)
- Detects chapters / sections
- Splits into ~1,200-character chunks with 200-char overlap (~2,000–2,500 chunks for Algebra & Trig 2e)
- Embeds via Gemini `gemini-embedding-001` at 768 dimensions (Matryoshka truncation via `outputDimensionality`)
- Upserts into the `textbook_chunks` collection (idempotent — re-runs skip already-embedded chunks)
- Ensures the Atlas Vector Search index `textbook_chunks_vector` exists

Free-tier rate limits cap embeddings at ~100 inputs/minute per API key. Set `GEMINI_API_KEYS` to a comma-separated list of multiple free keys to rotate through them; the script will instantly swap on a 429 and only sleep when every key in the pool is exhausted.

After ingestion, confirm in the Atlas UI → Search Indexes that `textbook_chunks_vector` shows status **Active** (build takes 1–3 minutes).

## Run

```bash
npm run dev
```

Open <http://localhost:3000>, upload an image (`.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` up to 10 MB). After the first OCR + response, you can keep chatting on the problem page. Try:

- **"Explain the quadratic formula"** — the agent calls `searchTextbook`, retrieves passages, and cites a section + page number in the answer.
- **"What's 2+2?"** — the agent answers from its own knowledge; no tool call.
- Open the **"Show retrieval trace"** `<details>` under any assistant turn to see exactly what the tool returned.

## Capture from your phone

```bash
npm run dev:phone
```

This starts the dev server **and** opens a public HTTPS tunnel via [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) using the [`cloudflared`](https://www.npmjs.com/package/cloudflared) npm package — no signup, no auth, no interstitial, works on iOS Safari. Then open <http://localhost:3000/capture> in your laptop browser: you'll see a QR code. Scan it with your phone (Camera app, not Safari directly), allow camera access on the page that opens, point at a math problem, tap **Capture**. The result page opens automatically with the chat.

The `cloudflared` package downloads the cloudflared binary on `npm install`. The tunnel only stays alive while `npm run dev:phone` is running; the URL stays stable for the entire session and changes each time you restart the script.

If you'd rather skip the tunnel and use the camera page directly on the laptop (Chrome/Edge allow `getUserMedia` over `localhost`), just `npm run dev` and visit `/capture` normally.

## How it works

### Upload flow ([`src/app/actions.ts`](src/app/actions.ts))
1. Server action receives the image bytes.
2. Gemini OCR pass transcribes the problem statement (thinking disabled — transcription doesn't need reasoning).
3. Gemini responder pass produces an initial answer.
4. Image bytes saved to `data/uploads/{id}.{ext}`; the problem document (with three seed messages — file, extraction, response) goes to MongoDB.

### Chat flow ([`src/lib/agent.ts`](src/lib/agent.ts))
1. The chat UI POSTs to `/api/problems/{id}/chat` with the user's message.
2. `runAgent` loads the problem (the **only** DB read for context — this is what enforces per-problem isolation), builds a Gemini `Content[]` from the conversation history, and runs a function-calling loop.
3. Each turn, the model can either emit a final text answer or call `searchTextbook(query, k)`. The system prompt tells it to call the tool only for textbook-style concept questions (definitions, theorems, formulas, worked examples) and skip it for arithmetic and chit-chat.
4. Loop terminates when the model emits a turn with no function calls. Capped at 4 rounds; if the cap fires, one final call with `tools: []` forces a text reply.
5. New messages — the user turn, every tool-call/tool-result trace, and the final assistant turn — are appended to the problem in one update via `appendMessages(id, msgs)`.

### RAG retrieval ([`src/lib/rag.ts`](src/lib/rag.ts))
- Embedding: Gemini `gemini-embedding-001` at 768 dimensions (`outputDimensionality` truncation).
- Aggregation:
  ```js
  { $vectorSearch: {
      index: "textbook_chunks_vector",
      path: "embedding",
      queryVector,
      numCandidates: 150,
      limit: 4,
      filter: { source: TEXTBOOK_SOURCE },
  }}
  ```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run dev:phone` | Dev server + public HTTPS tunnel for `/capture` (QR-code flow) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run ingest -- <pdf>` | Embed a textbook PDF into MongoDB Atlas |
| `npm run voice` | Standalone voice-agent CLI (Ollama + ElevenLabs + Google Speech) — separate from the web app |

## Project structure

```
src/
  app/
    layout.tsx                          Root layout (html shell, fonts, providers)
    actions.ts                          Upload server action (OCR + first response)
    (app)/                              Route group for sidebar-wrapped pages
      layout.tsx                        Sidebar + header chrome
      page.tsx                          Upload page
      problems/[id]/
        page.tsx                        Problem detail page (server-rendered)
        chat.tsx                        Client-side chat UI with retrieval traces
        delete-problem-button.tsx
    capture/
      page.tsx                          Server component — QR (on laptop) or React camera fallback
      capture-client.tsx                React camera UI used when UNBLIND_PUBLIC_URL is unset
    api/
      solve/route.ts                    POST handler used by public/cam.html
      problems/[id]/
        file/route.ts                   Serves the uploaded image
        chat/route.ts                   POST endpoint that runs the agent
  lib/
    mongodb.ts                          Cached client + getDb()
    problems.ts                         Problem CRUD (createProblem, getProblem, appendMessages, …)
    rag.ts                              searchTextbook + embedText
    agent.ts                            runAgent loop, tool wiring, persistence
public/
  cam.html                              Static phone-camera page (vanilla JS, no React)
scripts/
  dev-phone.ts                          npm run dev:phone — dev server + Cloudflare tunnel + QR
  ingest-textbook.ts                    PDF → chunks → embeddings → MongoDB
  voice-agent.ts                        Standalone CLI voice agent (separate from the web app)
```

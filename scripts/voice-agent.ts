/**
 * Voice interaction loop for unblind.
 *
 * Flow:
 *   1. Fetch the problem's initial Gemini response from the web app
 *   2. Speak it via ElevenLabs TTS (afplay on macOS)
 *   3. Listen for spoken follow-up (silence-detection via node-record-lpcm16 + sox)
 *   4. Transcribe via Google Cloud Speech-to-Text
 *   5. Send to the Gemini agent API on the running Next.js server
 *   6. Repeat from step 2
 *
 * Usage:
 *   npm run voice <problemId>
 *
 * Prerequisites:
 *   brew install sox
 *   ollama serve  (no longer needed — uses Gemini via the web app API)
 *
 * .env.local keys needed:
 *   ELEVENLABS_API_KEY=...
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
 *   SERVER_URL=http://localhost:3000   (optional, defaults to localhost:3000)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { ElevenLabsClient } from 'elevenlabs';
import record from 'node-record-lpcm16';
import speech from '@google-cloud/speech';

dotenv.config({ path: '.env.local' });
dotenv.config();

// ── config ────────────────────────────────────────────────────────────────────

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? '';
const SERVER_URL         = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PROBLEM_ID         = process.argv[2] ?? process.env.PROBLEM_ID ?? '';

const VOICE_ID  = 'JBFqnCBsd6RMkjVDRZzb'; // ElevenLabs "George"
const TTS_MODEL = 'eleven_turbo_v2';

const SAMPLE_RATE         = 16_000;
const CHUNK_SEC           = 0.3;
const SILENCE_THRESHOLD   = 600;
const SILENCE_TIMEOUT_SEC = 2.0;
const MAX_RECORD_SEC      = 15.0;

// ── text helpers ──────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, ' [display equation] ')
    .replace(/\$[^$\n]+?\$/g, ' [math] ')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

// ── web app API ───────────────────────────────────────────────────────────────

type ApiMessage = {
  role: string;
  type: string;
  content?: string;
  kind?: string;
};

async function fetchInitialResponse(problemId: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/problems/${problemId}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const problem = (await res.json()) as { messages: ApiMessage[] };
  const response = problem.messages.find(
    (m) => m.role === 'assistant' && m.type === 'text' && m.kind === 'response',
  );
  if (!response?.content) {
    throw new Error('No initial response found for this problem.');
  }
  return response.content;
}

async function askGemini(problemId: string, question: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/problems/${problemId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: question }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { messages: ApiMessage[] };
  const reply = [...body.messages].reverse().find(
    (m) => m.role === 'assistant' && m.kind === 'chat',
  );
  return reply?.content ?? '(No response from assistant.)';
}

// ── TTS ───────────────────────────────────────────────────────────────────────

async function speak(text: string, client: ElevenLabsClient): Promise<void> {
  const clean = stripMarkdown(text);
  const audioStream = await client.textToSpeech.convert(VOICE_ID, {
    text: clean,
    model_id: TTS_MODEL,
    output_format: 'mp3_44100_128',
  });

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const tmpPath = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
  fs.writeFileSync(tmpPath, Buffer.concat(chunks));
  try {
    spawnSync('afplay', [tmpPath], { stdio: 'inherit' });
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// ── STT ───────────────────────────────────────────────────────────────────────

function computeRms(buffer: Buffer): number {
  const numSamples = Math.floor(buffer.length / 2);
  if (numSamples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const sample = buffer.readInt16LE(i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / numSamples);
}

function listen(): Promise<string> {
  return new Promise((resolve) => {
    console.log('[Listener] Speak your question now…');

    const chunkBytes          = Math.floor(SAMPLE_RATE * CHUNK_SEC) * 2;
    const silenceChunksNeeded = Math.ceil(SILENCE_TIMEOUT_SEC / CHUNK_SEC);
    const maxChunks           = Math.ceil(MAX_RECORD_SEC / CHUNK_SEC);

    const pcmChunks: Buffer[] = [];
    let silenceCount   = 0;
    let speechDetected = false;
    let chunkCount     = 0;
    let partial        = Buffer.alloc(0);
    let finished       = false;

    const rec = record.record({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      audioType: 'raw',
      recorder: 'sox',
    });

    const finish = async () => {
      if (finished) return;
      finished = true;
      rec.stop();

      if (!speechDetected || pcmChunks.length === 0) {
        resolve('');
        return;
      }

      const pcm = Buffer.concat(pcmChunks);

      try {
        const sttClient = new speech.SpeechClient();
        const [response] = await sttClient.recognize({
          audio: { content: pcm.toString('base64') },
          config: { encoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, languageCode: 'en-US' },
        });
        const text = (response.results ?? [])
          .map((r: any) => r.alternatives?.[0]?.transcript ?? '')
          .join(' ')
          .trim();
        console.log(`[You] ${text}`);
        resolve(text);
      } catch (err) {
        console.error('[STT error]', err);
        resolve('');
      }
    };

    const stream = rec.stream();

    stream.on('data', (data: Buffer) => {
      partial = Buffer.concat([partial, data]);

      while (partial.length >= chunkBytes) {
        const chunk = partial.subarray(0, chunkBytes);
        partial = partial.subarray(chunkBytes);
        pcmChunks.push(chunk);

        const r = computeRms(chunk);
        if (r > SILENCE_THRESHOLD) {
          speechDetected = true;
          silenceCount = 0;
        } else if (speechDetected) {
          silenceCount++;
          if (silenceCount >= silenceChunksNeeded) { finish(); return; }
        }

        chunkCount++;
        if (chunkCount >= maxChunks) { finish(); return; }
      }
    });

    stream.on('error', (err: Error) => {
      console.error('[Recorder error]', err);
      resolve('');
    });
  });
}

// ── main loop ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!ELEVENLABS_API_KEY) {
    console.error('Error: ELEVENLABS_API_KEY not set in .env.local');
    process.exit(1);
  }
  if (!PROBLEM_ID) {
    console.error('Usage: npm run voice <problemId>');
    process.exit(1);
  }

  console.log(`[Voice] Fetching problem ${PROBLEM_ID} from ${SERVER_URL}…`);
  const initialResponse = await fetchInitialResponse(PROBLEM_ID);
  console.log('[Voice] Got initial response. Speaking…');

  const eleven = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });
  await speak(initialResponse, eleven);

  while (true) {
    console.log('\n[Listener] Waiting for question… (Ctrl+C to exit)');
    const question = await listen();

    if (!question) {
      await speak("Sorry, I didn't catch that. Could you repeat your question?", eleven);
      continue;
    }

    console.log('[Gemini] Thinking…');
    let answer: string;
    try {
      answer = await askGemini(PROBLEM_ID, question);
    } catch (err) {
      console.error('[Gemini error]', err);
      await speak("Sorry, I had trouble getting a response. Please try again.", eleven);
      continue;
    }
    console.log(`[Gemini] ${answer}`);
    await speak(answer, eleven);
  }
}

main().catch((err) => {
  if ((err as NodeJS.ErrnoException)?.code !== 'ERR_USE_AFTER_CLOSE') {
    console.error(err);
  }
  console.log('\nDone.');
});

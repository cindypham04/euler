/**
 * Voice interaction loop for unblind (TypeScript port).
 *
 * Flow:
 *   1. Speak the LLM explanation via ElevenLabs (afplay on macOS)
 *   2. Listen for the user's spoken follow-up (silence-detection via node-record-lpcm16 + sox)
 *   3. Transcribe via Google Cloud Speech-to-Text
 *   4. Send to local Ollama
 *   5. Repeat from step 1
 *
 * Prerequisites (run once):
 *   brew install sox
 *   npm install elevenlabs ollama dotenv node-record-lpcm16 @google-cloud/speech wav
 *   npm install -D typescript @types/node @types/node-record-lpcm16 @types/wav ts-node
 *
 * .env keys needed:
 *   ELEVENLABS_API_KEY=...
 *   OLLAMA_MODEL=gemma4:e2b
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { ElevenLabsClient } from 'elevenlabs';
import ollama from 'ollama';
import record from 'node-record-lpcm16';
import speech from '@google-cloud/speech';

// Next.js uses .env.local; dotenv defaults to .env — try both
dotenv.config({ path: '.env.local' });
dotenv.config(); // fills any keys not already set

// ── config ────────────────────────────────────────────────────────────────────

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? '';
const OLLAMA_MODEL        = process.env.OLLAMA_MODEL ?? 'gemma4:e2b';

const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // ElevenLabs "George"
const TTS_MODEL = 'eleven_turbo_v2';

const SAMPLE_RATE          = 16_000;
const CHUNK_SEC            = 0.3;
const SILENCE_THRESHOLD    = 600;
const SILENCE_TIMEOUT_SEC  = 2.0;
const MAX_RECORD_SEC       = 15.0;

const SYSTEM_PROMPT =
  'You are a helpful math tutor assisting a blind student. ' +
  'The student just heard a calculus problem read aloud. ' +
  'Answer their follow-up questions in plain spoken English — ' +
  'no LaTeX, no symbols, no markdown formatting. ' +
  'Speak as if explaining to someone who cannot see the board. ' +
  'Keep answers concise and clear.';

const INITIAL_LLM_OUTPUT =
  /*'Here is your problem. ' +
  'Evaluate the limit as x approaches 2 of the quantity x squared minus 4, ' +
  'divided by x minus 2. ' +
  'This is a classic indeterminate form. ' +
  'When we substitute x equals 2 directly, we get 0 divided by 0, which is undefined. ' +
  'To resolve this, we factor the numerator: x squared minus 4 equals ' +
  'the product of x plus 2 and x minus 2. ' +
  'Cancel the x minus 2 terms in numerator and denominator. ' +
  'We are left with the limit as x approaches 2 of x plus 2, which equals 4. ' +
  'The answer is 4. ' +*/
  'Do you have any questions about this problem?';

// ── TTS ───────────────────────────────────────────────────────────────────────

async function speak(text: string, client: ElevenLabsClient): Promise<void> {
  const audioStream = await client.textToSpeech.convert(VOICE_ID, {
    text,
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

    const chunkBytes         = Math.floor(SAMPLE_RATE * CHUNK_SEC) * 2; // int16 = 2 bytes/sample
    const silenceChunksNeeded = Math.ceil(SILENCE_TIMEOUT_SEC / CHUNK_SEC);
    const maxChunks          = Math.ceil(MAX_RECORD_SEC / CHUNK_SEC);

    const pcmChunks: Buffer[] = [];
    let silenceCount  = 0;
    let speechDetected = false;
    let chunkCount    = 0;
    let partial       = Buffer.alloc(0);
    let finished      = false;

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

// ── LLM ───────────────────────────────────────────────────────────────────────

type Message = { role: 'user' | 'assistant' | 'system'; content: string };

async function askLlm(question: string, history: Message[]): Promise<string> {
  history.push({ role: 'user', content: question });
  const response = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
  });
  const answer = response.message.content;
  history.push({ role: 'assistant', content: answer });
  return answer;
}

// ── main loop ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!ELEVENLABS_API_KEY) {
    console.error('Error: ELEVENLABS_API_KEY not set in .env');
    process.exit(1);
  }

  const eleven  = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });
  const history: Message[] = [{ role: 'assistant', content: INITIAL_LLM_OUTPUT }];

  console.log('[Speaking] Reading problem explanation…');
  await speak(INITIAL_LLM_OUTPUT, eleven);

  while (true) {
    console.log('\n[Listener] Waiting for question… (Ctrl+C to exit)');
    const question = await listen();

    if (!question) {
      await speak("Sorry, I didn't catch that. Could you repeat your question?", eleven);
      continue;
    }

    console.log('[LLM] Thinking…');
    const answer = await askLlm(question, history);
    console.log(`[LLM] ${answer}`);
    await speak(answer, eleven);
  }
}

main().catch((err) => {
  if ((err as NodeJS.ErrnoException)?.code !== 'ERR_USE_AFTER_CLOSE') {
    console.error(err);
  }
  console.log('\nDone.');
});

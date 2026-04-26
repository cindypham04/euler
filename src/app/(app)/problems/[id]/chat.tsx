"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import type { TextMessage } from "@/lib/problems";

type ChatProps = {
  problemId: string;
  initialMessages: TextMessage[];
};

type ParsedToolCall = { name?: string; args?: Record<string, unknown> };
type ParsedToolHit = {
  section?: string;
  chapter?: string;
  page?: number;
  score?: number;
  snippet?: string;
};

function safeParse<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function ToolCallCard({ message }: { message: TextMessage }) {
  const parsed = safeParse<ParsedToolCall>(message.content);
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Tool call: {parsed?.name ?? "unknown"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto text-xs">
          {JSON.stringify(parsed?.args ?? {}, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

function ToolResultCard({ message }: { message: TextMessage }) {
  const parsed = safeParse<ParsedToolHit[]>(message.content) ?? [];
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Tool result ({parsed.length} hits)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {parsed.map((hit, i) => (
          <div key={i} className="text-xs">
            <div className="font-medium">
              {hit.section ?? "?"} (p.{hit.page ?? "?"})
              {typeof hit.score === "number" && (
                <span className="ml-2 text-muted-foreground">
                  score {hit.score.toFixed(3)}
                </span>
              )}
            </div>
            <p className="text-muted-foreground">{hit.snippet}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MessageCard({ message }: { message: TextMessage }) {
  const title =
    message.kind === "extraction"
      ? "Problem statement"
      : message.kind === "response"
        ? "Initial response"
        : message.role === "user"
          ? "You"
          : "Assistant";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Markdown>{message.content}</Markdown>
      </CardContent>
    </Card>
  );
}

export function Chat({ problemId, initialMessages }: ChatProps) {
  const [messages, setMessages] = useState<TextMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [volumeBars, setVolumeBars] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [sensitivity, setSensitivity] = useState(5);
  const [silenceDelay, setSilenceDelay] = useState(2000);
  const [autoSending, setAutoSending] = useState(false);

  const mutedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const sensitivityRef = useRef(5);
  const silenceDelayRef = useRef(2000);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef("");

  const speakText = useCallback(async (text: string) => {
    if (mutedRef.current) return;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => {});
    } catch {
      // silently ignore TTS errors
    }
  }, []);

  useEffect(() => { inputRef.current = input; }, [input]);

  // Stop TTS and mic when navigating away
  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (silenceTimerRef.current !== null) clearTimeout(silenceTimerRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  // Speak initial Gemini response on mount
  useEffect(() => {
    const initial = initialMessages.find((m) => m.kind === "response");
    if (initial?.content) {
      lastSpokenRef.current = initial.content;
      speakText(initial.content);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Speak new assistant responses as they arrive
  useEffect(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.kind === "chat");
    if (
      lastAssistant?.content &&
      lastAssistant.content !== lastSpokenRef.current
    ) {
      lastSpokenRef.current = lastAssistant.content;
      speakText(lastAssistant.content);
    }
  }, [messages, speakText]);

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next && audioRef.current) {
      audioRef.current.pause();
    }
  }

  function stopAudioAnalysis() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    micStreamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    setVolumeBars(0);
  }

  async function startAudioAnalysis() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = new ((window as any).AudioContext ?? (window as any).webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      micStreamRef.current = stream;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        setMicLevel(Math.min(100, Math.round((rms / 50) * 100)));
        const threshold = sensitivityRef.current * 10;
        setVolumeBars(Math.min(5, Math.floor((rms / threshold) * 5)));
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* mic denied */ }
  }

  async function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = typeof window !== "undefined" ? (window as any) : null;
    const SR = w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
    if (!SR) {
      alert("Speech recognition is not supported in this browser. Use Chrome.");
      return;
    }
    if (recognitionRef.current) return;

    // Acquire mic for analysis before SpeechRecognition touches it
    await startAudioAnalysis();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SR() as any;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript as string;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) {
        setInput((prev) => {
          const next = prev ? prev + " " + final.trim() : final.trim();
          inputRef.current = next;
          return next;
        });
      }
      setInterimTranscript(interim);
      // Reset silence timer on every speech event
      setAutoSending(false);
      if (silenceTimerRef.current !== null) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        if (!inputRef.current.trim()) return;
        setAutoSending(false);
        if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
        formRef.current?.requestSubmit();
      }, silenceDelayRef.current);
      setAutoSending(true);
    };
    recognition.onerror = () => {
      if (silenceTimerRef.current !== null) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript("");
      setAutoSending(false);
      stopAudioAnalysis();
    };
    recognition.onend = () => {
      if (silenceTimerRef.current !== null) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript("");
      setAutoSending(false);
      stopAudioAnalysis();
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stopListening() {
    if (silenceTimerRef.current !== null) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    setListening(false);
    setInterimTranscript("");
    setAutoSending(false);
    stopAudioAnalysis();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch(`/api/problems/${problemId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        messages?: TextMessage[];
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `Request failed with status ${res.status}.`);
        return;
      }
      if (body.messages) {
        const normalized = body.messages.map((m) => ({
          ...m,
          createdAt: new Date(m.createdAt),
        }));
        setMessages((prev) => [...prev, ...normalized]);
        setInput("");
      }
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const form = event.currentTarget.form;
      if (form) form.requestSubmit();
    }
  }

  const visibleMessages: TextMessage[] = [];
  const traceGroups: { afterIndex: number; messages: TextMessage[] }[] = [];
  let pendingTrace: TextMessage[] = [];

  for (const m of messages) {
    if (m.kind === "tool_call" || m.kind === "tool_result") {
      pendingTrace.push(m);
      continue;
    }
    if (pendingTrace.length > 0) {
      traceGroups.push({
        afterIndex: visibleMessages.length - 1,
        messages: pendingTrace,
      });
      pendingTrace = [];
    }
    visibleMessages.push(m);
  }
  if (pendingTrace.length > 0) {
    traceGroups.push({
      afterIndex: visibleMessages.length - 1,
      messages: pendingTrace,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={toggleMute}>
          {muted ? "Unmute" : "Mute"}
        </Button>
      </div>

      {visibleMessages.map((m, i) => (
        <div key={i} className="space-y-3">
          <MessageCard message={m} />
          {traceGroups
            .filter((g) => g.afterIndex === i)
            .map((g, gi) => (
              <details
                key={gi}
                className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm"
              >
                <summary className="cursor-pointer text-muted-foreground">
                  Show retrieval trace ({g.messages.length} steps)
                </summary>
                <div className="mt-3 space-y-2">
                  {g.messages.map((tm, ti) =>
                    tm.kind === "tool_call" ? (
                      <ToolCallCard key={ti} message={tm} />
                    ) : (
                      <ToolResultCard key={ti} message={tm} />
                    ),
                  )}
                </div>
              </details>
            ))}
        </div>
      ))}

      {traceGroups
        .filter((g) => g.afterIndex === -1)
        .map((g, gi) => (
          <details
            key={`pre-${gi}`}
            className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm"
          >
            <summary className="cursor-pointer text-muted-foreground">
              Show retrieval trace ({g.messages.length} steps)
            </summary>
            <div className="mt-3 space-y-2">
              {g.messages.map((tm, ti) =>
                tm.kind === "tool_call" ? (
                  <ToolCallCard key={ti} message={tm} />
                ) : (
                  <ToolResultCard key={ti} message={tm} />
                ),
              )}
            </div>
          </details>
        ))}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={listening && interimTranscript ? input + (input ? " " : "") + interimTranscript : input}
          onChange={(e) => { setInput(e.target.value); inputRef.current = e.target.value; }}
          onKeyDown={handleKeyDown}
          disabled={pending}
          rows={3}
          placeholder="Ask a follow-up about this problem…"
          className="block w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />

        {/* Mic panel */}
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Microphone</span>
            <span className={`text-xs font-medium ${
              autoSending ? "text-yellow-500" :
              listening ? "text-green-500" : "text-muted-foreground"
            }`}>
              {autoSending ? "Silence detected — sending…" : listening ? "Listening" : "Idle"}
            </span>
          </div>

          {/* Level bar + bars */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Input level</span>
              <span>{listening ? `${micLevel}%` : "—"}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  micLevel > 80 ? "bg-red-500" : micLevel > 50 ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: listening ? `${micLevel}%` : "0%" }}
              />
            </div>
            <div className="flex items-end gap-0.5 h-4">
              {[1, 2, 3, 4, 5].map((bar) => (
                <div
                  key={bar}
                  className={`flex-1 rounded-sm transition-all duration-75 ${
                    listening && volumeBars >= bar ? "bg-primary" : "bg-muted-foreground/20"
                  }`}
                  style={{ height: `${6 + bar * 3}px` }}
                />
              ))}
            </div>
          </div>

          {/* Sensitivity */}
          <div className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">Sensitivity</span>
            <input
              type="range" min={1} max={10} value={sensitivity}
              onChange={(e) => { const v = Number(e.target.value); setSensitivity(v); sensitivityRef.current = v; }}
              className="flex-1 accent-primary"
            />
            <span className="w-8 text-right text-xs tabular-nums">{sensitivity}/10</span>
          </div>

          {/* Auto-send delay */}
          <div className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">Auto-send after</span>
            <input
              type="range" min={500} max={4000} step={250} value={silenceDelay}
              onChange={(e) => { const v = Number(e.target.value); setSilenceDelay(v); silenceDelayRef.current = v; }}
              className="flex-1 accent-primary"
            />
            <span className="w-8 text-right text-xs tabular-nums">{(silenceDelay / 1000).toFixed(1)}s</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant={listening ? "default" : "outline"}
            onClick={listening ? stopListening : startListening}
            disabled={pending}
          >
            {listening ? "Stop" : "Speak"}
          </Button>
          <Button type="submit" disabled={pending || input.trim().length === 0}>
            {pending ? "Thinking…" : "Send"}
          </Button>
        </div>
      </form>

      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-destructive">
              {error}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

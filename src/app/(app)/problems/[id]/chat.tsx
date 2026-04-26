"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
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
    <Card className="border-dashed bg-transparent ring-0">
      <CardHeader>
        <CardTitle className="editorial-label">
          Tool call &middot;{" "}
          <span className="font-display normal-case tracking-normal italic text-foreground/80">
            {parsed?.name ?? "unknown"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded bg-muted/60 p-2 font-mono text-[0.7rem] leading-relaxed">
          {JSON.stringify(parsed?.args ?? {}, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

function ToolResultCard({ message }: { message: TextMessage }) {
  const parsed = safeParse<ParsedToolHit[]>(message.content) ?? [];
  return (
    <Card className="border-dashed bg-transparent ring-0">
      <CardHeader>
        <CardTitle className="editorial-label">
          Tool result &middot;{" "}
          <span className="font-display normal-case tracking-normal italic text-foreground/80">
            {parsed.length} hits
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {parsed.map((hit, i) => (
          <div key={i} className="border-l-2 border-foreground/15 pl-3 text-xs">
            <div className="font-display italic">
              {hit.section ?? "?"} <span className="not-italic">·</span> p.
              {hit.page ?? "?"}
              {typeof hit.score === "number" && (
                <span className="ml-2 text-muted-foreground not-italic">
                  score {hit.score.toFixed(3)}
                </span>
              )}
            </div>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              {hit.snippet}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MessageCard({ message }: { message: TextMessage }) {
  const isUser = message.role === "user";
  const title =
    message.kind === "extraction"
      ? "Problem statement"
      : message.kind === "response"
        ? "Initial response"
        : isUser
          ? "You"
          : "Assistant";
  return (
    <Card
      className={cn(
        "ring-0",
        isUser
          ? "border-l-2 border-l-foreground/30 bg-secondary/40"
          : "border-l-2 border-l-primary",
      )}
    >
      <CardHeader>
        <CardTitle className="editorial-rule editorial-label">
          {title}
        </CardTitle>
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
      {visibleMessages.map((m, i) => (
        <div
          key={i}
          className="anim-fade-up space-y-3"
          style={{ animationDelay: `${Math.min(i, 5) * 60}ms` }}
        >
          <MessageCard message={m} />
          {traceGroups
            .filter((g) => g.afterIndex === i)
            .map((g, gi) => (
              <details
                key={gi}
                className="ml-6 border-l border-dashed border-foreground/25 pl-4"
              >
                <summary className="cursor-pointer font-display text-sm italic text-muted-foreground transition-colors hover:text-foreground">
                  marginalia &middot; show retrieval trace ({g.messages.length}{" "}
                  steps)
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
            className="ml-6 border-l border-dashed border-foreground/25 pl-4"
          >
            <summary className="cursor-pointer font-display text-sm italic text-muted-foreground transition-colors hover:text-foreground">
              marginalia &middot; show retrieval trace ({g.messages.length}{" "}
              steps)
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

      <form onSubmit={handleSubmit} className="space-y-3 pt-4">
        <div className="editorial-label">Ask a follow-up</div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
          rows={3}
          placeholder="What confused you about this step?"
          className="block w-full resize-none border-0 border-b-2 border-foreground/20 bg-transparent py-2 font-display text-base italic placeholder:italic placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          style={{ fontVariationSettings: "'opsz' 24" }}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={pending || input.trim().length === 0}
            className="font-display"
          >
            {pending ? (
              <span className="italic">Thinking&hellip;</span>
            ) : (
              <span className="inline-flex items-center gap-2">
                Send <span aria-hidden>&rarr;</span>
              </span>
            )}
          </Button>
        </div>
      </form>

      {error && (
        <Card className="border-l-4 border-l-destructive ring-0">
          <CardHeader>
            <CardTitle className="font-display italic">
              Something went sideways
            </CardTitle>
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

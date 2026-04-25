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

      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
          rows={3}
          placeholder="Ask a follow-up about this problem…"
          className="block w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <div className="flex justify-end">
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

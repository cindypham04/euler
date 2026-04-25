import { NextResponse } from "next/server";
import { ProblemNotFoundError, runAgent } from "@/lib/agent";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const message =
    body && typeof body === "object" && "message" in body
      ? (body as { message: unknown }).message
      : undefined;
  if (typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json(
      { error: "Field `message` is required and must be a non-empty string." },
      { status: 400 },
    );
  }

  try {
    const messages = await runAgent(id, message);
    return NextResponse.json({ messages });
  } catch (err) {
    if (err instanceof ProblemNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

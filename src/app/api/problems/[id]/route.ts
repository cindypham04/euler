import { NextResponse } from "next/server";
import { getProblem } from "@/lib/problems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const problem = await getProblem(id);
  if (!problem) {
    return NextResponse.json({ error: "Problem not found." }, { status: 404 });
  }
  return NextResponse.json(problem);
}

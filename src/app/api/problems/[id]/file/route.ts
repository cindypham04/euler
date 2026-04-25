import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getFirstFileMessage } from "@/lib/problems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file = await getFirstFileMessage(id);
  if (!file) {
    return new NextResponse("Not found", { status: 404 });
  }

  const absolutePath = path.join(process.cwd(), file.path);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    return new NextResponse("File missing on disk", { status: 410 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

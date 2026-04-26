import { NextResponse } from "next/server";
import { getFirstFileMessage, getProblemFile } from "@/lib/problems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const message = await getFirstFileMessage(id);
  if (!message) {
    return new NextResponse("Not found", { status: 404 });
  }

  const file = await getProblemFile(message.fileId.toHexString());
  if (!file) {
    return new NextResponse("File missing", { status: 410 });
  }

  const bytes = file.data.buffer;
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

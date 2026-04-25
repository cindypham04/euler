import { headers } from "next/headers";
import QRCode from "qrcode";
import { CaptureClient } from "./capture-client";

function isLocalHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export default async function CapturePage() {
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "";
  const publicUrl = process.env.UNBLIND_PUBLIC_URL?.replace(/\/$/, "");

  if (publicUrl && isLocalHost(host)) {
    const captureUrl = `${publicUrl}/cam.html`;
    const svg = await QRCode.toString(captureUrl, {
      type: "svg",
      margin: 1,
      width: 320,
      color: { dark: "#000000", light: "#ffffff" },
    });
    return (
      <main className="flex min-h-[80vh] flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Capture from your phone</h1>
          <p className="text-sm text-muted-foreground">
            Scan this with your phone camera, then allow camera access on the
            page that opens.
          </p>
        </div>
        <div
          className="rounded-lg border bg-white p-4"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <code className="max-w-full break-all text-xs text-muted-foreground">
          {captureUrl}
        </code>
        <p className="text-xs text-muted-foreground">
          Tunnel only stays alive while <code>npm run dev:phone</code> is
          running.
        </p>
      </main>
    );
  }

  return <CaptureClient />;
}

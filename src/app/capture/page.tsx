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
  const publicUrl = process.env.EULER_PUBLIC_URL?.replace(/\/$/, "");

  if (publicUrl && isLocalHost(host)) {
    const captureUrl = `${publicUrl}/cam.html`;
    const svg = await QRCode.toString(captureUrl, {
      type: "svg",
      margin: 1,
      width: 320,
      color: { dark: "#1a1422", light: "#fbf6ec" },
    });
    return (
      <main className="bg-graph relative flex min-h-[100dvh] flex-col items-center justify-center gap-8 p-8 text-center">
        <div className="anim-fade-up max-w-md space-y-2">
          <div className="editorial-label">Plate II · Capture</div>
          <h1
            className="font-display text-3xl leading-tight tracking-tight sm:text-4xl"
            style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 30" }}
          >
            <span className="italic">Capture</span> from your phone.
          </h1>
          <p
            className="font-display text-base italic text-muted-foreground"
            style={{ fontVariationSettings: "'opsz' 24" }}
          >
            Scan with the phone camera, then permit camera access on the page
            that opens.
          </p>
        </div>

        <div
          className="crop-marks anim-fade-up rounded border border-border bg-card p-5 shadow-sm"
          style={{ animationDelay: "100ms" }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />

        <div
          className="anim-fade-up max-w-full space-y-1"
          style={{ animationDelay: "200ms" }}
        >
          <div className="editorial-label">Address</div>
          <code className="block max-w-full break-all font-mono text-xs text-foreground/80">
            {captureUrl}
          </code>
        </div>

        <p
          className="anim-fade-up max-w-md font-display text-xs italic text-muted-foreground"
          style={{ animationDelay: "260ms" }}
        >
          Tunnel only stays alive while{" "}
          <code className="font-mono not-italic">npm run dev:phone</code> is
          running.
        </p>
      </main>
    );
  }

  return <CaptureClient />;
}

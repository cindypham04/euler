"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitProblem } from "@/app/actions";

export function CaptureClient() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [debug, setDebug] = useState<string[]>([]);

  function log(line: string): void {
    const stamp = new Date().toISOString().slice(14, 23);
    setDebug((prev) => [...prev, `${stamp} ${line}`]);
    if (typeof console !== "undefined") console.log(`[capture] ${line}`);
  }

  async function startCamera(): Promise<void> {
    if (streamRef.current) return;
    log("startCamera: calling getUserMedia");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      log("startCamera: getUserMedia API missing");
      setError("Camera API not available on this browser/device.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      log("startCamera: got stream");
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      const msg = err instanceof Error ? err.message : String(err);
      log(`startCamera: ERROR ${name}: ${msg}`);
      setError(`${name}: ${msg}`);
      return;
    }

    if (streamRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play();
      } catch {
        // autoplay attribute handles it; ignore
      }
    }
    setStreaming(true);
  }

  useEffect(() => {
    void startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCapture(): void {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Failed to get canvas context.");
      return;
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Failed to encode captured frame.");
          return;
        }
        const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
        const formData = new FormData();
        formData.append("image", file);
        startTransition(async () => {
          const result = await submitProblem(formData);
          if (result.ok) {
            router.push(`/problems/${result.id}`);
          } else {
            setError(result.error);
          }
        });
      },
      "image/jpeg",
      0.92,
    );
  }

  const buttonDisabled = !streaming || pending;
  const buttonLabel = pending ? "Uploading…" : "Capture";

  return (
    <main className="fixed inset-0 flex flex-col bg-black text-white">
      <header className="px-4 py-2">
        <h1 className="text-sm font-semibold">Capture problem</h1>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        {!streaming && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Starting camera…
          </div>
        )}
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm">
            Recognizing…
          </div>
        )}
      </div>

      {debug.length > 0 && (
        <div className="max-h-24 overflow-y-auto bg-black/80 px-2 py-1 font-mono text-[10px] leading-tight text-white/80">
          {debug.slice(-8).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-950 px-4 py-2 text-sm text-red-200">{error}</div>
      )}

      <div
        className="flex items-center justify-center p-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <button
          type="button"
          onClick={handleCapture}
          disabled={buttonDisabled}
          className="min-h-14 min-w-56 rounded-lg bg-white px-6 text-lg font-semibold text-black active:bg-white/80 disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      </div>
    </main>
  );
}

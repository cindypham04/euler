"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import Image from "next/image";
import { submitProblem } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.append("image", file);
    startTransition(async () => {
      const res = await submitProblem(formData);
      if (res.ok) {
        router.push(`/problems/${res.id}`);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 sm:py-16">
      <section className="anim-fade-up relative">
        <div
          aria-hidden
          className="bg-graph absolute -inset-x-6 -inset-y-8 -z-10 opacity-60 [mask-image:radial-gradient(ellipse_at_top,black_40%,transparent_75%)]"
        />
        <div className="editorial-label mb-6">Chapter I · Begin</div>
        <h1
          className="font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          Show me the
          <br />
          <span className="italic">problem.</span>
        </h1>
        <p
          className="drop-cap mt-6 max-w-xl font-display text-lg leading-relaxed text-foreground/80"
          style={{ fontVariationSettings: "'opsz' 32, 'SOFT' 50" }}
        >
          Upload a photograph of any math question. euler will read the
          statement, walk you through it, and stay on call for follow-ups.
        </p>
      </section>

      <form
        onSubmit={handleSubmit}
        className="anim-fade-up mt-12 space-y-6"
        style={{ animationDelay: "120ms" }}
      >
        <label
          htmlFor="image"
          className={`block cursor-pointer rounded-lg border border-dashed border-foreground/30 bg-card/60 p-8 text-center transition-all hover:border-primary/60 hover:bg-card has-[:focus-visible]:border-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40 ${
            pending ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="size-5" />
          </div>
          <div className="mt-4 font-display text-lg italic">
            {file ? file.name : "Drop an image, or click to browse"}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            PNG · JPEG · WEBP · GIF
          </p>

          <div className="mt-6 flex flex-col items-center gap-2">
            <div className="flex w-full items-center gap-3 text-muted-foreground/50">
              <div className="h-px flex-1 bg-current" />
              <span className="text-xs">or scan to capture from phone</span>
              <div className="h-px flex-1 bg-current" />
            </div>
            <Image
              src="/capture-qr.png"
              alt="QR code to capture from phone"
              width={120}
              height={120}
              className="mt-2 rounded-md"
            />
          </div>

          <input
            id="image"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={pending}
            className="sr-only"
          />
        </label>

        <div className="flex items-center justify-between">
          <p className="text-xs italic text-muted-foreground">
            {file
              ? "Ready when you are."
              : "Pick a clean, well-lit photograph for best results."}
          </p>
          <Button
            type="submit"
            disabled={!file || pending}
            size="lg"
            className="font-display"
          >
            {pending ? (
              <span className="italic">Working&hellip;</span>
            ) : (
              <span className="inline-flex items-center gap-2">
                Read the problem <span aria-hidden>&rarr;</span>
              </span>
            )}
          </Button>
        </div>
      </form>

      {error && (
        <Card className="anim-fade-up mt-8 border-l-4 border-l-destructive ring-0">
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
    </main>
  );
}

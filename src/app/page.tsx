"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitProblem } from "./actions";
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
    <main className="mx-auto w-full max-w-3xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">New problem</h1>
        <p className="text-muted-foreground">
          Upload an image. We&apos;ll extract the problem statement and ask the
          model for a response.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex-1 space-y-2">
          <label htmlFor="image" className="text-sm font-medium">
            Image
          </label>
          <input
            id="image"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={pending}
            className="block w-full text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
          />
        </div>
        <Button type="submit" disabled={!file || pending}>
          {pending ? "Working…" : "Submit"}
        </Button>
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
    </main>
  );
}

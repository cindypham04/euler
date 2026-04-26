import { notFound } from "next/navigation";
import { getProblem } from "@/lib/problems";
import { DeleteProblemButton } from "./delete-problem-button";
import { Chat } from "./chat";

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const problem = await getProblem(id);
  if (!problem) notFound();

  const fileMessage = problem.messages.find((m) => m.type === "file");
  const textMessages = problem.messages.filter((m) => m.type === "text");
  const createdAt = new Date(problem.createdAt);
  const folio = id.slice(-4).toUpperCase();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 sm:py-14">
      <header className="anim-fade-up flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="editorial-label mb-2">
            No. {folio} · {shortDate(createdAt)}
          </div>
          <h1
            className="font-display text-3xl leading-tight tracking-tight sm:text-4xl"
            style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 30" }}
          >
            {problem.title}
          </h1>
          <p
            className="mt-1 font-display text-sm italic text-muted-foreground"
            style={{ fontVariationSettings: "'opsz' 24" }}
          >
            recorded {createdAt.toLocaleString()}
          </p>
        </div>
        <DeleteProblemButton id={id} title={problem.title} />
      </header>

      {fileMessage && fileMessage.type === "file" && (
        <figure
          className="anim-fade-up mt-8"
          style={{ animationDelay: "80ms" }}
        >
          <div className="bg-graph rounded-lg border border-dashed border-foreground/30 p-3">
            <div className="rounded border border-border bg-card p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/problems/${id}/file`}
                alt={fileMessage.filename}
                className="mx-auto block max-h-96 w-auto"
              />
            </div>
          </div>
          <figcaption className="mt-3 text-center editorial-label">
            Figure 1 &middot;{" "}
            <span className="font-display normal-case italic tracking-normal">
              {fileMessage.filename}
            </span>
          </figcaption>
        </figure>
      )}

      <div
        className="anim-fade-up mt-12 mb-6 flex items-center gap-4"
        style={{ animationDelay: "160ms" }}
      >
        <div className="h-px flex-1 bg-foreground/15" />
        <div className="editorial-label">Solution</div>
        <div className="h-px flex-1 bg-foreground/15" />
      </div>

      <Chat problemId={id} initialMessages={textMessages} />
    </main>
  );
}

import { notFound } from "next/navigation";
import { getProblem } from "@/lib/problems";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeleteProblemButton } from "./delete-problem-button";
import { Chat } from "./chat";

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

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {problem.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date(problem.createdAt).toLocaleString()}
          </p>
        </div>
        <DeleteProblemButton id={id} title={problem.title} />
      </header>

      {fileMessage && fileMessage.type === "file" && (
        <Card>
          <CardHeader>
            <CardTitle>{fileMessage.filename}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/problems/${id}/file`}
              alt={fileMessage.filename}
              className="max-h-96 w-auto rounded-md border"
            />
          </CardContent>
        </Card>
      )}

      <Chat problemId={id} initialMessages={textMessages} />
    </main>
  );
}

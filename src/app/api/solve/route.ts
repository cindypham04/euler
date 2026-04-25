import { submitProblem } from "@/app/actions";
import { getProblem, type TextMessage } from "@/lib/problems";

export async function POST(request: Request) {
  const formData = await request.formData();
  const submit = await submitProblem(formData);

  if (!submit.ok) {
    return Response.json(submit);
  }

  const doc = await getProblem(submit.id);
  if (!doc) {
    return Response.json({ ok: false, error: "Problem not found after save." });
  }

  const textMessages = doc.messages.filter(
    (m): m is TextMessage => m.type === "text",
  );
  const problem =
    textMessages.find((m) => m.kind === "extraction")?.content ?? "";
  const response =
    textMessages.find((m) => m.kind === "response")?.content ?? "";

  return Response.json({ ok: true, problem, response });
}

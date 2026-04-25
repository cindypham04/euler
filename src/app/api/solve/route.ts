import { submitProblem } from "@/app/actions";

export async function POST(request: Request) {
  const formData = await request.formData();
  const result = await submitProblem(formData);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }
  return Response.json({ ok: true, id: result.id });
}

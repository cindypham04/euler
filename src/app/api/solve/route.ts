import { extractAndRespond } from "@/app/actions";
import { getDb } from "@/lib/mongodb";

export async function POST(request: Request) {
  const formData = await request.formData();
  const result = await extractAndRespond(formData);

  if (result.ok) {
    const file = formData.get("image") as File;
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const db = await getDb();
    await db.collection("solves").insertOne({
      image: { data: base64, mimeType: file.type },
      problem: result.problem,
      response: result.response,
      timestamp: new Date(),
    });
  }

  return Response.json(result);
}

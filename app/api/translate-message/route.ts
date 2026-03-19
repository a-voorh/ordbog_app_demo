import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const message = body.message;

    if (!message || typeof message !== "string") {
      return Response.json({ error: "Missing message" }, { status: 400 });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `Translate Danish to natural English.

Rules:
- Translate the full message.
- Keep the meaning natural and clear.
- Do not explain grammar.
- Return only the English translation as plain text.`
        },
        {
          role: "user",
          content: message
        }
      ],
      text: {
        format: {
          type: "text"
        }
      }
    });

    const translation = response.output_text?.trim() || "";

    return Response.json({ translation });
  } catch (error: any) {
    console.error("TRANSLATE MESSAGE ERROR:", error);

    return Response.json(
      {
        error: "Failed",
        message: error?.message ?? "Unknown error"
      },
      { status: 500 }
    );
  }
}
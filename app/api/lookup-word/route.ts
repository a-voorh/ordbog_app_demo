import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const english = body.english;

    if (!english || typeof english !== "string") {
      return Response.json({ error: "Missing english query" }, { status: 400 });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You help a Danish learner quickly look up an English word or short phrase.

Your job:
1. Give the most natural Danish equivalent.
2. Give the English translation back.
3. Give a short explanation in Danish.
4. Give one natural Danish example sentence.
5. Give the English translation of that example.
6. Give extra_info:
   - if it is a noun: include gender like "en" or "et"
   - if it is a verb: include present tense and past participle if useful
   - otherwise keep it short

Important:
- Prefer one clear, useful Danish answer, not a long list.
- Keep explanations short and practical.
- Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `Look up this English word or phrase: "${english}"

Return JSON with exactly this structure:
{
  "corrected_phrase": "...",
  "translation_en": "...",
  "short_explanation_da": "...",
  "example_da": "...",
  "example_en": "...",
  "extra_info": "..."
}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "lookup_word_response",
          schema: {
            type: "object",
            properties: {
              corrected_phrase: { type: "string" },
              translation_en: { type: "string" },
              short_explanation_da: { type: "string" },
              example_da: { type: "string" },
              example_en: { type: "string" },
              extra_info: { type: "string" },
            },
            required: [
              "corrected_phrase",
              "translation_en",
              "short_explanation_da",
              "example_da",
              "example_en",
              "extra_info",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const text = response.output_text ?? "";

    return Response.json({ result: text });
  } catch (error: any) {
    console.error("LOOKUP WORD ERROR:", error);

    return Response.json(
      {
        error: "Failed",
        message: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
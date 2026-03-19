import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const english = body.english?.trim();

    if (!english || typeof english !== "string") {
      return Response.json({ error: "Missing english query" }, { status: 400 });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You help a Danish learner quickly look up an English word or short phrase.

The user input is in English.
Your main task is to return the best natural Danish translation.

Important field rules:
- "corrected_phrase" MUST be the Danish word or Danish phrase.
- It must NOT repeat the English input unless the Danish form is genuinely identical.
- "translation_en" should contain the English meaning of the Danish phrase.
- "short_explanation_da" must be written in Danish.
- "example_da" must be a natural Danish sentence using the Danish phrase.
- "example_en" must be the English translation of the Danish example sentence.

extra_info:
- if it is a noun: include gender like "en" or "et"
- if it is a verb: include useful forms such as present tense and past participle when relevant
- otherwise keep it short

General rules:
- Prefer one clear, useful Danish answer, not a long list.
- Prefer the most common natural Danish equivalent.
- Keep explanations short and practical.
- Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `English input: "${english}"

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
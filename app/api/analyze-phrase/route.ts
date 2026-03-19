import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const phrase = body.phrase;

    if (!phrase || typeof phrase !== "string") {
      return Response.json({ error: "Missing phrase" }, { status: 400 });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You help a Danish learner save useful Danish phrases.

Your job:
1. Correct Danish spelling mistakes and missing Danish letters (æ, ø, å) if needed.
2. Return the corrected natural Danish phrase.
3. Give the translation in English.
4. Give a short explanation in Danish.
5. Give one natural Danish example sentence.
6. Give the English translation of that example.
7. Give short useful grammar info in Danish.

Important:
- If the input already looks good, keep it unchanged.
- Keep explanations short, practical, and learner-friendly.
- The explanation must be in Danish.
- The explanation should not repeat the word itself. For example: for "anvendelse" it is enough to output "brug eller måde at bruge noget på".
- The translation must be in English.
- Return ONLY valid JSON.
- Do not comment on spelling unless the correction changes the meaning of the phrase.

Rules for "extra_info":
- If the phrase is primarily a verb or verbal expression, give short conjugation info in Danish.
  Example format:
  "nutid: går · datid: gik · perfektum: er gået"
- If the phrase is a noun, give gender info:
  "en-ord" or "et-ord"
- If the phrase is another useful word type, give a short grammar label such as:
  "adverbium", "adjektiv", "fast udtryk", "pronomen"
- Keep extra_info short.
- If no useful extra info is available, return an empty string.
- For reflexive verbs or fixed verbal expressions, keep the info practical and natural for a learner.`
        },
        {
          role: "user",
          content: `Analyze this phrase: "${phrase}"

Return JSON with exactly this structure:
{
  "corrected_phrase": "...",
  "translation_en": "...",
  "short_explanation_da": "...",
  "example_da": "...",
  "example_en": "...",
  "extra_info": "..."
}`
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "phrase_analysis_response",
          schema: {
            type: "object",
            properties: {
              corrected_phrase: { type: "string" },
              translation_en: { type: "string" },
              short_explanation_da: { type: "string" },
              example_da: { type: "string" },
              example_en: { type: "string" },
              extra_info: { type: "string" }
            },
            required: [
              "corrected_phrase",
              "translation_en",
              "short_explanation_da",
              "example_da",
              "example_en",
              "extra_info"
            ],
            additionalProperties: false
          }
        }
      }
    });

    const text = response.output_text ?? "";

    return Response.json({ result: text });
  } catch (error: any) {
    console.error("ANALYZE PHRASE ERROR:", error);

    return Response.json(
      {
        error: "Failed",
        message: error?.message ?? "Unknown error"
      },
      { status: 500 }
    );
  }
}
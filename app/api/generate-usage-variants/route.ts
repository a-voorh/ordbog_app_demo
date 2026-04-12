import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type RequestBody = {
  phrase?: string;
  translation_en?: string;
  short_explanation?: string;
  example_da?: string;
  example_en?: string;
  extra_info?: string | null;
};

const usageVariantsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    variants: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          variant_da: {
            type: "string",
            description: "A natural Danish sentence using the same core phrase.",
          },
          variant_tag: {
            type: "string",
            description:
              "A short label such as question, past, negation, different_subject, subordinate_clause, modal, or plural.",
          },
        },
        required: ["variant_da", "variant_tag"],
      },
    },
  },
  required: ["variants"],
} as const;

function normalizePhraseKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;

    const phrase = body.phrase?.trim();
    const translation_en = body.translation_en?.trim() ?? "";
    const short_explanation = body.short_explanation?.trim() ?? "";
    const example_da = body.example_da?.trim() ?? "";
    const example_en = body.example_en?.trim() ?? "";
    const extra_info = body.extra_info?.trim() ?? "";

    if (!phrase) {
      return NextResponse.json(
        { error: "Missing phrase." },
        { status: 400 }
      );
    }

    const prompt = [
      "You generate hidden Danish usage variants for a language-learning phrase database.",
      "",
      "Your goal is to improve phrase detection, not to paraphrase loosely.",
      "",
      "Rules:",
      "1. Keep the SAME core Danish phrase or construction.",
      "2. Generate only natural Danish.",
      "3. Stay close to the original meaning and structure.",
      "4. Prefer conservative grammatical/contextual variation:",
      "   - question",
      "   - past",
      "   - negation",
      "   - different subject",
      "   - plural subject",
      "   - subordinate clause",
      "   - modal/context variation",
      "5. Do NOT replace the phrase with synonyms.",
      "6. Do NOT explain anything.",
      "7. Do NOT output English.",
      "8. Each variant must be a full Danish sentence.",
      "9. Avoid duplicates.",
      "10. Return 6 variants if possible.",
      "",
      `Phrase: ${phrase}`,
      `English translation: ${translation_en}`,
      `Short explanation: ${short_explanation}`,
      `Main Danish example: ${example_da}`,
      `Main English example: ${example_en}`,
      extra_info ? `Extra info: ${extra_info}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.responses.create({
      model: "gpt-5.4",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "usage_variants",
          schema: usageVariantsSchema,
          strict: true,
        },
      },
    });

    const raw = response.output_text;
    const parsed = JSON.parse(raw) as {
      variants: { variant_da: string; variant_tag: string }[];
    };

    const cleaned = parsed.variants
      .map((item) => ({
        variant_da: item.variant_da.trim(),
        variant_tag: item.variant_tag.trim(),
      }))
      .filter((item) => item.variant_da.length > 0);

    const deduped = Array.from(
      new Map(
        cleaned.map((item) => [normalizePhraseKey(item.variant_da), item])
      ).values()
    ).filter((item) => normalizePhraseKey(item.variant_da) !== normalizePhraseKey(phrase));

    return NextResponse.json({
      result: JSON.stringify(deduped),
    });
  } catch (error) {
    console.error("generate-usage-variants route error:", error);

    return NextResponse.json(
      { error: "Failed to generate usage variants." },
      { status: 500 }
    );
  }
}
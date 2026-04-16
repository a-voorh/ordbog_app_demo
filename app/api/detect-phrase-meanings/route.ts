import OpenAI from "openai";

type MeaningOption = {
  translation_en: string;
  short_explanation_da: string;
  example_da: string;
};

type MeaningDetectionResponse = {
  phrase: string;
  options: MeaningOption[];
};

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const phrase = typeof body.phrase === "string" ? body.phrase.trim() : "";

    if (!phrase) {
      return Response.json(
        { error: "Missing phrase" },
        { status: 400 }
      );
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You help identify distinct meanings or usages of a Danish word or phrase.

Your task:
- inspect the Danish input phrase
- return 1 to 4 clearly distinct meanings/usages
- each meaning must be meaningfully different
- do NOT return tiny stylistic variations of the same meaning
- do NOT over-split
- if the phrase is not genuinely ambiguous, return only 1 option

For each option, return:
- translation_en: a short, clear English meaning label
- short_explanation_da: a short Danish explanation for that meaning
- example_da: a short natural Danish example that fits that meaning

Important rules:
- keep translation_en short and practical
- keep short_explanation_da short and learner-friendly
- keep example_da short, natural, and clearly tied to that meaning
- if the input is a fixed expression, prefer usage-based distinctions only if they are genuinely different
- do not invent rare dictionary senses unless they are genuinely common or useful for a learner
- do not include numbering in the text fields
- do not include duplicate meanings
- return only valid JSON

Return exactly this JSON structure:
{
  "phrase": "input phrase",
  "options": [
    {
      "translation_en": "short English meaning",
      "short_explanation_da": "short Danish explanation",
      "example_da": "short Danish example"
    }
  ]
}`,
        },
        {
          role: "user",
          content: phrase,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "meaning_detection_response",
          schema: {
            type: "object",
            properties: {
              phrase: { type: "string" },
              options: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    translation_en: { type: "string" },
                    short_explanation_da: { type: "string" },
                    example_da: { type: "string" },
                  },
                  required: [
                    "translation_en",
                    "short_explanation_da",
                    "example_da",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["phrase", "options"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawText = response.output_text ?? "";

    let parsed: MeaningDetectionResponse;

    try {
      parsed = JSON.parse(rawText) as MeaningDetectionResponse;
    } catch (err) {
      console.error("Failed to parse meaning detection JSON:", rawText, err);

      return Response.json(
        {
          error: "Failed to parse meaning detection response",
          raw: rawText,
        },
        { status: 500 }
      );
    }

    const cleanedOptions = Array.from(
      new Map(
        (parsed.options || [])
          .map((option) => ({
            translation_en: option.translation_en?.trim(),
            short_explanation_da: option.short_explanation_da?.trim(),
            example_da: option.example_da?.trim(),
          }))
          .filter(
            (option) =>
              option.translation_en &&
              option.short_explanation_da &&
              option.example_da
          )
          .map((option) => [
            option.translation_en.toLowerCase(),
            option,
          ])
      ).values()
    );

    return Response.json({
      phrase,
      options: cleanedOptions,
    });
  } catch (error: any) {
    console.error("DETECT PHRASE MEANINGS ERROR:", error);

    return Response.json(
      {
        error: "Failed",
        message: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const {
      english_prompt,
      reference_answer_da,
      learner_answer_da,
      target_phrase,
      require_target_phrase = false,
    } = await req.json();

    if (!english_prompt || !learner_answer_da) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const systemPrompt = `
You are evaluating a Danish learner's translation.

You MUST return strict JSON only.

Evaluation goals:
- Check if the learner's Danish sentence correctly expresses the English meaning
- Check if the Danish is natural
- Optionally check if a target phrase is used

Important rules:
- DO NOT require word-by-word similarity with the reference answer
- Accept any natural Danish that conveys the same meaning
- Ignore small punctuation or capitalization issues
- Be slightly generous, especially for minor mistakes

Status definitions:
- "correct": meaning is correct and Danish is natural
- "almost": meaning is mostly correct but there are noticeable issues
- "wrong": meaning is incorrect or Danish is clearly unnatural

If require_target_phrase is true:
- The answer MUST include the target phrase (or valid inflection)
- If meaning is correct but target phrase is missing → "almost"

Return JSON:
{
  "status": "correct" | "almost" | "wrong",
  "meaning_ok": boolean,
  "natural_da": boolean,
  "target_phrase_used": boolean,
  "feedback_da": string,
  "corrected_answer_da": string | null
}
`;

    const userPrompt = `
English prompt:
"${english_prompt}"

Reference Danish answer:
"${reference_answer_da || ""}"

Target phrase (if any):
"${target_phrase || ""}"

Require target phrase:
${require_target_phrase}

Learner answer:
"${learner_answer_da}"
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
     body: JSON.stringify({
  model: "gpt-4.1-mini",
  temperature: 0,
  text: {
    format: {
      type: "json_object",
    },
  },
  input: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
}),
    });

    const data = await response.json();
    

    const outputText =
  data.output_text ||
  data.output?.[0]?.content?.find((item: any) => item.type === "output_text")?.text ||
  data.output?.flatMap((item: any) => item.content || [])
    ?.find((item: any) => item.type === "output_text")?.text ||
  null;

    if (!outputText) {
      return NextResponse.json(
        { error: "No output from model" },
        { status: 500 }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (e) {
      return NextResponse.json(
        { error: "Invalid JSON from model", raw: outputText },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}

import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeJsonParse(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const targetPhrases = Array.isArray(body.targetPhrases)
      ? body.targetPhrases.filter(Boolean).slice(0, 4)
      : [];

    if (targetPhrases.length < 2) {
      return NextResponse.json(
        { error: "At least two target phrases are required." },
        { status: 400 }
      );
    }

    const prompt = `
You create Danish rewriting missions for a Danish learner.

Target phrases:
${targetPhrases.map((p: string) => `- ${p}`).join("\n")}

Create one short Danish text at low A2 level.

The learner's task is to rewrite the text so it becomes:
- shorter,
- smoother,
- more natural,
- and more Danish-like.

IMPORTANT:

The original text MUST be grammatically correct Danish.

Do NOT create:
- grammar mistakes,
- incorrect prepositions,
- broken word order,
- missing articles,
- agreement mistakes,
- unnatural syntax.

The text should sound like:
- simple,
- repetitive,
- overly explicit,
- slightly clumsy,
- but still correct Danish.

Think:
"inefficient Danish"
NOT:
"wrong Danish"

The learner should improve:
- flow,
- conciseness,
- connector usage,
- naturalness,
- sentence structure.

NOT fix grammar errors.

STYLE RULES:

The original text should sound like simple but correct learner Danish:
- simple vocabulary,
- repetitive structure,
- too many short sentences,
- explanations that are too direct,
- things said in a long way instead of a natural short way.

The learner should realistically be able to rewrite the text in 1-2 sentences.

GOOD examples of style:
- "Det er ikke godt for kroppen."
- "Jeg var meget træt. Jeg gik stadig på arbejde."
- "Det regnede meget. Jeg blev meget våd."
- "Jeg havde ikke tid. Jeg spiste meget hurtigt."
- "Jeg var nervøs. Jeg sagde ikke så meget."

BAD style:
- encyclopedia facts,
- philosophical observations,
- formal writing,
- poetic language,
- advanced vocabulary,
- textbook explanations,
- artificial dramatic stories,
- vague filler phrases like "mange forskellige ting", "noget andet", "flere ting sammen", "meget information".

Use:
- everyday situations,
- work,
- transport,
- family,
- weather,
- food,
- appointments,
- school,
- tiredness,
- small daily problems.

Very important:
- Do NOT use the target phrases.
- Do NOT use close variants of the target phrases.
- Instead, create situations where those phrases would naturally help.
- Do NOT use advanced connector words unless they are target phrases.
- Do NOT make the text elegant already.

The text should contain 4-5 short sentences.

Keep the vocabulary simple, concrete, and realistic.

Danish only.

Return JSON only:
{
  "title": "Gør teksten kortere",
  "task_da": "Skriv teksten om, så den bliver kortere og mere naturlig. Du må gerne bruge ordene og vendingerne ovenfor.",
  "original_text_da": "...",
  "target_phrases": ["..."]
}
`;

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: prompt,
    });

    const text = response.output_text || "";
    const parsed = safeJsonParse(text);

    return NextResponse.json({
      title: parsed.title ?? "Gør teksten kortere",
      task_da:
        parsed.task_da ??
        "Skriv teksten om, så den bliver kortere og mere naturlig.",
      original_text_da: parsed.original_text_da ?? "",
      target_phrases: targetPhrases,
    });
  } catch (error) {
    console.error("generate-writing-mission error", error);

    return NextResponse.json(
      { error: "Could not generate writing mission." },
      { status: 500 }
    );
  }
}
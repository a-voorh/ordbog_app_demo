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

    const originalText = String(body.original_text_da ?? "").trim();
    const userText = String(body.user_text_da ?? "").trim();
    const targetPhrases = Array.isArray(body.target_phrases)
      ? body.target_phrases.filter(Boolean)
      : [];

    if (!originalText || !userText) {
      return NextResponse.json(
        { error: "Original text and user text are required." },
        { status: 400 }
      );
    }

    const prompt = `
You evaluate a Danish learner's rewrite.

Original text:
${originalText}

Learner rewrite:
${userText}

Target phrases:
${targetPhrases.map((p: string) => `- ${p}`).join("\n")}

Evaluate whether the learner:
- preserved the meaning,
- made the text shorter or smoother,
- used any target phrases naturally,
- missed obvious chances to use useful target phrases.

Be kind, concise, and practical.
Do not overcorrect commas or tiny style issues.
Danish feedback should be learner-friendly.

Return JSON only:
{
  "meaning_preserved": true,
  "naturalness": "good",
  "conciseness": "shorter",
  "used_target_phrases": ["..."],
  "missed_opportunities": ["..."],
  "feedback_da": "...",
  "suggested_version_da": "..."
}
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const parsed = safeJsonParse(response.output_text);

    return NextResponse.json({
      meaning_preserved: Boolean(parsed.meaning_preserved),
      naturalness: parsed.naturalness ?? "okay",
      conciseness: parsed.conciseness ?? "same",
      used_target_phrases: Array.isArray(parsed.used_target_phrases)
        ? parsed.used_target_phrases
        : [],
      missed_opportunities: Array.isArray(parsed.missed_opportunities)
        ? parsed.missed_opportunities
        : [],
      feedback_da: parsed.feedback_da ?? "",
      suggested_version_da: parsed.suggested_version_da ?? "",
    });
  } catch (error) {
    console.error("evaluate-writing-mission error", error);
    return NextResponse.json(
      { error: "Could not evaluate writing mission." },
      { status: 500 }
    );
  }
}
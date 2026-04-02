import OpenAI from "openai";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type PhraseFeedback = {
  phrase: string;
  status: "correct" | "almost" | "wrong" | "unused";
  comment: string;
  suggestion: string;
  detectedText: string;
  sentenceIssue: "none" | "minor" | "major";
  sentenceComment: string;
};

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const cards = body.cards || [];
    const history = body.history || [];
    const userMessage = body.userMessage || "";
    const currentFeedback = body.currentFeedback || [];

    if (!Array.isArray(cards) || cards.length === 0) {
      return Response.json(
        { error: "No phrase cards provided" },
        { status: 400 }
      );
    }

    if (!userMessage || typeof userMessage !== "string") {
      return Response.json(
        { error: "Missing userMessage" },
        { status: 400 }
      );
    }

    if (!Array.isArray(currentFeedback)) {
      return Response.json(
        { error: "Invalid currentFeedback" },
        { status: 400 }
      );
    }

    const phraseList: string[] = cards.map((card: any) => card.phrase);

    const previousAssistantMessage =
      [...(history as ChatMessage[])]
        .reverse()
        .find(
          (msg) =>
            msg &&
            msg.role === "assistant" &&
            typeof msg.content === "string"
        )?.content ?? "";

    const reviewResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You are reviewing phrase-usage feedback for a Danish learner.

Your task:
Review the EXISTING feedback carefully.
Do not start from scratch unless necessary.
Keep judgments that are already good.
Only change judgments that are:
- too strict
- too lenient
- internally inconsistent
- based on hallucinated corrections
- based on confusing the base form with the actual learner form

Target phrases:
${phraseList.map((p) => `- ${p}`).join("\n")}

--------------------------------
VERY IMPORTANT REVIEW PHILOSOPHY
--------------------------------

You are a SECOND OPINION reviewer.
You are not a generosity booster.
You should not upgrade results unless the current feedback is genuinely wrong.

If the current feedback already says:
- "almost" for a phrase that was corrected only after an earlier failed attempt,
you must NOT turn that into a cleaner "correct" merely because the latest wording is acceptable.

In other words:
- preserve the practical meaning of retry-based evaluation
- do not use second opinion to erase the fact that the learner needed a retry
- if the current feedback is already reflecting that idea reasonably, keep it

So:
- do NOT inflate statuses
- do NOT convert "almost" to "correct" unless the current feedback is clearly mistaken on linguistic grounds
- do NOT soften retry-based feedback just because the final form is fine

Your job is fairness, not score inflation.

--------------------------------
REVIEW PRINCIPLES
--------------------------------

1. Trust the exact learner wording.
2. Trust the exact detectedText.
3. Accept correct inflected forms.
4. Do NOT require the base form literally.
5. Do NOT invent missing words, articles, pronouns, or "at".
6. Do NOT over-correct style when the phrase itself is acceptable.
7. Do NOT give a suggestion that repeats the learner's wording.
8. Do NOT scold for an unused phrase.
9. Do NOT punish missing commas or harmless punctuation.

--------------------------------
IMPORTANT DANISH RULES
--------------------------------

- Correct inflected forms count as correct.
  Examples:
  - "at spilde" → "spildt", "spilder", "spildte"
  - "sikkerhedsmæssig" → "sikkerhedsmæssige"
  - "betydelig" → "betydeligt" when the adverb is appropriate

- After modal verbs like "skal", "kan", "vil", "må", do NOT require "at".
  Example:
  - "jeg skal håndtere det" is correct

- Do NOT require "at" when the learner already uses a correct finite verb or participle.
  Example:
  - "jeg har spildt tid" is correct

- Accept natural common expressions like:
  - "spilde tid"
  - "sænke energiforbrug"

- Do NOT force optional changes like:
  - adding "med"
  - changing "energiforbrug" to "energiforbruget"
  - changing wording just because another version also exists

--------------------------------
PUNCTUATION / COMMA RULE
--------------------------------

Be lenient about punctuation.

- Missing commas should normally be ignored.
- Small punctuation issues should not lower phrase status.
- Do not mark a phrase wrong or almost wrong because of commas.
- Only mention punctuation if it seriously changes meaning or makes the sentence genuinely hard to understand.

--------------------------------
OUTPUT RULES
--------------------------------

Return revised feedback in the same format as the current feedback.
You may keep items unchanged if they are already good.
You may revise status, comment, suggestion, detectedText, sentenceIssue, sentenceComment.

Be concise and practical.
If a phrase is correct, suggestion should usually be empty.
If a phrase is unused, suggestion must be empty.

Very important:
- do not improve a retry-based "almost" into "correct" unless the original judgment is clearly linguistically wrong
- do not let second opinion function as a way to bypass retry scoring
- if the current feedback is already reasonable, preserve it

Only mention grammar mistakes if they are real and certain.
If there are no mistakes, explicitly say:
"No other grammar mistakes."
Do NOT invent corrections.

Return ONLY valid JSON with exactly this structure:
{
  "phraseFeedback": [
    {
      "phrase": "target phrase",
      "status": "correct | almost | wrong | unused",
      "comment": "short comment",
      "suggestion": "short corrected version or empty string",
      "detectedText": "exact matching text from learner message or empty string",
      "sentenceIssue": "none | minor | major",
      "sentenceComment": "short explanation of grammar issue outside the target phrase, or empty string"
    }
  ]
}`,
        },
        {
          role: "user",
          content: `Previous assistant message:
${previousAssistantMessage || "(none)"}

Learner message:
${userMessage}

Current feedback:
${JSON.stringify(currentFeedback, null, 2)}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "second_opinion_feedback_response",
          schema: {
            type: "object",
            properties: {
              phraseFeedback: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    phrase: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["correct", "almost", "wrong", "unused"],
                    },
                    comment: { type: "string" },
                    suggestion: { type: "string" },
                    detectedText: { type: "string" },
                    sentenceIssue: {
                      type: "string",
                      enum: ["none", "minor", "major"],
                    },
                    sentenceComment: { type: "string" },
                  },
                  required: [
                    "phrase",
                    "status",
                    "comment",
                    "suggestion",
                    "detectedText",
                    "sentenceIssue",
                    "sentenceComment",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["phraseFeedback"],
            additionalProperties: false,
          },
        },
      },
    });

    const reviewText = reviewResponse.output_text ?? "";

    let phraseFeedback: PhraseFeedback[] = [];

    try {
      const parsed = JSON.parse(reviewText);
      if (Array.isArray(parsed.phraseFeedback)) {
        phraseFeedback = parsed.phraseFeedback;
      } else {
        throw new Error("phraseFeedback missing or invalid");
      }
    } catch (err) {
      console.error("Failed to parse second opinion JSON:", reviewText, err);

      return Response.json(
        {
          error: "Failed to parse second opinion response",
          raw: reviewText,
        },
        { status: 500 }
      );
    }

    return Response.json({ phraseFeedback });
  } catch (error: any) {
    console.error("PRACTICE SECOND OPINION ERROR:", error);

    return Response.json(
      {
        error: "Failed",
        message: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
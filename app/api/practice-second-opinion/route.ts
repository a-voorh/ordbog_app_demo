import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { buildFeedbackSummary } from "../../practice/buildFeedbackSummary";
import { TABLES } from "../../../lib/tables";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type PhraseFeedback = {
  phraseId: string;
  phrase: string;
  status: "correct" | "almost" | "wrong" | "unused";
  comment: string;
  suggestion: string;
  detectedText: string;
  sentenceIssue: "none" | "minor" | "major";
  sentenceComment: string;
  correctedSentence: string;
};

type IncomingPhraseCard = {
  id: string;
  phrase: string;
  translation_en?: string | null;
  short_explanation?: string | null;
};

type VariantRow = {
  phrase_id: string;
  variant_da: string;
  usable_for_matching: boolean;
};

type PhraseWithVariants = {
  id: string;
  phrase: string;
  translation_en: string;
  short_explanation: string;
  matchingVariants: string[];
};

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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

    const typedCards: IncomingPhraseCard[] = cards
      .filter(
        (card: any) =>
          card &&
          typeof card.id === "string" &&
          typeof card.phrase === "string"
      )
      .map((card: any) => ({
        id: card.id,
        phrase: card.phrase,
        translation_en:
          typeof card.translation_en === "string" ? card.translation_en : "",
        short_explanation:
          typeof card.short_explanation === "string"
            ? card.short_explanation
            : "",
      }));

    if (typedCards.length === 0) {
      return Response.json(
        { error: "Phrase cards are missing valid id/phrase values" },
        { status: 400 }
      );
    }

    const typedFeedback: PhraseFeedback[] = currentFeedback
      .filter(
        (item: any) =>
          item &&
          typeof item.phraseId === "string" &&
          typeof item.phrase === "string" &&
          typeof item.status === "string"
      )
      .map((item: any) => ({
        phraseId: item.phraseId,
        phrase: item.phrase,
        status:
          item.status === "correct" ||
          item.status === "almost" ||
          item.status === "wrong" ||
          item.status === "unused"
            ? item.status
            : "unused",
        comment: typeof item.comment === "string" ? item.comment : "",
        suggestion: typeof item.suggestion === "string" ? item.suggestion : "",
        detectedText:
          typeof item.detectedText === "string" ? item.detectedText : "",
        sentenceIssue:
          item.sentenceIssue === "minor" || item.sentenceIssue === "major"
            ? item.sentenceIssue
            : "none",
        sentenceComment:
          typeof item.sentenceComment === "string"
            ? item.sentenceComment
            : "",
        correctedSentence:
          typeof item.correctedSentence === "string"
            ? item.correctedSentence
            : "",
      }));

    const phraseIds = typedCards.map((card) => card.id);

    let phrasesWithVariants: PhraseWithVariants[] = typedCards.map((card) => ({
      id: card.id,
      phrase: card.phrase,
      translation_en: card.translation_en ?? "",
      short_explanation: card.short_explanation ?? "",
      matchingVariants: [],
    }));

    if (phraseIds.length > 0) {
      const { data: variantRows, error: variantError } = await supabase
        .from(TABLES.variants)
        .select("phrase_id, variant_da, usable_for_matching")
        .in("phrase_id", phraseIds)
        .eq("usable_for_matching", true);

      if (variantError) {
        console.error("Failed to load phrase variants:", variantError);
      } else {
        const variantsByPhraseId = new Map<string, string[]>();

        for (const row of (variantRows || []) as VariantRow[]) {
          const variant = row.variant_da?.trim();
          if (!variant) continue;

          const existing = variantsByPhraseId.get(row.phrase_id) || [];
          existing.push(variant);
          variantsByPhraseId.set(row.phrase_id, existing);
        }

        phrasesWithVariants = typedCards.map((card) => ({
          id: card.id,
          phrase: card.phrase,
          translation_en: card.translation_en ?? "",
          short_explanation: card.short_explanation ?? "",
          matchingVariants: Array.from(
            new Set(variantsByPhraseId.get(card.id) || [])
          ),
        }));
      }
    }

    const phraseListWithVariantsForPrompt = phrasesWithVariants
      .map((item) => {
        const variantsText =
          item.matchingVariants.length > 0
            ? `\n  Accepted stored variants:\n${item.matchingVariants
                .map((v) => `  - ${v}`)
                .join("\n")}`
            : "";

        return `- phraseId: ${item.id}
  Base phrase: ${item.phrase}
  Target meaning in English: ${item.translation_en || "(not provided)"}
  Target explanation in Danish: ${
    item.short_explanation || "(not provided)"
  }${variantsText}`;
      })
      .join("\n");

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
- based on rejecting an accepted stored variant that should count
- based on confusing one meaning of a surface word with another meaning of the same surface word

Target phrases and accepted stored variants:
${phraseListWithVariantsForPrompt}

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
MEANING-SENSITIVE REVIEW
--------------------------------

Some Danish surface words may appear in more than one saved card with different meanings.
You must review each item by phraseId and target meaning, not by surface word alone.

That means:
- the same written word can be correct for one card and irrelevant for another
- do not revise feedback as if all identical surface forms are the same target
- if the learner used the same surface word with another meaning, do not automatically treat that as wrong for this target
- when the learner clearly used another meaning of the same word, "unused" is often more appropriate than "wrong"
- only keep "wrong" when the learner clearly attempted THIS target meaning and got it wrong

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
10. Accepted stored variants count as valid usage of the target phrase.
11. Natural inflected forms of accepted stored variants also count.
12. Review each phrase by phraseId and target meaning, not only by surface phrase.
13. Punctuation mistakes should normally be ignored.
14. Do not downgrade a phrase from correct to almost or wrong just because of punctuation, capitalization, or informal chat-style writing.
15. Minor punctuation problems may be mentioned in feedback if useful, but they must not determine the phrase verdict.

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

- If the learner uses an accepted stored variant correctly, that is valid usage of the target phrase.

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
You may revise status, comment, suggestion, detectedText, sentenceIssue, sentenceComment, correctedSentence.

Be concise and practical.
If a phrase is correct, suggestion should usually be empty.
If a phrase is unused, suggestion must be empty.

Very important:
- do not improve a retry-based "almost" into "correct" unless the original judgment is clearly linguistically wrong
- do not let second opinion function as a way to bypass retry scoring
- if the current feedback is already reasonable, preserve it
- do not reject a phrase just because the learner used an accepted stored variant instead of the base phrase
- do not reject a phrase just because the learner used a correct inflected form of an accepted stored variant
- do not confuse identical-looking surface words across different meanings

Only mention grammar mistakes if they are real and certain.
If there are no mistakes, explicitly say:
"No other grammar mistakes."
Do NOT invent corrections.

Return ONLY valid JSON with exactly this structure:
{
  "phraseFeedback": [
    {
      "phraseId": "target phrase id",
      "phrase": "target phrase",
      "status": "correct | almost | wrong | unused",
      "comment": "short comment",
      "suggestion": "short corrected version or empty string",
      "detectedText": "exact matching text from learner message or empty string",
      "sentenceIssue": "none | minor | major",
      "sentenceComment": "short explanation of grammar issue outside the target phrase, or empty string",
      "correctedSentence": "full corrected learner sentence or empty string"
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
${JSON.stringify(typedFeedback, null, 2)}`,
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
                    phraseId: { type: "string" },
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
                    correctedSentence: { type: "string" },
                  },
                  required: [
                    "phraseId",
                    "phrase",
                    "status",
                    "comment",
                    "suggestion",
                    "detectedText",
                    "sentenceIssue",
                    "sentenceComment",
                    "correctedSentence",
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

    const feedbackSummary = await buildFeedbackSummary({
      openai: client,
      userMessage,
      phraseFeedback,
    });

    return Response.json({ phraseFeedback, feedbackSummary });
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
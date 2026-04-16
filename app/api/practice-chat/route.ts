import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { evaluateAndApplySpontaneousUsage } from "../../practice/spontaneous";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type PhraseCard = {
  id: string;
  phrase: string;
};

type VariantRow = {
  phrase_id: string;
  variant_da: string;
  usable_for_matching: boolean;
};

type PhraseWithVariants = {
  id: string;
  phrase: string;
  matchingVariants: string[];
};

type PhraseFeedbackItem = {
  phrase: string;
  status: "correct" | "almost" | "wrong" | "unused";
  comment: string;
  suggestion: string;
  detectedText: string;
  sentenceIssue: "none" | "minor" | "major";
  sentenceComment: string;
  correctedSentence: string;
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.,!?;:()"“”'‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripLeadingAt = (phrase: string) =>
  phrase.trim().replace(/^at\s+/i, "").trim();

const assistantReplyUsesForbiddenPhrase = (
  reply: string,
  phraseList: string[]
) => {
  const normalizedReply = ` ${normalizeText(reply)} `;

  return phraseList.some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    const normalizedWithoutAt = normalizeText(stripLeadingAt(phrase));

    return (
      (normalizedPhrase &&
        normalizedReply.includes(` ${normalizedPhrase} `)) ||
      (normalizedWithoutAt &&
        normalizedWithoutAt !== normalizedPhrase &&
        normalizedReply.includes(` ${normalizedWithoutAt} `))
    );
  });
};

const assistantReplySoundsLikeLearner = (reply: string) => {
  const normalized = normalizeText(reply);

  const badMetaLearnerPatterns = [
    "jeg lærer dansk",
    "jeg prøver at lære",
    "jeg øver mig på",
    "i mit liv",
    "for mig er det",
  ];

  return badMetaLearnerPatterns.some((pattern) =>
    normalized.includes(pattern)
  );
};

const assistantBreaksRole = (reply: string) => {
  const normalized = normalizeText(reply);

  const badNarrativePatterns = [
    "jeg havde",
    "jeg var",
    "jeg oplevede",
    "jeg rejste",
    "jeg gjorde",
    "jeg havde forventet",
    "jeg savnede",
    "jeg nød",
    "jeg tog",
    "jeg prøvede",
    "jeg fandt ud af",
    "jeg besøgte",
    "jeg boede",
    "jeg kom til",
    "jeg blev nødt til",
    "jeg skal",
    "jeg skulle",
    "jeg må",
    "jeg måtte",
    "jeg arbejder",
    "jeg studerer",
  ];

  return badNarrativePatterns.some((pattern) =>
    normalized.includes(pattern)
  );
};

const buildSinglePhrasePrompt = (
  phrase: string,
  acceptedVariants: string[]
) => {
  const targetPhraseBlock = [
    `Base phrase: ${phrase}`,
    acceptedVariants.length > 0
      ? `Accepted stored variants:\n${acceptedVariants
          .map((v) => `- ${v}`)
          .join("\n")}`
      : `Accepted stored variants:\n(none)`,
  ].join("\n");

  return `You evaluate whether a learner used ONE target Danish phrase correctly in their latest message.

TARGET PHRASE TO EVALUATE:
${targetPhraseBlock}

You must inspect:
1. the learner message
2. the previous assistant message, if provided, for context

Do NOT consider earlier conversation history beyond the previous assistant message.

IMPORTANT:
You are evaluating ONLY this one target phrase.
Your task is NOT to evaluate all target phrases at once.
Be exhaustive about THIS phrase only.

--------------------------------
CORE PRINCIPLE
--------------------------------

This target phrase counts as used if the learner used:
- the base phrase itself
- a natural inflected grammatical form of the base phrase
- an accepted stored variant listed above
- a natural inflected grammatical form of an accepted stored variant

If the learner uses an accepted stored variant correctly, treat it as usage of the target phrase.

Evaluate the TARGET PHRASE separately from the rest of the sentence.

A target phrase can still be "correct" if it is used correctly and the sentence is meaningful, even if there is a small grammar issue elsewhere.
In such a case:
- keep status = "correct"
- use sentenceIssue = "minor"
- explain the outside issue in sentenceComment

--------------------------------
1. STATUS DEFINITIONS
--------------------------------

Use "correct" when ALL are true:
- the learner used the target phrase or a natural inflected/grammatical variant of it, including accepted stored variants
- the target phrase itself is grammatically correct in the learner's sentence
- the target phrase is used with the correct meaning and function
- the full learner sentence is semantically meaningful and plausible in Danish
- if the phrase depends on discourse context, that context is satisfied

Use "almost" when:
- the learner clearly attempted the target phrase
- the intended meaning is understandable
- there is a small mistake INSIDE the target phrase
- but the phrase is still close to correct

Use "wrong" when:
- the learner clearly attempted the target phrase
- but the target phrase itself is incorrect
OR
- the phrase meaning or function is wrong in context
OR
- the phrase is used with impossible or unnatural arguments
OR
- the sentence is not meaningful enough to accept the phrase
OR
- a required contextual relation is missing

Use "unused" when:
- the learner did not actually use the phrase, the accepted stored variants, or natural inflected forms of them

--------------------------------
2. INFLECTION
--------------------------------

Target phrases do NOT need to appear in their base form.

Accept natural Danish inflections without criticism.

Examples:
- "at spilde" → "spilder", "spildte", "spildt"
- "sikkerhedsmæssig" → "sikkerhedsmæssige"
- "betydelig" → "betydeligt"

Rules:
- if the learner uses a correct inflected form, mark it "correct"
- do NOT criticize singular vs plural if the learner form is correct
- do NOT criticize tense differences if the learner form is correct
- do NOT mention that the base form is different
- only comment on form if the learner's actual form is wrong

CRITICAL:
If the learner uses a correct conjugated verb form, you MUST treat it as correct usage of the phrase.
You MUST NOT require the infinitive form "at + verb".

The same rule applies to accepted stored variants.

--------------------------------
3. RULES ABOUT "AT"
--------------------------------

Do NOT require the infinitive marker "at" unless the learner's grammar truly requires it.

Important:
- if the learner uses a finite verb form, a past participle, or another correct inflected form, do NOT say that "at" is missing
- do NOT complain about missing "at" just because the stored target phrase begins with "at"

After Danish modal verbs such as "skal", "kan", "vil", "må", "bør", and "kunne", do NOT require "at" before the infinitive.

Only require "at" where Danish grammar truly requires it.

--------------------------------
4. RELATED IDEA ≠ SAME PHRASE
--------------------------------

If the learner expresses a similar meaning using a DIFFERENT construction,
do not treat that as a wrong attempt at the target phrase.

This also applies if the learner uses a related expression that is NOT among the accepted stored variants.

If the learner used a semantically related word or expression,
but not the target phrase itself, not an accepted stored variant, and not a natural inflected form of either,
mark it as "unused", not "wrong".

Suggestion must be empty for such cases.

--------------------------------
5. CONTEXT-DEPENDENT WORDS
--------------------------------

Some Danish words require a logical relation to the previous assistant message.
Examples: derimod, derfor, ellers, alligevel, nemlig, dog.

For such words:
- the learner sentence must create the required logical relation to the previous assistant message
- if that relation does not exist, usage is "wrong"

--------------------------------
6. SENTENCE-LEVEL ISSUES
--------------------------------

Use sentenceIssue only for grammar problems OUTSIDE the target phrase.

- sentenceIssue = "none" when there is no notable grammar problem outside the target phrase
- sentenceIssue = "minor" when the target phrase is correct, but there is some small grammar issue elsewhere
- sentenceIssue = "major" when the whole sentence is broadly broken, not understandable, or the non-target errors are severe enough that the sentence fails overall

Do NOT use sentenceComment to criticize the target phrase itself.

Missing commas should normally NOT count as a grammar issue.

If sentenceIssue is "minor" or "major", provide a short natural corrected version of the learner's full sentence in correctedSentence.
If sentenceIssue is "none", correctedSentence must be empty.

--------------------------------
7. SUGGESTIONS
--------------------------------

- if status is "correct", suggestion should usually be empty
- if status is "unused", suggestion must be empty
- if status is "almost" or "wrong", provide a short corrected suggestion only if genuinely helpful

NEVER give a suggestion that is identical to the learner's wording.
Do NOT claim that an accepted stored variant is wrong merely because it differs from the base phrase.

--------------------------------
8. DETECTED TEXT GROUNDING
--------------------------------

You MUST base your judgment on the exact detectedText.

Before deciding "unused", actively search the learner message for:
- the base phrase
- accepted stored variants
- natural inflected forms of both

If the learner used this target phrase several times, choose the clearest best matching occurrence as detectedText.

If detectedText is already correct, status must not be "almost" or "wrong" for that reason.

--------------------------------
9. OUTPUT
--------------------------------

Return ONLY valid JSON with exactly this structure:
{
  "phrase": "target phrase",
  "status": "correct | almost | wrong | unused",
  "comment": "short comment",
  "suggestion": "short corrected version or empty string",
  "detectedText": "exact matching text from learner message or empty string",
  "sentenceIssue": "none | minor | major",
  "sentenceComment": "short explanation of grammar issue outside the target phrase, or empty string",
  "correctedSentence": "full corrected learner sentence or empty string"
}`;
};

const defaultPhraseFeedback = (phrase: string): PhraseFeedbackItem => ({
  phrase,
  status: "unused",
  comment: "",
  suggestion: "",
  detectedText: "",
  sentenceIssue: "none",
  sentenceComment: "",
  correctedSentence: "",
});

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

    if (!Array.isArray(cards) || cards.length === 0) {
      return Response.json(
        { error: "No phrase cards provided" },
        { status: 400 }
      );
    }

    const typedCards: PhraseCard[] = cards
      .filter(
        (card: any) =>
          card &&
          typeof card.id === "string" &&
          typeof card.phrase === "string"
      )
      .map((card: any) => ({
        id: card.id,
        phrase: card.phrase,
      }));

    if (typedCards.length === 0) {
      return Response.json(
        { error: "Phrase cards are missing valid id/phrase values" },
        { status: 400 }
      );
    }

    const phraseIds = typedCards.map((card) => card.id);
    const phraseList: string[] = typedCards.map((card) => card.phrase);

    let phrasesWithVariants: PhraseWithVariants[] = typedCards.map((card) => ({
      id: card.id,
      phrase: card.phrase,
      matchingVariants: [],
    }));

    if (phraseIds.length > 0) {
      const { data: variantRows, error: variantError } = await supabase
        .from("phrase_usage_variants_main")
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
          matchingVariants: Array.from(
            new Set(variantsByPhraseId.get(card.id) || [])
          ),
        }));
      }
    }

    const conversationMessages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [
      {
        role: "system",
        content: `You are a friendly Danish conversation partner for a learner.

The learner should get natural chances to use these saved Danish phrases:
${phraseList.map((p) => `- ${p}`).join("\n")}

Your role:
You are the OTHER speaker in the conversation.

The learner talks about their own life and experiences.
You respond as another person in the conversation.

Never reply as if you are the learner.
Never describe the learner's situation as if it were your own.
Do not continue the learner's sentence for them.
Do not paraphrase the learner's answer as if it were your own statement.

Stay clearly in the role of the conversation partner.

Your job is to respond naturally to what the learner said and keep the conversation going.

Good replies usually:
- react briefly to what the learner said
- ask a natural follow-up question
- invite the learner to explain more
- stay on the same topic

Bad replies:
- speaking as if you are the learner
- inventing a new personal situation unrelated to the learner
- ignoring the learner's message
- writing a sentence that sounds like it belongs in the learner's mouth

Conversation rules:
1. Continue the conversation naturally in Danish.
2. Keep replies short and simple, usually 1-2 sentences.
3. Ask natural follow-up questions when appropriate.
4. Do NOT explicitly tell the learner to use the phrases.
5. Do NOT mention that this is a test or practice.
6. Avoid repeating the learner's sentence unless it sounds natural.
7. If the learner writes a long message, reply briefly and do not summarize it.
8. When starting a new conversation, prefer a concrete mini-scenario instead of a generic greeting.

Target phrase handling:
- NEVER use a target phrase yourself.
- Prefer to create situations where the learner might use the phrase.
- Do not help the learner by demonstrating the phrase.
- Even if a target phrase would sound natural here, do not use it.

Good examples of scenario openings:
- Du møder en ven på en café. Hvad taler I om?
- Du er på arbejde og taler med en kollega. Hvordan starter samtalen?
- Du står og venter på bussen. Hvad siger du til personen ved siden af?

Do not label the scenario explicitly. Just start naturally in Danish.`,
      },
    ];

    for (const msg of history as ChatMessage[]) {
      if (
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string"
      ) {
        conversationMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    if (userMessage && typeof userMessage === "string") {
      conversationMessages.push({
        role: "user",
        content: userMessage,
      });
    }

    const replyResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: conversationMessages,
      text: {
        format: {
          type: "text",
        },
      },
    });

    let reply =
      replyResponse.output_text?.trim() ||
      "Du møder en ven på en café. Hvordan går det?";

    const rewriteResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You are rewriting a Danish assistant reply.

Your goal:
- keep the reply natural, short, and helpful
- keep the same general scenario and conversational intent
- keep it to 1-2 sentences
- the assistant must remain clearly the OTHER speaker in the conversation
- the assistant must NOT speak as if it is the learner
- the assistant must NOT describe the learner's life as its own
- the assistant must NOT continue the learner's sentence as if it belonged in the learner's mouth
- prefer a brief reaction, a follow-up question, or a conversational response

Target phrase constraints:
- do NOT use any of the forbidden target phrases
- do NOT use grammatical forms of those phrases, including conjugations, tense changes, plural forms, derived forms, or close repeats
- do NOT use those phrases without leading "at" either

Style constraints:
- do NOT mention that you are avoiding anything
- do NOT become awkward or robotic
- keep the reply conversational and simple

Forbidden target phrases:
${phraseList.map((p) => `- ${p}`).join("\n")}

Return only the rewritten Danish reply as plain text.`,
        },
        {
          role: "user",
          content: reply,
        },
      ],
      text: {
        format: {
          type: "text",
        },
      },
    });

    const rewrittenReply = rewriteResponse.output_text?.trim();

    if (rewrittenReply) {
      reply = rewrittenReply;
    }

    if (
      assistantReplyUsesForbiddenPhrase(reply, phraseList) ||
      assistantReplySoundsLikeLearner(reply)
    ) {
      const secondRewriteResponse = await client.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `Rewrite this Danish reply again.

Rules:
- preserve meaning and tone
- keep it short and natural
- the assistant must clearly be the OTHER speaker
- do NOT speak as if you are the learner
- do NOT describe the learner's life as your own
- do NOT continue the learner's answer as if it were your own statement
- prefer a reaction or follow-up question
- do NOT use any forbidden target phrases
- do NOT use them without leading "at"
- paraphrase freely if needed
- return only the Danish reply

Forbidden target phrases:
${phraseList.map((p) => `- ${p}`).join("\n")}`,
          },
          {
            role: "user",
            content: reply,
          },
        ],
        text: {
          format: {
            type: "text",
          },
        },
      });

      const secondRewrittenReply = secondRewriteResponse.output_text?.trim();

      if (secondRewrittenReply) {
        reply = secondRewrittenReply;
      }
    }

    if (assistantBreaksRole(reply)) {
      const roleFixResponse = await client.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `You are fixing a Danish assistant reply.

The reply currently sounds like the assistant is speaking about its own experience.
This is wrong for this app.

Your task:
- rewrite the reply so that the assistant is clearly the OTHER speaker
- react to the learner's message instead
- do NOT introduce your own story
- do NOT invent your own past events
- keep it natural and conversational
- keep it short (1-2 sentences)
- prefer reacting + asking a question
- do NOT use any forbidden target phrases
- do NOT use them without leading "at"

Forbidden target phrases:
${phraseList.map((p) => `- ${p}`).join("\n")}

Bad example:
"Ja, vejret var meget bedre, end jeg havde forventet"

Good style:
"Det lyder virkelig dejligt. Hvad kunne du bedst lide ved det?"

Return ONLY the Danish reply.`,
          },
          {
            role: "user",
            content: reply,
          },
        ],
        text: {
          format: {
            type: "text",
          },
        },
      });

      const fixedRoleReply = roleFixResponse.output_text?.trim();

      if (fixedRoleReply) {
        reply = fixedRoleReply;
      }
    }

    let phraseFeedback: PhraseFeedbackItem[] = phraseList.map((phrase) =>
      defaultPhraseFeedback(phrase)
    );

    if (userMessage && userMessage.trim()) {
      const previousAssistantMessage =
        (history as ChatMessage[])
          .slice()
          .reverse()
          .find(
            (msg) =>
              msg &&
              msg.role === "assistant" &&
              typeof msg.content === "string"
          )?.content ?? "";

      const perPhraseResults = await Promise.all(
        phrasesWithVariants.map(async (phraseItem) => {
          const acceptedVariants = phraseItem.matchingVariants || [];

          const singlePhraseResponse = await client.responses.create({
            model: "gpt-4.1-mini",
            input: [
              {
                role: "system",
                content: buildSinglePhrasePrompt(
                  phraseItem.phrase,
                  acceptedVariants
                ),
              },
              {
                role: "user",
                content: `Previous assistant message:
${previousAssistantMessage || "(none)"}

Learner message:
${userMessage}`,
              },
            ],
            text: {
              format: {
                type: "json_schema",
                name: "single_phrase_feedback_response",
                schema: {
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
                    correctedSentence: { type: "string" },
                  },
                  required: [
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
          });

          const rawText = singlePhraseResponse.output_text ?? "";

          try {
            const parsed = JSON.parse(rawText);

            return {
              phrase: phraseItem.phrase,
              status: parsed.status as
                | "correct"
                | "almost"
                | "wrong"
                | "unused",
              comment: typeof parsed.comment === "string" ? parsed.comment : "",
              suggestion:
                typeof parsed.suggestion === "string" ? parsed.suggestion : "",
              detectedText:
                typeof parsed.detectedText === "string"
                  ? parsed.detectedText
                  : "",
              sentenceIssue:
                parsed.sentenceIssue === "minor" ||
                parsed.sentenceIssue === "major"
                  ? parsed.sentenceIssue
                  : "none",
              sentenceComment:
                typeof parsed.sentenceComment === "string"
                  ? parsed.sentenceComment
                  : "",
              correctedSentence:
                typeof parsed.correctedSentence === "string"
                  ? parsed.correctedSentence
                  : "",
            } satisfies PhraseFeedbackItem;
          } catch (err) {
            console.error(
              "Failed to parse single phrase feedback JSON:",
              phraseItem.phrase,
              rawText,
              err
            );

            return defaultPhraseFeedback(phraseItem.phrase);
          }
        })
      );

      phraseFeedback = perPhraseResults;

      const isFirstTurn =
        !previousAssistantMessage || !previousAssistantMessage.trim();

      try {
        await evaluateAndApplySpontaneousUsage({
          openai: client,
          supabase,
          userMessage,
          previousAssistantMessage,
          currentTargetPhrases: phraseList,
          isFirstTurn,
        });
      } catch (err) {
        console.error("Spontaneous tracking failed:", err);
      }
    }

    return Response.json({
      result: JSON.stringify({
        reply,
        phraseFeedback,
      }),
    });
  } catch (error: any) {
    console.error("PRACTICE CHAT ERROR:", error);

    return Response.json(
      {
        error: "Failed",
        message: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
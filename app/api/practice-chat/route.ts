import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { evaluateAndApplySpontaneousUsage } from "../../practice/spontaneous";
import { buildFeedbackSummary } from "../../practice/buildFeedbackSummary";
import { TABLES } from "../../../lib/tables";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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

type PhraseFeedbackItem = {
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

const MODEL = "gpt-4.1-mini";

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.,!?;:()"“”'‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripLeadingAt = (phrase: string) =>
  phrase.trim().replace(/^at\s+/i, "").trim();

const buildForbiddenPhraseList = (phrases: PhraseWithVariants[]) =>
  Array.from(
    new Set(
      phrases.flatMap((item) => [
        item.phrase,
        stripLeadingAt(item.phrase),
        ...item.matchingVariants,
        ...item.matchingVariants.map(stripLeadingAt),
      ])
    )
  ).filter(Boolean);

const assistantReplyUsesForbiddenPhrase = (
  reply: string,
  phraseList: string[]
) => {
  const normalizedReply = ` ${normalizeText(reply)} `;

  return phraseList.some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    const normalizedWithoutAt = normalizeText(stripLeadingAt(phrase));

    const exactMatch =
      (normalizedPhrase &&
        normalizedReply.includes(` ${normalizedPhrase} `)) ||
      (normalizedWithoutAt &&
        normalizedWithoutAt !== normalizedPhrase &&
        normalizedReply.includes(` ${normalizedWithoutAt} `));

    if (exactMatch) return true;

    const phraseTokens = normalizedWithoutAt.split(" ").filter(Boolean);
    if (phraseTokens.length < 2) return false;

    const [firstToken, ...restTokens] = phraseTokens;
    const rest = restTokens.join(" ");
    if (!firstToken || !rest) return false;

    const possibleFirstForms = [
      firstToken,
      `${firstToken}en`,
      `${firstToken}et`,
      `${firstToken}e`,
      `${firstToken}s`,
    ];

    return possibleFirstForms.some((form) =>
      normalizedReply.includes(` ${form} ${rest} `)
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

  return badMetaLearnerPatterns.some((pattern) => normalized.includes(pattern));
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
  ];

  return badNarrativePatterns.some((pattern) => normalized.includes(pattern));
};

const defaultPhraseFeedback = (
  phraseId: string,
  phrase: string
): PhraseFeedbackItem => ({
  phraseId,
  phrase,
  status: "unused",
  comment: "",
  suggestion: "",
  detectedText: "",
  sentenceIssue: "none",
  sentenceComment: "",
  correctedSentence: "",
});

const buildAssistantSystemPrompt = (phraseList: string[]) => `
You are a friendly Danish conversation partner for a learner.

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

Your job is to respond naturally to what the learner said and keep the conversation going.

Good replies usually:
- react briefly to what the learner said
- ask a natural follow-up question
- invite the learner to explain more
- stay on the same topic

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
- NEVER use grammatical forms, inflections, conjugations, noun forms, plural forms, or close variants of target phrases.
- Prefer to create situations where the learner might use the phrase.
- Do not help the learner by demonstrating the phrase.
- Even if a target phrase would sound natural here, do not use it.

Good examples of scenario openings:
- Du møder en ven på en café. Hvad taler I om?
- Du er på arbejde og taler med en kollega. Hvordan starter samtalen?
- Du står og venter på bussen. Hvad siger du til personen ved siden af?

Do not label the scenario explicitly. Just start naturally in Danish.
`;

const buildRewritePrompt = (phraseList: string[]) => `
You are rewriting a Danish assistant reply.

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
- do NOT use grammatical forms of those phrases, including conjugations, tense changes, noun forms, definite forms, plural forms, adjective forms, derived forms, or close repeats
- do NOT use those phrases without leading "at" either
- if unsure whether something is too close to a forbidden phrase, paraphrase it

Style constraints:
- do NOT mention that you are avoiding anything
- do NOT become awkward or robotic
- keep the reply conversational and simple

Forbidden target phrases and variants:
${phraseList.map((p) => `- ${p}`).join("\n")}

Return only the rewritten Danish reply as plain text.
`;

const buildSinglePhrasePrompt = ({
  phrase,
  translationEn,
  shortExplanation,
  acceptedVariants,
}: {
  phrase: string;
  translationEn: string;
  shortExplanation: string;
  acceptedVariants: string[];
}) => {
  const targetPhraseBlock = [
    `Base phrase: ${phrase}`,
    `Target meaning in English: ${translationEn || "(not provided)"}`,
    `Target explanation in Danish: ${shortExplanation || "(not provided)"}`,
    acceptedVariants.length > 0
      ? `Accepted stored variants:\n${acceptedVariants.map((v) => `- ${v}`).join("\n")}`
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
You are evaluating ONLY this one target phrase and ONLY this one target meaning.
The same Danish surface word may have several meanings.
You must judge whether the learner used THIS target phrase in THIS target meaning.

CRITICAL:
Do NOT infer usage from meaning alone.
There must be visible textual evidence in the learner message.

Very important distinction:
- If the learner clearly tried to use the target phrase but used the wrong meaning, mark "wrong".
- If the learner simply used the same surface word in some other clearly different meaning, and not as an attempt at this target meaning, mark "unused".

Example:
- target phrase = "knap" meaning "hardly/almost not"
- learner writes: "Jeg trykkede på en knap"
This is "unused", not "wrong".

--------------------------------
CORE PRINCIPLE
--------------------------------

This target phrase counts as used ONLY if the learner used:
- the base phrase
- an accepted stored variant
- a natural inflected form of either

If the learner expresses a similar meaning using different words, mark "unused".

Evaluate the TARGET PHRASE separately from the rest of the sentence.

--------------------------------
1. STATUS DEFINITIONS
--------------------------------

Use "correct" when ALL are true:
- the learner used the target phrase or a valid variant
- the phrase form is correct
- the meaning matches the target meaning
- the sentence is meaningful

Use "almost" ONLY when:
- the learner clearly attempted the phrase
- the meaning is understandable
- there is a small mistake inside the phrase

Use "wrong" ONLY when:
- the learner clearly attempted THIS phrase
AND:
- the phrase form is incorrect OR
- the meaning is wrong OR
- the usage is impossible/ungrammatical

Use "unused" when:
- the phrase is not present
- a different construction was used
- the same word is used with another meaning
- you are unsure whether the learner attempted this phrase

CRITICAL:
If unsure between "wrong" and "unused", choose "unused".

--------------------------------
2. INFLECTION
--------------------------------

Accept natural Danish inflections.

Do NOT require base form.
Do NOT require "at".

Only comment if the learner form is actually incorrect.

--------------------------------
3. RELATED IDEA ≠ SAME PHRASE
--------------------------------

If the learner expresses the meaning using different wording:
→ mark "unused"

Suggestion must be empty.

--------------------------------
4. CONTEXT-DEPENDENT WORDS
--------------------------------

Words like: derimod, derfor, ellers, alligevel, nemlig, dog

If used:
- check logical relation to previous message
- if missing → "wrong"

If not used → "unused"

--------------------------------
5. DETECTED TEXT GROUNDING
--------------------------------

detectedText must be exact text from the learner message.

If no phrase usage:
- detectedText must be empty
- status must be "unused"

Never invent or approximate detectedText.

--------------------------------
6. SENTENCE-LEVEL ISSUES
--------------------------------

sentenceIssue applies ONLY to errors outside the phrase.

Ignore punctuation and capitalization.

--------------------------------
7. SUGGESTIONS
--------------------------------

- "correct" → empty
- "unused" → empty
- "almost"/"wrong" → short correction only if useful

Never repeat the learner's sentence as suggestion.

--------------------------------
OUTPUT
--------------------------------

Return ONLY valid JSON:
{
  "phrase": "target phrase",
  "status": "correct | almost | wrong | unused",
  "comment": "short comment",
  "suggestion": "short corrected version or empty string",
  "detectedText": "exact matching text or empty string",
  "sentenceIssue": "none | minor | major",
  "sentenceComment": "short explanation or empty",
  "correctedSentence": "corrected full sentence or empty"
}`;
};

const parseCards = (cards: unknown): IncomingPhraseCard[] => {
  if (!Array.isArray(cards)) return [];

  return cards
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
};

const buildConversationMessages = ({
  phraseList,
  history,
  userMessage,
}: {
  phraseList: string[];
  history: ChatMessage[];
  userMessage: string;
}) => {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
      content: buildAssistantSystemPrompt(phraseList),
    },
  ];

  for (const msg of history) {
    if (
      msg &&
      (msg.role === "user" || msg.role === "assistant") &&
      typeof msg.content === "string"
    ) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  if (userMessage.trim()) {
    messages.push({
      role: "user",
      content: userMessage,
    });
  }

  return messages;
};

const loadPhraseVariants = async ({
  supabase,
  cards,
}: {
  supabase: any;
  cards: IncomingPhraseCard[];
}): Promise<PhraseWithVariants[]> => {
  const phraseIds = cards.map((card) => card.id);

  const basePhrases = cards.map((card) => ({
    id: card.id,
    phrase: card.phrase,
    translation_en: card.translation_en ?? "",
    short_explanation: card.short_explanation ?? "",
    matchingVariants: [],
  }));

  if (phraseIds.length === 0) return basePhrases;

  const { data: variantRows, error: variantError } = await supabase
    .from(TABLES.variants)
    .select("phrase_id, variant_da, usable_for_matching")
    .in("phrase_id", phraseIds)
    .eq("usable_for_matching", true);

  if (variantError) {
    console.error("Failed to load phrase variants:", variantError);
    return basePhrases;
  }

  const variantsByPhraseId = new Map<string, string[]>();

  for (const row of (variantRows || []) as VariantRow[]) {
    const variant = row.variant_da?.trim();
    if (!variant) continue;

    const existing = variantsByPhraseId.get(row.phrase_id) || [];
    existing.push(variant);
    variantsByPhraseId.set(row.phrase_id, existing);
  }

  return cards.map((card) => ({
    id: card.id,
    phrase: card.phrase,
    translation_en: card.translation_en ?? "",
    short_explanation: card.short_explanation ?? "",
    matchingVariants: Array.from(new Set(variantsByPhraseId.get(card.id) || [])),
  }));
};

const generateAssistantReply = async ({
  openai,
  phraseList,
  history,
  userMessage,
}: {
  openai: OpenAI;
  phraseList: string[];
  history: ChatMessage[];
  userMessage: string;
}) => {
  const replyResponse = await openai.responses.create({
    model: MODEL,
    input: buildConversationMessages({ phraseList, history, userMessage }),
    text: {
      format: {
        type: "text",
      },
    },
  });

  return (
    replyResponse.output_text?.trim() ||
    "Du møder en ven på en café. Hvordan går det?"
  );
};

const rewriteAssistantReply = async ({
  openai,
  reply,
  phraseList,
}: {
  openai: OpenAI;
  reply: string;
  phraseList: string[];
}) => {
  const rewriteResponse = await openai.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content: buildRewritePrompt(phraseList),
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

  return rewriteResponse.output_text?.trim() || reply;
};

const needsAssistantRewrite = (reply: string, phraseList: string[]) =>
  assistantReplyUsesForbiddenPhrase(reply, phraseList) ||
  assistantReplySoundsLikeLearner(reply) ||
  assistantBreaksRole(reply);

const generateSafeAssistantReply = async ({
  openai,
  phraseList,
  history,
  userMessage,
}: {
  openai: OpenAI;
  phraseList: string[];
  history: ChatMessage[];
  userMessage: string;
}) => {
  let reply = await generateAssistantReply({
    openai,
    phraseList,
    history,
    userMessage,
  });

  // Always rewrite once. This is safer because the assistant must not leak target phrases.
  reply = await rewriteAssistantReply({
    openai,
    reply,
    phraseList,
  });

  if (needsAssistantRewrite(reply, phraseList)) {
    reply = await rewriteAssistantReply({
      openai,
      reply,
      phraseList,
    });
  }

  if (needsAssistantRewrite(reply, phraseList)) {
    console.warn(
      "[practice-chat] assistant reply may still violate constraints:",
      reply
    );
  }

  return reply;
};

const evaluateTargetPhrases = async ({
  openai,
  phrasesWithVariants,
  userMessage,
  previousAssistantMessage,
}: {
  openai: OpenAI;
  phrasesWithVariants: PhraseWithVariants[];
  userMessage: string;
  previousAssistantMessage: string;
}): Promise<PhraseFeedbackItem[]> => {
  if (!userMessage.trim()) {
    return phrasesWithVariants.map((item) =>
      defaultPhraseFeedback(item.id, item.phrase)
    );
  }

  return Promise.all(
    phrasesWithVariants.map(async (phraseItem) => {
      const singlePhraseResponse = await openai.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content: buildSinglePhrasePrompt({
              phrase: phraseItem.phrase,
              translationEn: phraseItem.translation_en,
              shortExplanation: phraseItem.short_explanation,
              acceptedVariants: phraseItem.matchingVariants || [],
            }),
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
          phraseId: phraseItem.id,
          phrase: phraseItem.phrase,
          status: ["correct", "almost", "wrong", "unused"].includes(
            parsed.status
          )
            ? parsed.status
            : "unused",
          comment: typeof parsed.comment === "string" ? parsed.comment : "",
          suggestion:
            typeof parsed.suggestion === "string" ? parsed.suggestion : "",
          detectedText:
            typeof parsed.detectedText === "string" ? parsed.detectedText : "",
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

        return defaultPhraseFeedback(phraseItem.id, phraseItem.phrase);
      }
    })
  );
};

export async function POST(req: Request) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await req.json();

    const typedCards = parseCards(body.cards || []);
    const history: ChatMessage[] = Array.isArray(body.history)
      ? body.history
      : [];
    const userMessage =
      typeof body.userMessage === "string" ? body.userMessage : "";

    if (typedCards.length === 0) {
      return Response.json(
        { error: "Phrase cards are missing valid id/phrase values" },
        { status: 400 }
      );
    }

    const phrasesWithVariants = await loadPhraseVariants({
      supabase,
      cards: typedCards,
    });

    const forbiddenPhraseList = buildForbiddenPhraseList(phrasesWithVariants);

    const previousAssistantMessage =
      history
        .slice()
        .reverse()
        .find(
          (msg) =>
            msg &&
            msg.role === "assistant" &&
            typeof msg.content === "string"
        )?.content ?? "";

    const reply = await generateSafeAssistantReply({
      openai,
      phraseList: forbiddenPhraseList,
      history,
      userMessage,
    });

    const phraseFeedback = await evaluateTargetPhrases({
      openai,
      phrasesWithVariants,
      userMessage,
      previousAssistantMessage,
    });

    const feedbackSummary = await buildFeedbackSummary({
      openai,
      userMessage,
      phraseFeedback,
    });

    if (userMessage.trim()) {
      const isFirstTurn =
        !previousAssistantMessage || !previousAssistantMessage.trim();

      try {
        await evaluateAndApplySpontaneousUsage({
          openai,
          supabase,
          userMessage,
          previousAssistantMessage,
          currentTargetPhrases: phrasesWithVariants.map((item) => ({
            id: item.id,
            phrase: item.phrase,
            translation_en: item.translation_en,
            short_explanation: item.short_explanation,
          })),
          isFirstTurn,
        });
      } catch (err) {
        console.error("Spontaneous tracking failed:", err);
      }
    }

    const payload = {
      reply,
      phraseFeedback,
      feedbackSummary,
    };

    return Response.json({
      ...payload,
      result: JSON.stringify(payload),
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
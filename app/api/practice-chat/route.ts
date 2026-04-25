import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { evaluateAndApplySpontaneousUsage } from "../../practice/spontaneous";

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
  ];

  return badNarrativePatterns.some((pattern) =>
    normalized.includes(pattern)
  );
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
- do NOT use grammatical forms of those phrases, including conjugations, tense changes, plural forms, derived forms, or close repeats
- do NOT use those phrases without leading "at" either

Style constraints:
- do NOT mention that you are avoiding anything
- do NOT become awkward or robotic
- keep the reply conversational and simple

Forbidden target phrases:
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
You are evaluating ONLY this one target phrase and ONLY this one target meaning.
The same Danish surface word may have several meanings.
You must judge whether the learner used THIS target phrase in THIS target meaning.

Very important distinction:
- If the learner clearly tried to use the target phrase but used the wrong meaning, mark "wrong".
- If the learner simply used the same surface word in some other clearly different meaning, and not as an attempt at this target meaning, mark "unused".

Example:
- target phrase = "knap" meaning "hardly/almost not"
- learner writes: "Jeg trykkede på en knap"
This is normally "unused", not "wrong", because the learner used "knap" as "button", which is a different lexical meaning, not a failed attempt at the target meaning.

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
- the target phrase is used with the correct target meaning and function
- the full learner sentence is semantically meaningful and plausible in Danish
- if the phrase depends on discourse context, that context is satisfied

Use "almost" when:
- the learner clearly attempted the target phrase
- the intended target meaning is understandable
- there is a small mistake INSIDE the target phrase
- but the phrase is still close to correct

Use "wrong" when:
- the learner clearly attempted the target phrase
- but the target phrase itself is incorrect
OR
- the phrase meaning or function is wrong in context
OR
- the learner clearly tried to use the target phrase, but used it with the wrong meaning
OR
- the phrase is used with impossible or unnatural arguments
OR
- the sentence is not meaningful enough to accept the phrase
OR
- a required contextual relation is missing

Use "unused" when:
- the learner did not actually use the target phrase, accepted stored variants, or natural inflected forms of them
OR
- the learner used a different construction with a related meaning
OR
- the learner used the same surface word, but clearly with a different dictionary meaning and not as an attempt at this target meaning

CRITICAL:
If there is real doubt between "wrong" and "unused" because the learner used the same spelling with another meaning, prefer "unused" unless it is clearly an attempt at the target meaning.

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

Also:
If the learner used the same spelling as the target phrase, but clearly with another meaning that is not the target meaning, this is normally "unused", not "wrong", unless the sentence clearly shows an attempt at the target meaning.

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

IMPORTANT! Punctuation and capitalization:
- Do not be picky about punctuation.
- Ignore missing commas, extra commas, missing periods, and normal chat-style punctuation differences.
- Ignore capitalization issues unless they materially affect meaning.
- These issues should not make the target phrase count as wrong or almost.
- Minor punctuation or capitalization issues should normally not trigger sentenceIssue.
- Only care about punctuation if it creates real ambiguity or clearly changes the meaning.

--------------------------------
7. SUGGESTIONS
--------------------------------

- if status is "correct", suggestion should usually be empty
- if status is "unused", suggestion must be empty
- if status is "almost" or "wrong", provide a short corrected suggestion only if genuinely helpful

NEVER give a suggestion that is identical to the learner's wording.
Do NOT claim that an accepted stored variant is wrong merely because it differs from the base phrase.

If the learner used the same surface word with another meaning and the case should be "unused", suggestion must be empty.

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

If detectedText shows the same spelling but a different meaning, then:
- mark "wrong" only if it clearly represents an attempted use of the target meaning
- otherwise mark "unused"

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
    .from("phrase_usage_variants_main")
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

  if (needsAssistantRewrite(reply, phraseList)) {
    reply = await rewriteAssistantReply({
      openai,
      reply,
      phraseList,
    });
  }

  if (needsAssistantRewrite(reply, phraseList)) {
    reply = await rewriteAssistantReply({
      openai,
      reply,
      phraseList,
    });
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

    const phraseList = typedCards.map((card) => card.phrase);

    const phrasesWithVariants = await loadPhraseVariants({
      supabase,
      cards: typedCards,
    });

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
      phraseList,
      history,
      userMessage,
    });

    const phraseFeedback = await evaluateTargetPhrases({
      openai,
      phrasesWithVariants,
      userMessage,
      previousAssistantMessage,
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
    };

    return Response.json({
      ...payload,

      // Kept temporarily for compatibility with your current frontend.
      // Later we can remove this and use reply/phraseFeedback directly.
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
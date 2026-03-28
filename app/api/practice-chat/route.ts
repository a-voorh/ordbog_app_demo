import OpenAI from "openai";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

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

    const phraseList: string[] = cards.map((card: any) => card.phrase);

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

    // Always rewrite the assistant reply to remove target phrases and their forms.
    // This is more reliable than trying to detect all conjugated/inflected variants.
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
- do NOT use any of the forbidden target phrases
- do NOT use grammatical forms of those phrases, including conjugations, tense changes, plural forms, derived forms, or close repeats
- do NOT use those phrases without leading "at" either
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

    // Safety fallback: if exact forms still slipped through, try one more rewrite.
    if (assistantReplyUsesForbiddenPhrase(reply, phraseList)) {
      const secondRewriteResponse = await client.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `Rewrite this Danish reply again.

Rules:
- preserve meaning and tone
- keep it short and natural
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

    let phraseFeedback: Array<{
      phrase: string;
      status: "correct" | "almost" | "wrong" | "unused";
      comment: string;
      suggestion: string;
      detectedText: string;
      sentenceIssue: "none" | "minor" | "major";
      sentenceComment: string;
    }> = phraseList.map((phrase) => ({
      phrase,
      status: "unused",
      comment: "",
      suggestion: "",
      detectedText: "",
      sentenceIssue: "none",
      sentenceComment: "",
    }));

    if (userMessage && userMessage.trim()) {
      const previousAssistantMessage =
        [...(history as ChatMessage[])]
          .reverse()
          .find(
            (msg) =>
              msg &&
              msg.role === "assistant" &&
              typeof msg.content === "string"
          )?.content ?? "";

      const detectionResponse = await client.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `You evaluate whether a learner used target Danish phrases correctly in their latest message.

Target phrases:
${phraseList.map((p) => `- ${p}`).join("\n")}

You must inspect:
1. the learner message
2. the previous assistant message, if provided, for context

Do NOT consider earlier conversation history beyond the previous assistant message.

--------------------------------
CORE PRINCIPLE
--------------------------------

Evaluate the TARGET PHRASE separately from the rest of the sentence.

- A target phrase can still be "correct" if it is used correctly and the sentence is meaningful, even if there is a small grammar issue elsewhere.
- In such a case:
  - keep status = "correct"
  - use sentenceIssue = "minor"
  - explain the outside issue in sentenceComment

--------------------------------
1. STATUS DEFINITIONS
--------------------------------

Use "correct" when ALL are true:
- the learner used the target phrase or a natural inflected/grammatical variant of it
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
- the learner did not actually use the phrase

--------------------------------
2. INFLECTION (VERY IMPORTANT)
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

--------------------------------
3. RULES ABOUT "AT"
--------------------------------

Do NOT require the infinitive marker "at" unless the learner's grammar truly requires it.

Important:
- if the learner uses a finite verb form, a past participle, or another correct inflected form, do NOT say that "at" is missing
- do NOT complain about missing "at" just because the stored target phrase begins with "at"

Examples:
- "jeg har spildt tid" is correct and does not need "at"
- "jeg skal håndtere det" is correct and does not need "at"
- "jeg kan forstå det" is correct and does not need "at"

Also:
After Danish modal verbs such as "skal", "kan", "vil", "må", "bør", and "kunne", do NOT require "at" before the infinitive.

Examples:
- "jeg skal håndtere det" is correct
- "jeg kan forstå det" is correct
- "jeg vil lære det" is correct

Only require "at" where Danish grammar truly requires it.

--------------------------------
4. COMMON EXPRESSIONS
--------------------------------

Accept natural Danish expressions.

For common verb+noun expressions, do NOT require an article, possessive, or determiner unless truly necessary.

Examples:
- "spilde tid" is correct
- "jeg har spildt tid" is correct
- "sænke energiforbrug" is acceptable
- "sænke energiforbruget" is also acceptable

Do not invent missing determiners or pronouns when the learner wording is already natural Danish.

--------------------------------
4B. RELATED IDEA ≠ SAME PHRASE
--------------------------------

If the learner expresses a similar meaning using a DIFFERENT construction,
do not treat that as a wrong attempt at the target phrase.

Examples:
- target phrase: "at spilde"
  learner writes: "spild af tid"
  -> this is NOT a wrong use of "at spilde"
  -> mark it as "unused"

- target phrase: "at tage fat på"
  learner writes a nearby noun-based expression instead
  -> if the stored phrase itself was not actually used, mark "unused"

Rule:
- if the learner used a semantically related word or expression,
  but not the target phrase itself nor a natural inflected form of it,
  mark it as "unused", not "wrong"

Tone:
- do not scold
- do not suggest the target phrase as if the learner made an error
- optional neutral comment:
  "A related expression was used, but not this phrase."

Suggestion must be empty for such cases.

--------------------------------
5. CONTEXT-DEPENDENT WORDS
--------------------------------

Some Danish words require a logical relation to the previous assistant message.
Examples: derimod, derfor, ellers, alligevel, nemlig, dog.

For such words:
- the learner sentence must create the required logical relation to the previous assistant message
- if that relation does not exist, usage is "wrong"

Example:
- "Derimod drikker jeg en kaffe"
  → wrong, if no contrast with previous context exists

--------------------------------
6. SENTENCE-LEVEL ISSUES
--------------------------------

Use sentenceIssue only for grammar problems OUTSIDE the target phrase.

- sentenceIssue = "none" when there is no notable grammar problem outside the target phrase
- sentenceIssue = "minor" when the target phrase is correct, but there is some small grammar issue elsewhere
- sentenceIssue = "major" when the whole sentence is broadly broken, not understandable, or the non-target errors are severe enough that the sentence fails overall

Do NOT use sentenceComment to criticize the target phrase itself.

Very important:
- Missing commas should normally NOT count as a grammar issue.
- Minor punctuation issues should usually be ignored.
- Do NOT punish the learner for forgetting commas.
- Only mention punctuation if it seriously changes meaning or makes the sentence hard to understand.

--------------------------------
7. UNUSED PHRASES (IMPORTANT TONE)
--------------------------------

If status is "unused":
- do NOT scold
- do NOT say the learner failed
- do NOT imply there was a grammatical mistake
- keep comment empty, or use a very short neutral note only if helpful

This includes cases where:
- the learner used a related word
- the learner used a related expression
- the learner expressed the same general idea differently
- but the stored target phrase itself was not actually used

Optional neutral comment:
- "A related expression was used, but not this phrase."

Suggestion must be empty for "unused".

--------------------------------
8. SUGGESTIONS
--------------------------------

Keep comments short, practical, and learner-friendly.

Rules:
- if status is "correct", suggestion should usually be empty
- if status is "unused", suggestion must be empty
- if status is "almost" or "wrong", provide a short corrected suggestion only if genuinely helpful

Very important:
- NEVER give a suggestion that is identical to the learner's wording
- compare your suggestion against the learner message first
- if the suggestion is effectively the same as what the learner already wrote, leave suggestion empty
- do NOT claim something is wrong and then repeat the same wording as the correction
- do NOT claim that the learner should change the phrase to a form that is already present in the learner message
- do NOT claim that a correct inflected form is wrong just because it differs from the base form

--------------------------------
9. DO NOT OVER-CORRECT
--------------------------------

Only evaluate the TARGET PHRASE.

Do NOT:
- rewrite the whole sentence
- suggest stylistic improvements
- enforce optional grammatical choices
- require definiteness unless strictly necessary
- require additional words like "med" unless they are grammatically required
- punish missing commas or harmless punctuation

Examples:
- "sænke energiforbrug" is acceptable
- "sænke energiforbruget" is also acceptable
- do NOT force one if the other is already natural
- do NOT force "med" or quantities unless truly required

Only correct actual grammatical or semantic errors, not style, commas, or completeness.

--------------------------------
10. DETECTED TEXT GROUNDING (CRITICAL)
--------------------------------

You MUST base your judgment on the exact detectedText.

Before correcting:
- check detectedText carefully

Rules:
- If detectedText is already correct, status must not be "almost" or "wrong" for that reason
- NEVER suggest something identical to detectedText
- NEVER claim a mistake if the correct form is already present
- DO NOT imagine another version of the phrase
- DO NOT normalize away from the learner's actual wording
- DO NOT confuse a nearby base form with the actual learner form

If your suggested correction equals detectedText, leave suggestion empty.

--------------------------------
11. STRICTNESS
--------------------------------

Be careful, but do not be over-strict.

Follow these priorities:
- prefer meaning over tiny stylistic preferences
- do NOT mark a phrase wrong because of small punctuation or style choices if the phrase itself is acceptable
- do NOT over-correct comma placement
- missing commas should normally be ignored
- only use "wrong" when the phrase really fails in grammar, meaning, or context
- prefer "wrong" over "correct" only when the learner sentence is not clearly meaningful
- prefer "wrong" over "almost" when the phrase is placed into a sentence that does not make semantic sense
- if the learner uses a related noun or different construction instead of the target phrase, prefer "unused" over "almost" or "wrong"
Example of clearly wrong meaning:
- "Jeg aftog ham"
  → wrong, because the verb "aftage" cannot normally take a person as its object

--------------------------------
12. OUTPUT
--------------------------------

For detectedText:
- include the exact part of the learner message that best matches the phrase
- if unused, return empty string

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
${userMessage}`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "phrase_feedback_response",
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

      const detectionText = detectionResponse.output_text ?? "";

      try {
        const parsedDetection = JSON.parse(detectionText);
        if (Array.isArray(parsedDetection.phraseFeedback)) {
          phraseFeedback = parsedDetection.phraseFeedback;
        }
      } catch (err) {
        console.error("Failed to parse phrase feedback JSON:", detectionText, err);
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
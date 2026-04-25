import OpenAI from "openai";

export type PhraseFeedbackItem = {
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

export type FeedbackTargetIssue = {
  phraseId: string;
  phrase: string;
  status: "correct" | "almost" | "wrong";
  issue: string;
  suggestion: string;
};

export type FeedbackSentenceIssue = {
  issue: string;
  suggestion: string;
};

export type FeedbackSummary = {
  targetIssues: FeedbackTargetIssue[];
  sentenceIssues: FeedbackSentenceIssue[];
  correctedUserMessage: string;
};

const MODEL = "gpt-4.1-mini";

const defaultFeedbackSummary = (userMessage = ""): FeedbackSummary => ({
  targetIssues: [],
  sentenceIssues: [],
  correctedUserMessage: userMessage,
});

export const buildFeedbackSummary = async ({
  openai,
  userMessage,
  phraseFeedback,
}: {
  openai: OpenAI;
  userMessage: string;
  phraseFeedback: PhraseFeedbackItem[];
}): Promise<FeedbackSummary> => {
  const trimmedMessage = userMessage.trim();

  if (!trimmedMessage) {
    return defaultFeedbackSummary("");
  }

  const relevantFeedback = phraseFeedback.filter(
    (item) =>
      item.status === "correct" ||
      item.status === "almost" ||
      item.status === "wrong" ||
      item.sentenceIssue === "minor" ||
      item.sentenceIssue === "major"
  );

  if (relevantFeedback.length === 0) {
    return defaultFeedbackSummary(trimmedMessage);
  }

  const response = await openai.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content: `You compile feedback for a Danish learner.

You receive:
1. the learner's original message
2. phrase-by-phrase evaluation results

Your job:
- create a clean list of target phrase feedback
- create a clean list of grammar/wording issues outside the target phrases
- provide ONE corrected version of the learner's full message

Rules:
- Do not add new ideas.
- Keep the learner's meaning and tone.
- Do not make the corrected message much more advanced than the original.
- Do not list unused phrases as mistakes.
- Include correct target phrases only if they were actually used.
- Include almost/wrong target phrases as improvements.
- Merge duplicate outside-sentence issues.
- correctedUserMessage must fix both target phrase issues and outside-sentence issues.
- If the original message is already good, correctedUserMessage can equal the original.
- Write issue and suggestion text in English.
- correctedUserMessage must be in Danish.
- Return ONLY valid JSON.`,
      },
      {
        role: "user",
        content: `Learner message:
${trimmedMessage}

Phrase feedback:
${JSON.stringify(relevantFeedback, null, 2)}

Return JSON with exactly this structure:
{
  "targetIssues": [
    {
      "phraseId": "...",
      "phrase": "...",
      "status": "correct | almost | wrong",
      "issue": "...",
      "suggestion": "..."
    }
  ],
  "sentenceIssues": [
    {
      "issue": "...",
      "suggestion": "..."
    }
  ],
  "correctedUserMessage": "..."
}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "feedback_summary_response",
        schema: {
          type: "object",
          properties: {
            targetIssues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  phraseId: { type: "string" },
                  phrase: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["correct", "almost", "wrong"],
                  },
                  issue: { type: "string" },
                  suggestion: { type: "string" },
                },
                required: [
                  "phraseId",
                  "phrase",
                  "status",
                  "issue",
                  "suggestion",
                ],
                additionalProperties: false,
              },
            },
            sentenceIssues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  suggestion: { type: "string" },
                },
                required: ["issue", "suggestion"],
                additionalProperties: false,
              },
            },
            correctedUserMessage: { type: "string" },
          },
          required: [
            "targetIssues",
            "sentenceIssues",
            "correctedUserMessage",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const rawText = response.output_text ?? "";

  try {
    const parsed = JSON.parse(rawText);

    return {
      targetIssues: Array.isArray(parsed.targetIssues)
        ? parsed.targetIssues
        : [],
      sentenceIssues: Array.isArray(parsed.sentenceIssues)
        ? parsed.sentenceIssues
        : [],
      correctedUserMessage:
        typeof parsed.correctedUserMessage === "string"
          ? parsed.correctedUserMessage
          : trimmedMessage,
    };
  } catch (err) {
    console.error("Failed to parse feedback summary JSON:", rawText, err);
    return defaultFeedbackSummary(trimmedMessage);
  }
};
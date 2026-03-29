import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

type SpontaneousStatus = "correct" | "almost" | "wrong" | "unused";

type PhraseRow = {
  id: string;
  phrase: string;
  times_spontaneous_correct: number | null;
  times_spontaneous_almost: number | null;
  times_spontaneous_wrong: number | null;
};

type SpontaneousMatch = {
  phrase: string;
  status: SpontaneousStatus;
  detectedText: string;
  isSpontaneous: boolean;
  confidence: number;
};

type SpontaneousResponse = {
  spontaneousMatches: SpontaneousMatch[];
};

type EvaluateAndApplySpontaneousUsageArgs = {
  openai: OpenAI;
  supabase: SupabaseClient;
  userMessage: string;
  previousAssistantMessage: string;
  currentTargetPhrases: string[];
  isFirstTurn?: boolean;
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

const tokenize = (text: string) =>
  normalizeText(text).split(" ").filter(Boolean);

const overlapScore = (message: string, phrase: string) => {
  const messageTokens = new Set(tokenize(message));
  const phraseTokens = tokenize(stripLeadingAt(phrase));

  return phraseTokens.filter((token) => messageTokens.has(token)).length;
};

const getAllNonTargetRows = (
  allRows: PhraseRow[],
  currentTargetPhrases: string[]
) => {
  const currentTargets = new Set(
    currentTargetPhrases.map((phrase) => normalizeText(phrase))
  );

  return allRows
    .filter((row) => !currentTargets.has(normalizeText(row.phrase)))
    .slice(0, 80); // wide scan for first turn
};

const buildCandidatePool = (
  allRows: PhraseRow[],
  userMessage: string,
  currentTargetPhrases: string[]
) => {
  const currentTargets = new Set(
    currentTargetPhrases.map((phrase) => normalizeText(phrase))
  );

  return allRows
    .filter((row) => !currentTargets.has(normalizeText(row.phrase)))
    .map((row) => ({
      ...row,
      candidateScore: overlapScore(userMessage, row.phrase),
    }))
    .sort((a, b) => b.candidateScore - a.candidateScore)
    .slice(0, 40); // wider but still controlled
};

const parseSpontaneousResponse = (
  rawText: string
): SpontaneousResponse | null => {
  try {
    const parsed = JSON.parse(rawText);

    if (!parsed || !Array.isArray(parsed.spontaneousMatches)) {
      return null;
    }

    return {
      spontaneousMatches: parsed.spontaneousMatches,
    };
  } catch (err) {
    console.error("Failed to parse spontaneous response JSON:", rawText, err);
    return null;
  }
};

export async function evaluateAndApplySpontaneousUsage({
  openai,
  supabase,
  userMessage,
  previousAssistantMessage,
  currentTargetPhrases,
  isFirstTurn = false,
}: EvaluateAndApplySpontaneousUsageArgs): Promise<SpontaneousMatch[]> {
  const trimmedMessage = userMessage.trim();
  if (!trimmedMessage) return [];

  const { data, error } = await supabase
    .from("phrases")
    .select(
      "id, phrase, times_spontaneous_correct, times_spontaneous_almost, times_spontaneous_wrong"
    );

  if (error) {
    console.error(
      "Failed to load phrases for spontaneous evaluation:",
      error
    );
    return [];
  }

  const allRows = (data || []) as PhraseRow[];

  const candidatePool = isFirstTurn
    ? getAllNonTargetRows(allRows, currentTargetPhrases)
    : buildCandidatePool(allRows, trimmedMessage, currentTargetPhrases);

  if (candidatePool.length === 0) {
    return [];
  }

  const candidatePhraseList = candidatePool.map((row) => row.phrase);

  const evaluationResponse = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You silently evaluate whether a learner used saved Danish phrases spontaneously in their latest message.

Current target phrases:
${currentTargetPhrases.map((p) => `- ${p}`).join("\n") || "(none)"}

Candidate non-target saved phrases:
${candidatePhraseList.map((p) => `- ${p}`).join("\n")}

Rules:
- detect real usage only (not similar ideas)
- accept inflections
- ignore target phrases
- decide if usage is truly spontaneous

Return ONLY JSON.`,
      },
      {
        role: "user",
        content: `Previous assistant message:
${previousAssistantMessage || "(none)"}

Learner message:
${trimmedMessage}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "spontaneous_phrase_response",
        schema: {
          type: "object",
          properties: {
            spontaneousMatches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  phrase: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["correct", "almost", "wrong", "unused"],
                  },
                  detectedText: { type: "string" },
                  isSpontaneous: { type: "boolean" },
                  confidence: { type: "number" },
                },
                required: [
                  "phrase",
                  "status",
                  "detectedText",
                  "isSpontaneous",
                  "confidence",
                ],
                additionalProperties: false,
              },
            },
          },
          required: ["spontaneousMatches"],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = parseSpontaneousResponse(
    evaluationResponse.output_text ?? ""
  );
  if (!parsed) return [];

  const candidateMap = new Map(
    candidatePool.map((row) => [normalizeText(row.phrase), row])
  );

  const nowIso = new Date().toISOString();

  for (const match of parsed.spontaneousMatches) {
    if (!match.isSpontaneous) continue;
    if (match.confidence < 0.75) continue;
    if (match.status === "unused") continue;

    const row = candidateMap.get(normalizeText(match.phrase));
    if (!row) continue;

    const nextCorrect =
      (row.times_spontaneous_correct ?? 0) +
      (match.status === "correct" ? 1 : 0);

    const nextAlmost =
      (row.times_spontaneous_almost ?? 0) +
      (match.status === "almost" ? 1 : 0);

    const nextWrong =
      (row.times_spontaneous_wrong ?? 0) +
      (match.status === "wrong" ? 1 : 0);

    const { error: updateError } = await supabase
      .from("phrases")
      .update({
        times_spontaneous_correct: nextCorrect,
        times_spontaneous_almost: nextAlmost,
        times_spontaneous_wrong: nextWrong,
        last_spontaneous_used_at: nowIso,
      })
      .eq("id", row.id);

    if (updateError) {
      console.error(
        "Failed to update spontaneous phrase stats:",
        updateError
      );
    }
  }

  return parsed.spontaneousMatches;
}
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

type SpontaneousStatus = "correct" | "almost" | "wrong" | "unused";

type PhraseRow = {
  id: string;
  phrase: string;
  created_at: string | null;
  times_attempted: number | null;
  times_correct: number | null;
  times_almost: number | null;
  last_practiced_at: string | null;
  last_spontaneous_used_at: string | null;
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

const RECENT_SPONTANEOUS_DAYS = 2;
const RECENT_PRACTICE_DAYS = 1;
const RECENT_UNTRAINED_DAYS = 9;
const UNLIMITED_POOL_THRESHOLD = 500;
const LARGE_DB_FIRST_TURN_CAP = 120;
const LARGE_DB_LATER_TURN_CAP = 60;
const SPONTANEOUS_MASTERY_BONUS_MIN_ATTEMPTS = 1;
const SPONTANEOUS_MASTERY_BONUS_MAX_ATTEMPTS = 3;

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

const daysSinceIso = (iso: string | null) => {
  if (!iso) return null;

  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return null;

  return (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
};

const isRecentWithinDays = (iso: string | null, days: number) => {
  const diff = daysSinceIso(iso);
  return diff !== null && diff <= days;
};

const getFilteredNonTargetRows = (
  allRows: PhraseRow[],
  currentTargetPhrases: string[]
) => {
  const currentTargets = new Set(
    currentTargetPhrases.map((phrase) => normalizeText(phrase))
  );

  return allRows.filter((row) => {
    if (currentTargets.has(normalizeText(row.phrase))) {
      return false;
    }

    if (
      isRecentWithinDays(
        row.last_spontaneous_used_at,
        RECENT_SPONTANEOUS_DAYS
      )
    ) {
      return false;
    }

    if (isRecentWithinDays(row.last_practiced_at, RECENT_PRACTICE_DAYS)) {
      return false;
    }

    const neverTrained = (row.times_attempted ?? 0) === 0;
    const recentlyAdded = isRecentWithinDays(
      row.created_at,
      RECENT_UNTRAINED_DAYS
    );

    if (neverTrained && recentlyAdded) {
      return false;
    }

    return true;
  });
};

const getResurfacingPriority = (row: PhraseRow) => {
  const lastPracticeDays = daysSinceIso(row.last_practiced_at) ?? 9999;
  const lastSpontaneousDays = daysSinceIso(row.last_spontaneous_used_at) ?? 9999;
  const spontaneousExposure =
    (row.times_spontaneous_correct ?? 0) +
    (row.times_spontaneous_almost ?? 0) +
    (row.times_spontaneous_wrong ?? 0);

  return (
    Math.min(lastPracticeDays, 365) * 0.7 +
    Math.min(lastSpontaneousDays, 365) * 0.9 -
    spontaneousExposure * 2
  );
};

const getFirstTurnPool = (filteredRows: PhraseRow[]) => {
  if (filteredRows.length <= UNLIMITED_POOL_THRESHOLD) {
    return filteredRows;
  }

  return [...filteredRows]
    .sort((a, b) => getResurfacingPriority(b) - getResurfacingPriority(a))
    .slice(0, LARGE_DB_FIRST_TURN_CAP);
};

const getLaterTurnPool = (filteredRows: PhraseRow[], userMessage: string) => {
  if (filteredRows.length <= UNLIMITED_POOL_THRESHOLD) {
    return filteredRows;
  }

  return [...filteredRows]
    .map((row) => ({
      ...row,
      candidateScore:
        overlapScore(userMessage, row.phrase) * 10 + getResurfacingPriority(row),
    }))
    .sort((a, b) => b.candidateScore - a.candidateScore)
    .slice(0, LARGE_DB_LATER_TURN_CAP);
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

  const { data, error } = await supabase.from("phrases").select(
    "id, phrase, created_at, times_attempted, times_correct, times_almost, last_practiced_at, last_spontaneous_used_at, times_spontaneous_correct, times_spontaneous_almost, times_spontaneous_wrong"
  );

  if (error) {
    console.error(
      "Failed to load phrases for spontaneous evaluation:",
      error
    );
    return [];
  }

  const allRows = (data || []) as PhraseRow[];
  const filteredRows = getFilteredNonTargetRows(allRows, currentTargetPhrases);

  const candidatePool = isFirstTurn
    ? getFirstTurnPool(filteredRows)
    : getLaterTurnPool(filteredRows, trimmedMessage);

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
- detect real usage only, not merely related ideas
- accept natural inflections
- ignore current target phrases
- decide whether usage is truly spontaneous
- copied or directly repeated material from the previous assistant message is not spontaneous
- only include phrases that were actually used or clearly attempted
- do not include phrases with status "unused"

Return ONLY valid JSON with exactly this structure:
{
  "spontaneousMatches": [
    {
      "phrase": "candidate phrase",
      "status": "correct | almost | wrong | unused",
      "detectedText": "exact matching text from learner message or empty string",
      "isSpontaneous": true,
      "confidence": 0.0
    }
  ]
}`,
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

    const nextSpontaneousCorrect =
      (row.times_spontaneous_correct ?? 0) +
      (match.status === "correct" ? 1 : 0);

    const nextSpontaneousAlmost =
      (row.times_spontaneous_almost ?? 0) +
      (match.status === "almost" ? 1 : 0);

    const nextSpontaneousWrong =
      (row.times_spontaneous_wrong ?? 0) +
      (match.status === "wrong" ? 1 : 0);

    const currentAttempts = row.times_attempted ?? 0;
    const qualifiesForMasteryBoost =
      currentAttempts >= SPONTANEOUS_MASTERY_BONUS_MIN_ATTEMPTS &&
      currentAttempts <= SPONTANEOUS_MASTERY_BONUS_MAX_ATTEMPTS;

    let nextAttempts = currentAttempts;
    let nextCorrect = row.times_correct ?? 0;
    let nextAlmost = row.times_almost ?? 0;
    let nextLastPracticedAt = row.last_practiced_at;

    if (qualifiesForMasteryBoost) {
      if (match.status === "correct") {
        nextAttempts += 1;
        nextCorrect += 1;
        nextLastPracticedAt = nowIso;
      } else if (match.status === "almost") {
        nextAttempts += 1;
        nextAlmost += 1;
        nextLastPracticedAt = nowIso;
      }
    }

    const updatePayload: Record<string, string | number | null> = {
      times_spontaneous_correct: nextSpontaneousCorrect,
      times_spontaneous_almost: nextSpontaneousAlmost,
      times_spontaneous_wrong: nextSpontaneousWrong,
      last_spontaneous_used_at: nowIso,
    };

    if (qualifiesForMasteryBoost && match.status === "correct") {
      updatePayload.times_attempted = nextAttempts;
      updatePayload.times_correct = nextCorrect;
      updatePayload.last_practiced_at = nextLastPracticedAt;
    }

    if (qualifiesForMasteryBoost && match.status === "almost") {
      updatePayload.times_attempted = nextAttempts;
      updatePayload.times_almost = nextAlmost;
      updatePayload.last_practiced_at = nextLastPracticedAt;
    }

    const { error: updateError } = await supabase
      .from("phrases")
      .update(updatePayload)
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
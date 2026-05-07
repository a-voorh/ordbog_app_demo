import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLES } from "../../lib/tables";

type SpontaneousStatus = "correct" | "almost" | "wrong" | "unused";

type TargetPhraseRef = {
  id?: string;
  phrase: string;
  translation_en?: string | null;
  short_explanation?: string | null;
};

type PhraseRow = {
  id: string;
  phrase: string;
  translation_en: string | null;
  short_explanation: string | null;
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

type VariantRow = {
  phrase_id: string;
  variant_da: string;
  usable_for_matching: boolean;
};

type CandidatePhrase = PhraseRow & {
  matchingVariants: string[];
};

type SpontaneousMatch = {
  phraseId: string;
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
  currentTargetPhrases: TargetPhraseRef[];
  isFirstTurn?: boolean;
  skipSpontaneousDetection?: boolean;
};

const DEBUG_SPONTANEOUS = false;

const RECENT_SPONTANEOUS_DAYS = 1;
const RECENT_PRACTICE_DAYS = 1;
const RECENT_UNTRAINED_DAYS = 9;
const UNLIMITED_POOL_THRESHOLD = 500;
const LARGE_DB_FIRST_TURN_CAP = 120;
const LARGE_DB_LATER_TURN_CAP = 60;
const SPONTANEOUS_MASTERY_BONUS_MIN_ATTEMPTS = 1;
const SPONTANEOUS_MASTERY_BONUS_MAX_ATTEMPTS = 3;

const MIN_CONFIDENCE = 0.6;
const AMBIGUOUS_SINGLE_WORD_MIN_CONFIDENCE = 0.8;
const MIN_OVERLAP_RATIO = 0.5;

const debugLog = (...args: unknown[]) => {
  if (DEBUG_SPONTANEOUS) {
    console.log(...args);
  }
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.,!?;:()"“”'‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizePhraseKey = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeMeaningKey = (value?: string | null) =>
  (value || "").trim().toLowerCase().replace(/\s+/g, " ");

const stripLeadingAt = (phrase: string) =>
  phrase.trim().replace(/^at\s+/i, "").trim();

const tokenize = (text: string) =>
  normalizeText(text).split(" ").filter(Boolean);

const overlapScoreForTexts = (message: string, texts: string[]) => {
  const messageTokens = new Set(tokenize(message));

  return texts.reduce((bestScore, text) => {
    const phraseTokens = tokenize(stripLeadingAt(text));
    const score = phraseTokens.filter((token) => messageTokens.has(token)).length;
    return Math.max(bestScore, score);
  }, 0);
};

const containsNormalizedSubstring = (haystack: string, needle: string) => {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);

  if (!normalizedNeedle) return false;
  return ` ${normalizedHaystack} `.includes(` ${normalizedNeedle} `);
};

const getTokenOverlapRatio = (detectedText: string, candidateTexts: string[]) => {
  const detectedTokens = tokenize(detectedText);
  if (detectedTokens.length === 0) return 0;

  let bestRatio = 0;

  for (const candidateText of candidateTexts) {
    const candidateTokens = tokenize(stripLeadingAt(candidateText));
    if (candidateTokens.length === 0) continue;

    const detectedSet = new Set(detectedTokens);
    const overlapCount = candidateTokens.filter((token) =>
      detectedSet.has(token)
    ).length;

    const ratio = overlapCount / candidateTokens.length;
    if (ratio > bestRatio) bestRatio = ratio;
  }

  return bestRatio;
};

const hasLocalTextEvidence = (row: CandidatePhrase, userMessage: string) => {
  const textsToMatch = [row.phrase, ...row.matchingVariants];

  return textsToMatch.some((text) => {
    const stripped = stripLeadingAt(text);

    if (containsNormalizedSubstring(userMessage, text)) return true;
    if (containsNormalizedSubstring(userMessage, stripped)) return true;

    const phraseTokens = tokenize(stripped);
    const messageTokens = new Set(tokenize(userMessage));

    if (phraseTokens.length === 0) return false;

    const overlapCount = phraseTokens.filter((token) =>
      messageTokens.has(token)
    ).length;

    const overlapRatio = overlapCount / phraseTokens.length;

    if (phraseTokens.length === 1) {
      return overlapRatio === 1;
    }

    return overlapRatio >= MIN_OVERLAP_RATIO;
  });
};

const isClearlyCopiedFromAssistant = (
  detectedText: string,
  previousAssistantMessage: string
) => {
  if (!detectedText.trim() || !previousAssistantMessage.trim()) return false;
  return containsNormalizedSubstring(previousAssistantMessage, detectedText);
};

const normalizeConfidence = (value: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
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

const samePhraseMeaning = (
  a: { phrase: string; translation_en?: string | null },
  b: { phrase: string; translation_en?: string | null }
) =>
  normalizePhraseKey(a.phrase) === normalizePhraseKey(b.phrase) &&
  normalizeMeaningKey(a.translation_en) === normalizeMeaningKey(b.translation_en);

const getFilteredNonTargetRows = (
  allRows: CandidatePhrase[],
  currentTargetPhrases: TargetPhraseRef[]
) => {
  return allRows.filter((row) => {
    const isExactCurrentTarget = currentTargetPhrases.some((target) =>
      samePhraseMeaning(row, target)
    );

    if (isExactCurrentTarget) {
      debugLog("[spontaneous] filtered out exact current target:", row.phrase);
      return false;
    }

    if (isRecentWithinDays(row.last_spontaneous_used_at, RECENT_SPONTANEOUS_DAYS)) {
      return false;
    }

    if (isRecentWithinDays(row.last_practiced_at, RECENT_PRACTICE_DAYS)) {
      return false;
    }

    const neverTrained = (row.times_attempted ?? 0) === 0;
    const recentlyAdded = isRecentWithinDays(row.created_at, RECENT_UNTRAINED_DAYS);

    if (neverTrained && recentlyAdded) {
      return false;
    }

    return true;
  });
};

const getResurfacingPriority = (row: CandidatePhrase) => {
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

const getFirstTurnPool = (filteredRows: CandidatePhrase[]) => {
  if (filteredRows.length <= UNLIMITED_POOL_THRESHOLD) return filteredRows;

  return [...filteredRows]
    .sort((a, b) => getResurfacingPriority(b) - getResurfacingPriority(a))
    .slice(0, LARGE_DB_FIRST_TURN_CAP);
};

const getLaterTurnPool = (filteredRows: CandidatePhrase[], userMessage: string) => {
  if (filteredRows.length <= UNLIMITED_POOL_THRESHOLD) return filteredRows;

  return [...filteredRows]
    .map((row) => {
      const textsToMatch = [row.phrase, ...row.matchingVariants];

      return {
        ...row,
        candidateScore:
          overlapScoreForTexts(userMessage, textsToMatch) * 10 +
          getResurfacingPriority(row),
      };
    })
    .sort((a, b) => b.candidateScore - a.candidateScore)
    .slice(0, LARGE_DB_LATER_TURN_CAP);
};

const parseSpontaneousResponse = (
  rawText: string
): SpontaneousResponse | null => {
  try {
    const parsed = JSON.parse(rawText);

    if (!parsed || !Array.isArray(parsed.spontaneousMatches)) return null;

    return {
      spontaneousMatches: parsed.spontaneousMatches.map((item: any) => ({
        phraseId: typeof item.phraseId === "string" ? item.phraseId : "",
        phrase: typeof item.phrase === "string" ? item.phrase : "",
        status:
          item.status === "correct" ||
          item.status === "almost" ||
          item.status === "wrong" ||
          item.status === "unused"
            ? item.status
            : "unused",
        detectedText:
          typeof item.detectedText === "string" ? item.detectedText : "",
        isSpontaneous: item.isSpontaneous === true,
        confidence: normalizeConfidence(item.confidence),
      })),
    };
  } catch (err) {
    console.error("Failed to parse spontaneous response JSON:", err);
    debugLog("[spontaneous] raw response:", rawText);
    return null;
  }
};

const dedupeByStrongestMatch = (matches: SpontaneousMatch[]) => {
  const byPhraseId = new Map<string, SpontaneousMatch>();

  for (const match of matches) {
    if (!match.phraseId) continue;

    const existing = byPhraseId.get(match.phraseId);
    if (!existing) {
      byPhraseId.set(match.phraseId, match);
      continue;
    }

    const existingDetectedLength = normalizeText(existing.detectedText).length;
    const newDetectedLength = normalizeText(match.detectedText).length;

    const shouldReplace =
      match.confidence > existing.confidence ||
      (match.confidence === existing.confidence &&
        newDetectedLength > existingDetectedLength);

    if (shouldReplace) {
      byPhraseId.set(match.phraseId, match);
    }
  }

  return Array.from(byPhraseId.values());
};

export async function evaluateAndApplySpontaneousUsage({
  openai,
  supabase,
  userMessage,
  previousAssistantMessage,
  currentTargetPhrases,
  isFirstTurn = false,
  skipSpontaneousDetection = false,
}: EvaluateAndApplySpontaneousUsageArgs): Promise<SpontaneousMatch[]> {
  if (skipSpontaneousDetection) {
    debugLog("[spontaneous] skipped by caller");
    return [];
  }

  const trimmedMessage = userMessage.trim();
  if (!trimmedMessage) return [];

  const { data, error } = await supabase.from(TABLES.phrases).select(
    "id, phrase, translation_en, short_explanation, created_at, times_attempted, times_correct, times_almost, last_practiced_at, last_spontaneous_used_at, times_spontaneous_correct, times_spontaneous_almost, times_spontaneous_wrong"
  );

  if (error) {
    console.error("Failed to load phrases for spontaneous evaluation:", error);
    return [];
  }

  const phraseRows = (data || []) as PhraseRow[];
  const phraseIds = phraseRows.map((row) => row.id);

  let allRows: CandidatePhrase[] = phraseRows.map((row) => ({
    ...row,
    matchingVariants: [],
  }));

  if (phraseIds.length > 0) {
    const { data: variantRows, error: variantError } = await supabase
      .from(TABLES.variants)
      .select("phrase_id, variant_da, usable_for_matching")
      .in("phrase_id", phraseIds)
      .eq("usable_for_matching", true);

    if (variantError) {
      console.error("Failed to load variants for spontaneous evaluation:", variantError);
    } else {
      const variantsByPhraseId = new Map<string, string[]>();

      for (const row of (variantRows || []) as VariantRow[]) {
        const variant = row.variant_da?.trim();
        if (!variant) continue;

        const existing = variantsByPhraseId.get(row.phrase_id) || [];
        existing.push(variant);
        variantsByPhraseId.set(row.phrase_id, existing);
      }

      allRows = phraseRows.map((row) => ({
        ...row,
        matchingVariants: Array.from(new Set(variantsByPhraseId.get(row.id) || [])),
      }));
    }
  }

  const filteredRows = getFilteredNonTargetRows(allRows, currentTargetPhrases);

  const initialCandidatePool = isFirstTurn
    ? getFirstTurnPool(filteredRows)
    : getLaterTurnPool(filteredRows, trimmedMessage);

  if (initialCandidatePool.length === 0) {
    debugLog("[spontaneous] candidate pool is empty");
    return [];
  }

  const candidatePool = initialCandidatePool.filter((row) =>
    hasLocalTextEvidence(row, trimmedMessage)
  );

  if (candidatePool.length === 0) {
    debugLog("[spontaneous] no candidates with local text evidence");
    return [];
  }

  const candidateMapById = new Map(
    candidatePool.map((row) => [row.id, row] as const)
  );

  const currentTargetIds = new Set(
    currentTargetPhrases.map((target) => target.id).filter(Boolean)
  );

  const currentTargetBlock =
    currentTargetPhrases.length > 0
      ? currentTargetPhrases
          .map(
            (target) =>
              `- phraseId: ${target.id || "(no id)"}
  Base phrase: ${target.phrase}
  Meaning in English: ${target.translation_en || "(not provided)"}`
          )
          .join("\n")
      : "(none)";

  const candidatePhraseBlock = candidatePool
    .map((row) => {
      const variantsText =
        row.matchingVariants.length > 0
          ? `\n  Accepted variants:\n${row.matchingVariants
              .map((variant) => `  - ${variant}`)
              .join("\n")}`
          : "";

      return `- phraseId: ${row.id}
  Base phrase: ${row.phrase}
  Meaning in English: ${row.translation_en || "(not provided)"}${variantsText}`;
    })
    .join("\n");

  debugLog("[spontaneous] user message:", trimmedMessage);
  debugLog("[spontaneous] total phrases:", allRows.length);
  debugLog("[spontaneous] filtered pool size:", filteredRows.length);
  debugLog("[spontaneous] initial candidate pool size:", initialCandidatePool.length);
  debugLog("[spontaneous] evidence-filtered candidate pool size:", candidatePool.length);

  const evaluationResponse = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You evaluate whether a learner used saved Danish phrases spontaneously.

Current target phrase meanings:
${currentTargetBlock}

Candidate non-target saved phrases and accepted variants:
${candidatePhraseBlock}

Rules:
- Detect real usage only, not related ideas.
- Require visible textual evidence in the learner message: exact phrase, accepted variant, natural inflection, or very close grammatical form.
- Accepted variants and natural inflections of variants count.
- Match by meaning when the same surface word can have different meanings.
- Ignore current target phrases in their current meanings.
- Do not count copied or directly repeated material from the previous assistant message.
- Only include phrases actually used or clearly attempted.
- Do not include unused phrases.
- Only return phrases from the candidate list.
- Always return the exact candidate phraseId.
- Return the base phrase exactly as listed.
- Put the exact learner wording into detectedText.

Status:
- correct = natural and correct usage.
- almost = understandable but slightly unnatural or grammatically imperfect.
- wrong = clear attempt, but meaning or usage is wrong.

Confidence:
- 1.0 = exact phrase or variant.
- 0.9 = clear match with minor variation.
- 0.8 = likely match but slightly uncertain.
- below 0.6 = weak or uncertain.

Return ONLY valid JSON:
{
  "spontaneousMatches": [
    {
      "phraseId": "candidate phrase id",
      "phrase": "candidate base phrase",
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
                  phraseId: { type: "string" },
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
                  "phraseId",
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

  const parsed = parseSpontaneousResponse(evaluationResponse.output_text ?? "");
  if (!parsed) return [];

  debugLog("[spontaneous] raw model matches:", parsed.spontaneousMatches);

  const dedupedMatches = dedupeByStrongestMatch(parsed.spontaneousMatches);

  debugLog("[spontaneous] deduped model matches:", dedupedMatches);

  const validMatches = dedupedMatches.filter((match) => {
    if (!match.phraseId || !candidateMapById.has(match.phraseId)) {
      debugLog("[spontaneous] skipped phraseId not in candidate pool:", match.phraseId);
      return false;
    }

    const candidateRow = candidateMapById.get(match.phraseId);
    if (!candidateRow) return false;

    if (currentTargetIds.has(match.phraseId)) {
      debugLog("[spontaneous] skipped current target returned by model:", match.phraseId);
      return false;
    }

    if (match.phrase !== candidateRow.phrase) {
      debugLog("[spontaneous] skipped mismatched phrase label:", match.phraseId);
      return false;
    }

    if (!match.isSpontaneous) {
      debugLog("[spontaneous] skipped non-spontaneous match:", match.phrase);
      return false;
    }

    if (match.status === "unused") {
      debugLog("[spontaneous] skipped unused match:", match.phrase);
      return false;
    }

    if (!match.detectedText.trim()) {
      debugLog("[spontaneous] skipped empty detectedText:", match.phrase);
      return false;
    }

    if (!containsNormalizedSubstring(trimmedMessage, match.detectedText)) {
      debugLog("[spontaneous] skipped detectedText not found:", match.phrase);
      return false;
    }

    const candidateTexts = [candidateRow.phrase, ...candidateRow.matchingVariants];
    const overlapRatio = getTokenOverlapRatio(match.detectedText, candidateTexts);

    if (overlapRatio < MIN_OVERLAP_RATIO) {
      debugLog("[spontaneous] skipped low overlap:", match.phrase, overlapRatio);
      return false;
    }

    if (isClearlyCopiedFromAssistant(match.detectedText, previousAssistantMessage)) {
      debugLog("[spontaneous] skipped copied from assistant:", match.phrase);
      return false;
    }

    const candidateTokenCount = tokenize(stripLeadingAt(candidateRow.phrase)).length;

    const requiredConfidence =
      candidateTokenCount <= 1
        ? AMBIGUOUS_SINGLE_WORD_MIN_CONFIDENCE
        : MIN_CONFIDENCE;

    if (match.confidence < requiredConfidence) {
      debugLog(
        "[spontaneous] skipped low confidence:",
        match.phrase,
        match.confidence,
        "required:",
        requiredConfidence
      );
      return false;
    }

    return true;
  });

  debugLog("[spontaneous] valid non-target matches:", validMatches);

  if (validMatches.length === 0) {
    debugLog("[spontaneous] no valid matches to update");
    return dedupedMatches;
  }

  const nowIso = new Date().toISOString();

  await Promise.all(
    validMatches.map(async (match) => {
      const row = candidateMapById.get(match.phraseId);
      if (!row) return;

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

      debugLog("[spontaneous] updating phrase:", row.id, row.phrase);

      const { error: updateError } = await supabase
        .from(TABLES.phrases)
        .update(updatePayload)
        .eq("id", row.id);

      if (updateError) {
        console.error("Failed to update spontaneous phrase stats:", updateError);
      }
    })
  );
//console.log(
  //`[spontaneous] ${validMatches.length} spontaneous phrase${
 //   validMatches.length === 1 ? "" : "s"
  //} detected`
//);
  return dedupedMatches;
}
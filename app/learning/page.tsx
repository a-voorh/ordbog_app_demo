"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { TABLES } from "../../lib/tables";

const EXAMPLES_TABLE = TABLES.variants;
const RECENT_LEARNING_KEY = "recent_learning_items_v1";
const RECENT_LIMIT = 18;
const PREPOSITION_SESSION_TOTAL = 10;
const GAP_SESSION_TOTAL = 10;

type ExerciseType = "translation" | "gap" | "preposition";

type PhraseCard = {
  id: string;
  phrase: string;
  translation_en: string;
  short_explanation?: string | null;
  example_da?: string | null;
  example_en?: string | null;
  times_correct?: number | null;
  times_spontaneous_correct?: number | null;
  learning_attempted?: number | null;
  learning_correct?: number | null;
  learning_almost?: number | null;
  learning_wrong?: number | null;
  last_learning_at?: string | null;
};

type PhraseExample = {
  id: string;
  phrase_id: string;
  variant_da: string;
  variant_en?: string | null;
};

type SelectedExample = {
  id?: string;
  sentence_da: string;
  sentence_en?: string | null;
  source: "variants_table" | "card_fallback";
};

type EvaluationResult = {
  status: "correct" | "almost" | "wrong";
  meaning_ok: boolean;
  natural_da: boolean;
  target_phrase_used: boolean;
  feedback_da: string;
  corrected_answer_da: string | null;
};

type GapExercise = {
  prompt: string;
  answer: string;
  options: string[];
  fullSentence: string;
};

type PrepositionQuest = {
  prompt: string;
  answers: string[];
  options: string[];
  fullSentence: string;
};

type PrepositionSession = {
  total: number;
  current: number;
  correct: number;
  finished: boolean;
};

type GapSession = {
  total: number;
  current: number;
  correct: number;
  finished: boolean;
};

const PREPOSITIONS = [
  "til", "på", "i", "med", "for", "fra", "om", "over",
  "under", "efter", "før", "hos", "af", "gennem",
  "mellem", "mod", "uden", "inden", "bag", "foran",
];

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

const normalizeText = (text: string) =>
  text.toLowerCase().replace(/[.,!?;:"]/g, "").replace(/\s+/g, " ").trim();

const cleanToken = (token: string) =>
  token.toLowerCase().replace(/[.,!?;:()"]/g, "").trim();

const getRecentLearningItems = () => {
  if (typeof window === "undefined") return [];

  try {
    return JSON.parse(localStorage.getItem(RECENT_LEARNING_KEY) || "[]") as string[];
  } catch {
    return [];
  }
};

const saveRecentLearningItems = (items: string[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(RECENT_LEARNING_KEY, JSON.stringify(items));
};

const makeFallbackExample = (card: PhraseCard): SelectedExample | null => {
  const sentence = card.example_da || card.phrase;
  if (!sentence) return null;

  return {
    sentence_da: sentence,
    sentence_en: card.example_en || card.translation_en,
    source: "card_fallback",
  };
};

const examplesForCard = (
  card: PhraseCard,
  examplesByPhraseId: Record<string, PhraseExample[]>
): SelectedExample[] => {
  const tableExamples = (examplesByPhraseId[card.id] || [])
    .filter((example) => example.variant_da?.trim())
    .map((example) => ({
      id: example.id,
      sentence_da: example.variant_da,
      sentence_en: example.variant_en,
      source: "variants_table" as const,
    }));

  const fallback = makeFallbackExample(card);
  return fallback ? [...tableExamples, fallback] : tableExamples;
};

const learningKeyFor = (
  card: PhraseCard,
  example: SelectedExample,
  type: ExerciseType
) => `${type}:${card.id}:${normalizeText(example.sentence_da)}`;

const makeGapExercise = (sentence: string, phrase: string): GapExercise | null => {
  if (!sentence || !phrase) return null;

  const cleanPhrase = phrase.replace(/^at\s+/i, "").trim();
  const words = cleanPhrase.split(/\s+/).filter(Boolean);

  const preferredGapWords = [
    "til", "på", "i", "med", "for", "fra", "om", "over",
    "under", "efter", "før", "ved", "hos", "af",
  ];

  const wordToHide =
    words.find((word) =>
      preferredGapWords.includes(word.toLowerCase().replace(/[.,!?]/g, ""))
    ) || words[Math.floor(words.length / 2)];

  if (!wordToHide) return null;

  const escaped = wordToHide.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "i");

  if (!regex.test(sentence)) return null;

  const normalizedAnswer = wordToHide.toLowerCase().replace(/[.,!?]/g, "");

  const prepositionOptions = [
    "til", "på", "i", "med", "for", "fra", "om", "over", "efter", "ved",
  ];

  const nounLikeOptions = [
    "krav", "mulighed", "fordel", "problem", "grund", "måde",
    "forudsætning", "chance",
  ];

  const distractorPool = preferredGapWords.includes(normalizedAnswer)
    ? prepositionOptions
    : nounLikeOptions;

  const options = shuffle(
    Array.from(
      new Set([
        wordToHide,
        ...shuffle(distractorPool.filter((item) => item !== normalizedAnswer)).slice(0, 3),
      ])
    )
  );

  return {
    prompt: sentence.replace(regex, "_____"),
    answer: wordToHide,
    options,
    fullSentence: sentence,
  };
};

const makePrepositionQuest = (sentence: string): PrepositionQuest | null => {
  if (!sentence) return null;

  const blockedChunks = ["for at"];
  const tokens = sentence.split(/(\s+)/);

  const candidates: { index: number; answer: string }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.trim()) continue;
    if (token === "I") continue;

    const normalized = cleanToken(token);
    if (!PREPOSITIONS.includes(normalized)) continue;

    const nextWord = cleanToken(tokens[i + 2] || "");
    if (blockedChunks.includes(`${normalized} ${nextWord}`)) continue;

    candidates.push({ index: i, answer: normalized });
  }

  if (!candidates.length) return null;

  const selectedCandidates = shuffle(candidates).slice(0, 1);
  const answers = selectedCandidates.map((item) => item.answer);
  const promptTokens = [...tokens];

  selectedCandidates.forEach((item) => {
    promptTokens[item.index] = "_____";
  });

  const distractors = shuffle(
    PREPOSITIONS.filter((p) => !answers.includes(p))
  ).slice(0, Math.max(0, 4 - answers.length));

  const options = shuffle(Array.from(new Set([...answers, ...distractors])));

  return {
    prompt: promptTokens.join(""),
    answers,
    options,
    fullSentence: sentence,
  };
};

const encouragementForScore = (correct: number, total: number) => {
  const ratio = correct / total;

  if (ratio === 1) return "Perfect. Danish behaved for once.";
  if (ratio >= 0.8) return "Very strong round. Only a few small traps.";
  if (ratio >= 0.6) return "Good work. This is exactly the kind of thing that improves by repetition.";
  if (ratio >= 0.4) return "Decent practice round. You are collecting patterns.";
  return "No worries. This is exactly why small focused rounds are useful.";
};

export default function LearningPage() {
  const [cards, setCards] = useState<PhraseCard[]>([]);
  const [examplesByPhraseId, setExamplesByPhraseId] = useState<Record<string, PhraseExample[]>>({});
  const [card, setCard] = useState<PhraseCard | null>(null);
  const [selectedExample, setSelectedExample] = useState<SelectedExample | null>(null);
  const [answer, setAnswer] = useState("");
  const [prepositionAnswers, setPrepositionAnswers] = useState<string[]>([]);
  const [prepositionChecked, setPrepositionChecked] = useState(false);

  const [prepositionSession, setPrepositionSession] = useState<PrepositionSession>({
    total: PREPOSITION_SESSION_TOTAL,
    current: 1,
    correct: 0,
    finished: false,
  });

  const [gapSession, setGapSession] = useState<GapSession>({
    total: GAP_SESSION_TOTAL,
    current: 1,
    correct: 0,
    finished: false,
  });

  const [requireTargetPhrase, setRequireTargetPhrase] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasRecordedResult, setHasRecordedResult] = useState(false);
  const [, setRecentLearningItems] = useState<string[]>([]);
  const [exerciseType, setExerciseType] = useState<ExerciseType>("translation");

  const englishPrompt =
    selectedExample?.sentence_en ||
    card?.example_en ||
    card?.translation_en ||
    "";

  const referenceAnswer =
    selectedExample?.sentence_da || card?.example_da || card?.phrase || "";

  const targetPhrase = card?.phrase || "";

  const gapExercise = useMemo(() => {
    return selectedExample?.sentence_da && card
      ? makeGapExercise(selectedExample.sentence_da, card.phrase)
      : null;
  }, [selectedExample, card]);

  const prepositionQuest = useMemo(() => {
    return selectedExample?.sentence_da
      ? makePrepositionQuest(selectedExample.sentence_da)
      : null;
  }, [selectedExample]);

  const ensureTranslation = async (
    example: SelectedExample,
    phraseId?: string
  ): Promise<SelectedExample> => {
    if (example.source !== "variants_table") return example;
    if (example.sentence_en) return example;
    if (!example.id) return example;

    try {
      const res = await fetch("/api/translate-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variant_id: example.id,
          variant_da: example.sentence_da,
        }),
      });

      const data = await res.json();
      if (!data.variant_en) return example;

      if (phraseId) {
        setExamplesByPhraseId((prev) => ({
          ...prev,
          [phraseId]: (prev[phraseId] || []).map((item) =>
            item.id === example.id ? { ...item, variant_en: data.variant_en } : item
          ),
        }));
      }

      return { ...example, sentence_en: data.variant_en };
    } catch (err) {
      console.error("Translation failed:", err);
      return example;
    }
  };

  const rememberLearningItem = (
    cardToRemember: PhraseCard,
    exampleToRemember: SelectedExample,
    type: ExerciseType
  ) => {
    const key = learningKeyFor(cardToRemember, exampleToRemember, type);

    setRecentLearningItems((prev) => {
      const next = [key, ...prev.filter((item) => item !== key)].slice(0, RECENT_LIMIT);
      saveRecentLearningItems(next);
      return next;
    });
  };

  const pickRandomLearningItem = (
    list: PhraseCard[],
    type: ExerciseType,
    examplesMap: Record<string, PhraseExample[]>,
    currentCardId?: string | null
  ) => {
    if (!list.length) return null;

    const recent = getRecentLearningItems();

    const candidates = list.flatMap((item) => {
      const examples = examplesForCard(item, examplesMap);

      return examples
        .filter((example) => {
          if (type === "gap") return !!makeGapExercise(example.sentence_da, item.phrase);
          if (type === "preposition") return !!makePrepositionQuest(example.sentence_da);
          return true;
        })
        .map((example) => ({
          card: item,
          example,
          key: learningKeyFor(item, example, type),
        }));
    });

    if (!candidates.length) return null;

    const freshCandidates = candidates.filter((item) => {
      if (item.card.id === currentCardId && candidates.length > 1) return false;
      return !recent.includes(item.key);
    });

    const fallbackCandidates = candidates.filter(
      (item) => item.card.id !== currentCardId || candidates.length === 1
    );

    const pool =
      freshCandidates.length > 0
        ? freshCandidates
        : fallbackCandidates.length > 0
        ? fallbackCandidates
        : candidates;

    return pool[Math.floor(Math.random() * pool.length)];
  };

  const loadCards = async () => {
    setLoading(true);

    const storedRecent = getRecentLearningItems();
    setRecentLearningItems(storedRecent);

    const { data, error } = await supabase
      .from(TABLES.phrases)
      .select(`
        id,
        phrase,
        translation_en,
        short_explanation,
        example_da,
        example_en,
        times_correct,
        times_spontaneous_correct,
        learning_attempted,
        learning_correct,
        learning_almost,
        learning_wrong,
        last_learning_at
      `)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const loadedCards = ((data || []) as PhraseCard[]).filter((card) => {
      const spontaneous = card.times_spontaneous_correct || 0;
      if (spontaneous >= 1) return false;

      const promptedCorrect = card.times_correct || 0;
      if (promptedCorrect >= 3) return false;

      return true;
    });

    let examplesMap: Record<string, PhraseExample[]> = {};

    if (loadedCards.length) {
      const { data: examplesData, error: examplesError } = await supabase
        .from(EXAMPLES_TABLE)
        .select("id, phrase_id, variant_da, variant_en")
        .in("phrase_id", loadedCards.map((item) => item.id));

      if (examplesError) {
        console.error("Failed to load phrase variants:", examplesError);
      } else {
        examplesMap = ((examplesData || []) as PhraseExample[]).reduce(
          (acc, example) => {
            if (!example.phrase_id || !example.variant_da) return acc;
            acc[example.phrase_id] = [...(acc[example.phrase_id] || []), example];
            return acc;
          },
          {} as Record<string, PhraseExample[]>
        );
      }
    }

    setCards(loadedCards);
    setExamplesByPhraseId(examplesMap);

    const firstItem = pickRandomLearningItem(loadedCards, exerciseType, examplesMap);

    if (!firstItem) {
      setCard(null);
      setSelectedExample(null);
      setAnswer("");
      setPrepositionAnswers([]);
      setPrepositionChecked(false);
      setResult(null);
      setHasRecordedResult(false);
      setLoading(false);
      return;
    }

    const translatedExample = await ensureTranslation(firstItem.example, firstItem.card.id);

    setCard(firstItem.card);
    setSelectedExample(translatedExample);
    setAnswer("");
    setPrepositionAnswers([]);
    setPrepositionChecked(false);
    setResult(null);
    setHasRecordedResult(false);
    setLoading(false);

    rememberLearningItem(firstItem.card, translatedExample, exerciseType);
  };

  const moveToNextLearningItem = async () => {
    if (!cards.length) return;

    const next = pickRandomLearningItem(
      cards,
      exerciseType,
      examplesByPhraseId,
      card?.id
    );

    if (!next) return;

    const translatedExample = await ensureTranslation(next.example, next.card.id);

    setCard(next.card);
    setSelectedExample(translatedExample);
    setAnswer("");
    setPrepositionAnswers([]);
    setPrepositionChecked(false);
    setResult(null);
    setHasRecordedResult(false);
    rememberLearningItem(next.card, translatedExample, exerciseType);
  };

  const nextCard = async () => {
    if (exerciseType === "preposition" && !prepositionChecked) return;
    if (exerciseType === "gap" && !result) return;

    if (exerciseType === "preposition" && prepositionChecked) {
      if (prepositionSession.current >= prepositionSession.total) {
        setPrepositionSession((prev) => ({ ...prev, finished: true }));
        return;
      }

      setPrepositionSession((prev) => ({ ...prev, current: prev.current + 1 }));
    }

    if (exerciseType === "gap" && result) {
      if (gapSession.current >= gapSession.total) {
        setGapSession((prev) => ({ ...prev, finished: true }));
        return;
      }

      setGapSession((prev) => ({ ...prev, current: prev.current + 1 }));
    }

    await moveToNextLearningItem();
  };

  const switchExerciseType = async (type: ExerciseType) => {
    setExerciseType(type);
    setAnswer("");
    setPrepositionAnswers([]);
    setPrepositionChecked(false);
    setResult(null);
    setHasRecordedResult(false);

    if (type === "preposition") {
      setPrepositionSession({
        total: PREPOSITION_SESSION_TOTAL,
        current: 1,
        correct: 0,
        finished: false,
      });
    }

    if (type === "gap") {
      setGapSession({
        total: GAP_SESSION_TOTAL,
        current: 1,
        correct: 0,
        finished: false,
      });
    }

    const next = pickRandomLearningItem(cards, type, examplesByPhraseId, card?.id);
    if (!next) return;

    const translatedExample = await ensureTranslation(next.example, next.card.id);

    setCard(next.card);
    setSelectedExample(translatedExample);
    rememberLearningItem(next.card, translatedExample, type);
  };

  const restartPrepositionSession = async () => {
    setPrepositionSession({
      total: PREPOSITION_SESSION_TOTAL,
      current: 1,
      correct: 0,
      finished: false,
    });

    setPrepositionAnswers([]);
    setPrepositionChecked(false);
    setResult(null);
    setHasRecordedResult(false);

    const next = pickRandomLearningItem(cards, "preposition", examplesByPhraseId, card?.id);
    if (!next) return;

    const translatedExample = await ensureTranslation(next.example, next.card.id);

    setCard(next.card);
    setSelectedExample(translatedExample);
    rememberLearningItem(next.card, translatedExample, "preposition");
  };

  const restartGapSession = async () => {
    setGapSession({
      total: GAP_SESSION_TOTAL,
      current: 1,
      correct: 0,
      finished: false,
    });

    setAnswer("");
    setResult(null);
    setHasRecordedResult(false);

    const next = pickRandomLearningItem(cards, "gap", examplesByPhraseId, card?.id);
    if (!next) return;

    const translatedExample = await ensureTranslation(next.example, next.card.id);

    setCard(next.card);
    setSelectedExample(translatedExample);
    rememberLearningItem(next.card, translatedExample, "gap");
  };

  const hasAnyGapExercise = cards.some((item) =>
    examplesForCard(item, examplesByPhraseId).some((example) =>
      makeGapExercise(example.sentence_da, item.phrase)
    )
  );

  const hasAnyPrepositionQuest = cards.some((item) =>
    examplesForCard(item, examplesByPhraseId).some((example) =>
      makePrepositionQuest(example.sentence_da)
    )
  );

  const recordLearningResult = async (
    cardToUpdate: PhraseCard,
    status: "correct" | "almost" | "wrong"
  ) => {
    const updates =
      status === "correct"
        ? { learning_correct: (cardToUpdate.learning_correct || 0) + 1 }
        : status === "almost"
        ? { learning_almost: (cardToUpdate.learning_almost || 0) + 1 }
        : { learning_wrong: (cardToUpdate.learning_wrong || 0) + 1 };

    const nextAttempted = (cardToUpdate.learning_attempted || 0) + 1;
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from(TABLES.phrases)
      .update({
        ...updates,
        learning_attempted: nextAttempted,
        last_learning_at: nowIso,
      })
      .eq("id", cardToUpdate.id);

    if (error) {
      console.error("Failed to record learning result:", error);
      return;
    }

    setCards((prev) =>
      prev.map((item) =>
        item.id === cardToUpdate.id
          ? { ...item, ...updates, learning_attempted: nextAttempted, last_learning_at: nowIso }
          : item
      )
    );

    setCard((prev) =>
      prev?.id === cardToUpdate.id
        ? { ...prev, ...updates, learning_attempted: nextAttempted, last_learning_at: nowIso }
        : prev
    );
  };

  useEffect(() => {
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAnswer = async () => {
    if (!card) return;

    if (exerciseType !== "preposition" && !answer.trim()) return;
    if (exerciseType === "preposition" && prepositionChecked) return;
    if (exerciseType === "gap" && result) return;

    setChecking(true);
    setResult(null);

    try {
      if (exerciseType === "preposition" && prepositionQuest) {
        const expected = prepositionQuest.answers.map((item) => item.toLowerCase());
        const actual = prepositionAnswers.map((item) => item?.toLowerCase());

        const isCorrect =
          expected.length === actual.length &&
          expected.every((item, index) => item === actual[index]);

        setPrepositionChecked(true);

        if (isCorrect) {
          setPrepositionSession((prev) => ({ ...prev, correct: prev.correct + 1 }));
        }

        setResult({
          status: isCorrect ? "correct" : "wrong",
          meaning_ok: isCorrect,
          natural_da: isCorrect,
          target_phrase_used: isCorrect,
          feedback_da: isCorrect
            ? "Correct. Nice, that one landed."
            : "Not quite. Good one to remember.",
          corrected_answer_da: prepositionQuest.fullSentence,
        });

        if (!hasRecordedResult) {
          await recordLearningResult(card, isCorrect ? "correct" : "wrong");
          setHasRecordedResult(true);
        }

        return;
      }

      if (exerciseType === "gap" && gapExercise) {
        const completedSentence = gapExercise.prompt.replace("_____", answer.trim());

        const res = await fetch("/api/evaluate-translation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            english_prompt: gapExercise.fullSentence,
            reference_answer_da: gapExercise.fullSentence,
            learner_answer_da: completedSentence,
            target_phrase: "",
            require_target_phrase: false,
          }),
        });

        const data = await res.json();
        const isCorrect = data.status === "correct";

        if (isCorrect) {
          setGapSession((prev) => ({ ...prev, correct: prev.correct + 1 }));
        }

        setResult({
          status: isCorrect ? "correct" : "wrong",
          meaning_ok: isCorrect,
          natural_da: isCorrect,
          target_phrase_used: isCorrect,
          feedback_da: isCorrect
            ? "Correct. Nice and clean."
            : "Not quite. Good one to notice.",
          corrected_answer_da: gapExercise.fullSentence,
        });

        if (!hasRecordedResult) {
          await recordLearningResult(card, isCorrect ? "correct" : "wrong");
          setHasRecordedResult(true);
        }

        return;
      }

      const res = await fetch("/api/evaluate-translation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          english_prompt: englishPrompt,
          reference_answer_da: referenceAnswer,
          learner_answer_da: answer,
          target_phrase: targetPhrase,
          require_target_phrase: requireTargetPhrase,
        }),
      });

      const data = await res.json();
      setResult(data);

      if (!hasRecordedResult) {
        await recordLearningResult(card, data.status);
        setHasRecordedResult(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  };

  const isCheckDisabled =
    checking ||
    (exerciseType === "preposition"
      ? prepositionChecked ||
        !prepositionQuest ||
        prepositionAnswers.filter(Boolean).length !== prepositionQuest.answers.length
      : exerciseType === "gap"
      ? !!result || !answer.trim()
      : !answer.trim());

  const answeredPrepositionQuestions =
    exerciseType === "preposition"
      ? prepositionSession.current - (prepositionChecked ? 0 : 1)
      : 0;

  const answeredGapQuestions =
    exerciseType === "gap" ? gapSession.current - (result ? 0 : 1) : 0;

  const modeButtonStyle = (active: boolean) => ({
    width: "auto",
    minWidth: "auto",
    flex: "0 0 auto",
    padding: "8px 14px",
    fontSize: 13,
    lineHeight: 1.2,
    borderRadius: 10,
    border: active
      ? "1px solid rgba(99, 102, 241, 0.35)"
      : "1px solid rgba(0,0,0,0.08)",
    background: active ? "rgba(99, 102, 241, 0.10)" : "rgba(255,255,255,0.7)",
    color: active ? "#4f46e5" : "#4b5563",
    boxShadow: "none",
  });

  const optionButtonStyle = (selected: boolean) => ({
    width: "auto",
    minWidth: "auto",
    flex: "0 0 auto",
    padding: "7px 11px",
    fontSize: 14,
    lineHeight: 1.2,
    borderRadius: 8,
    border: selected
      ? "1px solid rgba(99, 102, 241, 0.35)"
      : "1px solid rgba(0,0,0,0.10)",
    background: selected ? "rgba(99, 102, 241, 0.12)" : "white",
    color: selected ? "#4338ca" : "#374151",
    boxShadow: "none",
  });

  const primaryActionStyle = {
    width: "auto",
    minWidth: "auto",
    flex: "0 0 auto",
    padding: "10px 16px",
    fontSize: 14,
    lineHeight: 1.2,
    borderRadius: 10,
  };

  const secondaryActionStyle = {
    width: "auto",
    minWidth: "auto",
    flex: "0 0 auto",
    padding: "10px 16px",
    fontSize: 14,
    lineHeight: 1.2,
    borderRadius: 10,
    opacity: 0.92,
  };

 if (loading) {
  return (
    <main className="app-page">
      <div className="card">Loading learning mode...</div>
    </main>
  );
}

if (!card || !selectedExample) {
  return (
    <main className="app-page">
      <div className="card">No cards found.</div>
    </main>
  );
}

if (exerciseType === "preposition" && prepositionSession.finished) {
  return (
    <main className="app-page">
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="app-title">🧠 Learning Mode</h1>
          <p className="app-subtitle">Preposition quest complete.</p>
        </div>
      </div>

      <div className="card card-strong">
        <h2 className="section-title">
          Score: {prepositionSession.correct}/{prepositionSession.total}
        </h2>

        <p style={{ marginTop: 12 }}>
          {encouragementForScore(prepositionSession.correct, prepositionSession.total)}
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <button
            className="primary-button"
            style={primaryActionStyle}
            onClick={restartPrepositionSession}
          >
            Start another 10
          </button>

          <button
            className="nav-button"
            style={secondaryActionStyle}
            onClick={() => switchExerciseType("translation")}
          >
            ← Back to learning
          </button>
        </div>
      </div>
    </main>
  );
}

if (exerciseType === "gap" && gapSession.finished) {
  return (
    <main className="app-page">
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="app-title">🧠 Learning Mode</h1>
          <p className="app-subtitle">Gap round complete.</p>
        </div>
      </div>

      <div className="card card-strong">
        <h2 className="section-title">
          Score: {gapSession.correct}/{gapSession.total}
        </h2>

        <p style={{ marginTop: 12 }}>
          {encouragementForScore(gapSession.correct, gapSession.total)}
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <button
            className="primary-button"
            style={primaryActionStyle}
            onClick={restartGapSession}
          >
            Start another 10
          </button>

          <button
            className="nav-button"
            style={secondaryActionStyle}
            onClick={() => switchExerciseType("translation")}
          >
            ← Back to learning
          </button>
        </div>
      </div>
    </main>
  );
}

return (
  <main className="app-page">
    <div className="page-header">
      <div className="page-header-main">
        <h1 className="app-title">🧠 Learning Mode</h1>
        <p className="app-subtitle">
          Practice translating, filling gaps, prepositions, and recognizing phrase usage.
        </p>
      </div>

      <div className="page-header-side">
        <Link href="/" className="link-reset">
          <span className="nav-button">← Back</span>
        </Link>
      </div>
    </div>

    <div className="card card-strong" style={{ marginBottom: 24 }}>
      <h2 className="section-title">
        {exerciseType === "translation"
          ? "Translate into Danish"
          : exerciseType === "gap"
          ? `Gap round ${gapSession.current}/${gapSession.total}`
          : `Preposition quest ${prepositionSession.current}/${prepositionSession.total}`}
      </h2>

      {exerciseType === "gap" && (
        <p className="meta-text" style={{ marginBottom: 12 }}>
          Score so far: {gapSession.correct}/{answeredGapQuestions}
        </p>
      )}

      {exerciseType === "preposition" && (
        <p className="meta-text" style={{ marginBottom: 12 }}>
          Score so far: {prepositionSession.correct}/{answeredPrepositionQuestions}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          className={exerciseType === "translation" ? "primary-button" : "nav-button"}
          style={modeButtonStyle(exerciseType === "translation")}
          onClick={() => switchExerciseType("translation")}
        >
          Translation
        </button>

        <button
          className={exerciseType === "gap" ? "primary-button" : "nav-button"}
          style={modeButtonStyle(exerciseType === "gap")}
          onClick={() => switchExerciseType("gap")}
          disabled={!hasAnyGapExercise}
        >
          Gap
        </button>

        <button
          className={exerciseType === "preposition" ? "primary-button" : "nav-button"}
          style={modeButtonStyle(exerciseType === "preposition")}
          onClick={() => switchExerciseType("preposition")}
          disabled={!hasAnyPrepositionQuest}
        >
          Prepositions
        </button>
      </div>

      {exerciseType === "translation" ? (
        <>
          <p className="meta-text" style={{ marginBottom: 12 }}>
            English prompt:
          </p>

          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 18 }}>
            {englishPrompt}
          </div>

          {requireTargetPhrase && (
            <p className="meta-text" style={{ marginBottom: 14 }}>
              Use this phrase: <strong>{targetPhrase}</strong>
            </p>
          )}

          <label className="meta-text" style={{ display: "block", marginBottom: 8 }}>
            Your answer
          </label>

          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write your Danish sentence..."
            rows={4}
            style={{
              width: "100%",
              padding: 14,
              borderRadius: 14,
              border: "1px solid #d1d5db",
              fontSize: 16,
              marginBottom: 14,
            }}
          />

          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={requireTargetPhrase}
              onChange={(e) => setRequireTargetPhrase(e.target.checked)}
            />
            Require target phrase
          </label>
        </>
      ) : exerciseType === "gap" ? (
        <>
          <p className="meta-text" style={{ marginBottom: 12 }}>
            Choose the word that fits:
          </p>

          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 18 }}>
            {gapExercise?.prompt}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            {gapExercise?.options.map((option, optionIndex) => (
              <button
                key={`${option}-${optionIndex}`}
                className={answer === option ? "primary-button" : "nav-button"}
                style={optionButtonStyle(answer === option)}
                onClick={() => {
                  setAnswer(option);
                  setResult(null);
                }}
                disabled={checking || !!result}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="meta-text" style={{ marginBottom: 12 }}>
            Fill in the missing prepositions:
          </p>

          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 18 }}>
            {prepositionQuest?.prompt}
          </div>

          {prepositionQuest?.answers.map((_, index) => (
            <div key={index} style={{ marginBottom: 16 }}>
              <p className="meta-text" style={{ marginBottom: 8 }}>
                {prepositionQuest.answers.length === 1
                  ? "Choose the right preposition"
                  : `Blank ${index + 1}`}
              </p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {prepositionQuest.options.map((option, optionIndex) => (
                  <button
                    key={`${index}-${option}-${optionIndex}`}
                    className={
                      prepositionAnswers[index] === option
                        ? "primary-button"
                        : "nav-button"
                    }
                    style={optionButtonStyle(prepositionAnswers[index] === option)}
                    onClick={() => {
                      setPrepositionAnswers((prev) => {
                        const next = [...prev];
                        next[index] = option;
                        return next;
                      });
                      setResult(null);
                    }}
                    disabled={checking || prepositionChecked}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
        <button
          className="nav-button"
          style={primaryActionStyle}
          onClick={checkAnswer}
          disabled={isCheckDisabled}
        >
          {checking ? "Checking..." : "Check answer"}
        </button>

        <button
          className="nav-button"
          style={secondaryActionStyle}
          onClick={nextCard}
          disabled={
            checking ||
            (exerciseType === "preposition" && !prepositionChecked) ||
            (exerciseType === "gap" && !result)
          }
        >
          {exerciseType === "preposition"
            ? prepositionSession.current >= prepositionSession.total
              ? "Finish quest"
              : "Next →"
            : exerciseType === "gap"
            ? gapSession.current >= gapSession.total
              ? "Finish round"
              : "Next →"
            : "Next card →"}
        </button>
      </div>
    </div>

    {result && (
      <div className="card">
        <h2 className="section-title">Result: {result.status}</h2>

        <p style={{ marginTop: 10 }}>{result.feedback_da}</p>

        {(exerciseType === "preposition" || exerciseType === "gap") && englishPrompt && (
          <p style={{ marginTop: 12 }}>
            <strong>English:</strong> {englishPrompt}
          </p>
        )}

        {result.corrected_answer_da && (
          <p style={{ marginTop: 12 }}>
            <strong>
              {exerciseType === "translation"
                ? "Suggested version:"
                : "Full sentence:"}
            </strong>{" "}
            {result.corrected_answer_da}
          </p>
        )}

        {exerciseType === "translation" && (
          <div className="meta-text" style={{ marginTop: 14 }}>
            Meaning OK: {result.meaning_ok ? "yes" : "no"} · Natural Danish:{" "}
            {result.natural_da ? "yes" : "no"} · Target phrase used:{" "}
            {result.target_phrase_used ? "yes" : "no"}
          </div>
        )}

        <p className="meta-text" style={{ marginTop: 12 }}>
          Reference: {referenceAnswer}
        </p>
      </div>
    )}
  </main>
);
}
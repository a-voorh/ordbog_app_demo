"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

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

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

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

  const options = shuffle([
    wordToHide,
    ...shuffle(distractorPool.filter((item) => item !== normalizedAnswer)).slice(0, 3),
  ]);

  return {
    prompt: sentence.replace(regex, "_____"),
    answer: wordToHide,
    options,
    fullSentence: sentence,
  };
};

export default function LearningPage() {
  const [cards, setCards] = useState<PhraseCard[]>([]);
  const [card, setCard] = useState<PhraseCard | null>(null);
  const [answer, setAnswer] = useState("");
  const [requireTargetPhrase, setRequireTargetPhrase] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exerciseType, setExerciseType] = useState<"translation" | "gap">(
    "translation"
  );

  const englishPrompt = card?.example_en || card?.translation_en || "";
  const referenceAnswer = card?.example_da || card?.phrase || "";
  const targetPhrase = card?.phrase || "";

  const gapExercise = useMemo(() => {
    return card?.example_da ? makeGapExercise(card.example_da, card.phrase) : null;
  }, [card]);

  const pickRandomCard = (list: PhraseCard[]) => {
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  };

  const loadCards = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("phrases")
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

    setCards(loadedCards);
    setCard(pickRandomCard(loadedCards));
    setAnswer("");
    setResult(null);
    setLoading(false);
  };

  const nextCard = () => {
    if (!cards.length) return;

    let next;
    do {
      next = pickRandomCard(cards);
    } while (next?.id === card?.id && cards.length > 1);

    setCard(next);
    setAnswer("");
    setResult(null);
  };

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
      .from("phrases")
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
          ? {
              ...item,
              ...updates,
              learning_attempted: nextAttempted,
              last_learning_at: nowIso,
            }
          : item
      )
    );

    setCard((prev) =>
      prev?.id === cardToUpdate.id
        ? {
            ...prev,
            ...updates,
            learning_attempted: nextAttempted,
            last_learning_at: nowIso,
          }
        : prev
    );
  };

  useEffect(() => {
    loadCards();
  }, []);

  const checkAnswer = async () => {
    if (!answer.trim() || !card) return;

    setChecking(true);
    setResult(null);

    try {
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

        setResult({
          status: isCorrect ? "correct" : "wrong",
          meaning_ok: isCorrect,
          natural_da: isCorrect,
          target_phrase_used: isCorrect,
          feedback_da: isCorrect ? "Correct." : "Incorrect.",
          corrected_answer_da: gapExercise.fullSentence,
        });

        await recordLearningResult(card, isCorrect ? "correct" : "wrong");
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
      await recordLearningResult(card, data.status);
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <main className="app-page">
        <div className="card">Loading learning mode...</div>
      </main>
    );
  }

  if (!card) {
    return (
      <main className="app-page">
        <div className="card">No cards found.</div>
      </main>
    );
  }

  return (
    <main className="app-page">
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="app-title">🧠 Learning Mode</h1>
          <p className="app-subtitle">
            Practice translating, filling gaps, and recognizing phrase usage.
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
            : "Choose the missing word"}
        </h2>

        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <button
            className={exerciseType === "translation" ? "primary-button" : "nav-button"}
            onClick={() => {
              setExerciseType("translation");
              setAnswer("");
              setResult(null);
            }}
          >
            Translation
          </button>

          <button
            className={exerciseType === "gap" ? "primary-button" : "nav-button"}
            onClick={() => {
              setExerciseType("gap");
              setAnswer("");
              setResult(null);
            }}
            disabled={!gapExercise}
          >
            Multiple choice gap
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
        ) : (
          <>
            <p className="meta-text" style={{ marginBottom: 12 }}>
              Choose the word that fits:
            </p>

            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 18 }}>
              {gapExercise?.prompt}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
              {gapExercise?.options.map((option) => (
                <button
                  key={option}
                  className={answer === option ? "primary-button" : "nav-button"}
                  onClick={() => {
                    setAnswer(option);
                    setResult(null);
                  }}
                  disabled={checking}
                >
                  {option}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="controls-row-spread">
          <button
            className="nav-button"
            onClick={checkAnswer}
            disabled={checking || !answer.trim()}
          >
            {checking ? "Checking..." : "Check answer"}
          </button>

          <button className="nav-button" onClick={nextCard} disabled={checking}>
            Next card →
          </button>
        </div>
      </div>

      {result && (
        <div className="card">
          <h2 className="section-title">Result: {result.status}</h2>

          <p style={{ marginTop: 10 }}>{result.feedback_da}</p>

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
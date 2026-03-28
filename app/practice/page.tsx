"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type PhraseCard = {
  id: string;
  phrase: string;
  translation_en: string;
  short_explanation: string;
  example_da: string;
  example_en: string;
  extra_info?: string | null;
  created_at: string;
  tags: string[];
  times_attempted: number;
  times_correct: number;
  times_almost: number;
  times_wrong: number;
  last_practiced_at: string | null;
};

type PhraseDraft = {
  id: string;
  phrase: string;
  translation_en: string;
  short_explanation: string;
  example_da: string;
  example_en: string;
  extra_info?: string | null;
  tags: string[];
  created_at: string;
  source: string;
};

type Message = {
  role: "assistant" | "user";
  content: string;
};

type PhraseFeedback = {
  phrase: string;
  status: "correct" | "almost" | "wrong" | "unused";
  comment: string;
  suggestion: string;
  detectedText: string;
  sentenceIssue: "none" | "minor" | "major";
  sentenceComment: string;
};

type PracticeResponse = {
  reply: string;
  phraseFeedback: PhraseFeedback[];
};

type AnalyzeResult = {
  corrected_phrase: string;
  translation_en: string;
  short_explanation_da: string;
  example_da: string;
  example_en: string;
  extra_info: string;
};

type LookupResult = {
  corrected_phrase: string;
  translation_en: string;
  short_explanation_da: string;
  example_da: string;
  example_en: string;
  extra_info: string;
};

type PracticeSource = "all" | "selected" | string;

type RetryState = {
  baseMessages: Message[];
  originalUserMessage: string;
  originalFeedback: PhraseFeedback[];
};

const normalizePhraseKey = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const sortKeyDa = (phrase: string) => phrase.trim().replace(/^at\s+/i, "");

const sortByPhraseDa = (cards: PhraseCard[]) =>
  [...cards].sort((a, b) =>
    sortKeyDa(a.phrase).localeCompare(sortKeyDa(b.phrase), "da")
  );

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function PracticePage() {
  const [cards, setCards] = useState<PhraseCard[]>([]);
  const [selectedCards, setSelectedCards] = useState<PhraseCard[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [practiceCount, setPracticeCount] = useState<number>(3);
  const [practiceSource, setPracticeSource] = useState<PracticeSource>("all");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastPhraseFeedback, setLastPhraseFeedback] = useState<PhraseFeedback[]>([]);
  const [usedPhraseSet, setUsedPhraseSet] = useState<string[]>([]);

  const [addFromMessageIndex, setAddFromMessageIndex] = useState<number | null>(null);
  const [candidatePhrase, setCandidatePhrase] = useState("");
  const [addingPhrase, setAddingPhrase] = useState(false);
  const [addPhraseStatus, setAddPhraseStatus] = useState<string | null>(null);

  const [hoveredPhraseId, setHoveredPhraseId] = useState<string | null>(null);

  const [messageTranslations, setMessageTranslations] = useState<Record<number, string>>({});
  const [showTranslationByMessage, setShowTranslationByMessage] = useState<Record<number, boolean>>({});
  const [translatingMessageIndex, setTranslatingMessageIndex] = useState<number | null>(null);

  const [draftSavedMessage, setDraftSavedMessage] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<RetryState | null>(null);

  const [reviewingSecondOpinion, setReviewingSecondOpinion] = useState(false);
  const [secondOpinionNote, setSecondOpinionNote] = useState<string | null>(null);

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupEnglish, setLookupEnglish] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupStatus, setLookupStatus] = useState<string | null>(null);
  const [savingLookupDraft, setSavingLookupDraft] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [showEnglishInHover, setShowEnglishInHover] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const draftSavedTimeoutRef = useRef<number | null>(null);
  const secondOpinionTimeoutRef = useRef<number | null>(null);
  const lookupInputRef = useRef<HTMLInputElement | null>(null);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const card of cards) {
      for (const tag of card.tags || []) {
        if (tag.trim()) tags.add(tag.trim());
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b, "da"));
  }, [cards]);

  const daysSinceLastPracticed = (card: PhraseCard) => {
    if (!card.last_practiced_at) return null;

    const diffMs = Date.now() - new Date(card.last_practiced_at).getTime();
    return diffMs / (1000 * 60 * 60 * 24);
  };

  const effectiveMasteryScore = (card: PhraseCard) => {
    if ((card.times_attempted ?? 0) === 0) return 0;

    const base =
      ((card.times_correct ?? 0) + 0.8 * (card.times_almost ?? 0)) /
      (card.times_attempted ?? 0);

    const days = daysSinceLastPracticed(card);

    let confidenceBonus = 0;
    if ((card.times_attempted ?? 0) >= 6) confidenceBonus = 0.12;
    else if ((card.times_attempted ?? 0) >= 3) confidenceBonus = 0.08;
    else confidenceBonus = 0.04;

    let stalePenalty = 0;
    if (days !== null) {
      if (days > 30) stalePenalty = 0.18;
      else if (days > 14) stalePenalty = 0.1;
      else if (days > 7) stalePenalty = 0.05;
    }

    return Math.max(0, Math.min(1, base + confidenceBonus - stalePenalty));
  };

  const getPrioritySorted = (pool: PhraseCard[]) => {
    return [...pool].sort((a, b) => {
      const aDays = daysSinceLastPracticed(a) ?? -1;
      const bDays = daysSinceLastPracticed(b) ?? -1;

      const stalenessBoostA = aDays > 14 ? -0.15 : aDays > 7 ? -0.08 : 0;
      const stalenessBoostB = bDays > 14 ? -0.15 : bDays > 7 ? -0.08 : 0;

      const aScore = effectiveMasteryScore(a) + stalenessBoostA;
      const bScore = effectiveMasteryScore(b) + stalenessBoostB;

      return aScore - bScore;
    });
  };

  const pickPracticeCards = (
    allCards: PhraseCard[],
    count: number,
    preferredSource: PracticeSource,
    selectedPhraseIds: string[]
  ) => {
    let preferredPool: PhraseCard[] = [];
    let fallbackPool: PhraseCard[] = [];

    if (preferredSource === "selected" && selectedPhraseIds.length > 0) {
      preferredPool = allCards.filter((card) => selectedPhraseIds.includes(card.id));
      fallbackPool = allCards.filter((card) => !selectedPhraseIds.includes(card.id));
    } else if (preferredSource !== "all") {
      preferredPool = allCards.filter((card) => (card.tags || []).includes(preferredSource));
      fallbackPool = allCards.filter((card) => !(card.tags || []).includes(preferredSource));
    } else {
      preferredPool = allCards;
      fallbackPool = [];
    }

    const pickedFromPreferred = getPrioritySorted(preferredPool).slice(0, count);

    if (pickedFromPreferred.length >= count) return pickedFromPreferred;

    const remainingCount = count - pickedFromPreferred.length;
    const pickedFromFallback = getPrioritySorted(fallbackPool).slice(0, remainingCount);

    return [...pickedFromPreferred, ...pickedFromFallback];
  };

  const loadCardsFromSupabase = async () => {
    const { data, error } = await supabase.from("phrases").select("*");

    if (error) {
      console.error("Failed to load phrases:", error);
      return [];
    }

    return sortByPhraseDa((data || []) as PhraseCard[]);
  };

  const analyzePhrase = async (phrase: string) => {
    const res = await fetch("/api/analyze-phrase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phrase }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Analyze phrase backend error:", data);
      return null;
    }

    try {
      return JSON.parse(data.result) as AnalyzeResult;
    } catch {
      console.error("Invalid JSON from analyze phrase route:", data.result);
      return null;
    }
  };

  const lookupWord = async () => {
    const english = lookupEnglish.trim();
    if (!english) return;

    setLookupLoading(true);
    setLookupStatus(null);
    setLookupResult(null);

    try {
      const res = await fetch("/api/lookup-word", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ english }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Lookup backend error:", data);
        setLookupStatus("Could not look that up.");
        return;
      }

      try {
        const parsed = JSON.parse(data.result) as LookupResult;
        setLookupResult(parsed);
      } catch {
        console.error("Invalid JSON from lookup route:", data.result);
        setLookupStatus("Lookup returned invalid data.");
      }
    } catch (err) {
      console.error("Failed to look up word:", err);
      setLookupStatus("Could not look that up.");
    } finally {
      setLookupLoading(false);
    }
  };

  const saveLookupResultAsDraft = async () => {
    if (!lookupResult) return;

    setSavingLookupDraft(true);
    setLookupStatus(null);

    try {
      const correctedPhrase = lookupResult.corrected_phrase.trim();
      const newKey = normalizePhraseKey(correctedPhrase);

      const duplicateInCards = cards.some(
        (card) => normalizePhraseKey(card.phrase) === newKey
      );

      if (duplicateInCards) {
        setLookupStatus(`Already in database: ${correctedPhrase}`);
        return;
      }

      const { data: existingDrafts, error: draftsLoadError } = await supabase
        .from("phrase_drafts")
        .select("phrase");

      if (draftsLoadError) {
        console.error("Failed to check existing drafts:", draftsLoadError);
        setLookupStatus("Could not check drafts.");
        return;
      }

      const duplicateInDrafts = (existingDrafts || []).some(
        (draft: { phrase: string }) =>
          normalizePhraseKey(draft.phrase) === newKey
      );

      if (duplicateInDrafts) {
        setLookupStatus(`Already waiting in drafts: ${correctedPhrase}`);
        return;
      }

      const autoTags =
        practiceSource !== "all" && practiceSource !== "selected"
          ? [practiceSource]
          : [];

      const newDraft: PhraseDraft = {
        id: crypto.randomUUID(),
        phrase: correctedPhrase,
        translation_en: lookupResult.translation_en,
        short_explanation: lookupResult.short_explanation_da,
        example_da: lookupResult.example_da,
        example_en: lookupResult.example_en,
        extra_info: lookupResult.extra_info,
        tags: autoTags,
        created_at: new Date().toISOString(),
        source: "lookup",
      };

      const { error } = await supabase.from("phrase_drafts").insert(newDraft);

      if (error) {
        console.error("Failed to save lookup draft:", error);
        setLookupStatus("Failed to save draft.");
        return;
      }

      setLookupStatus(`Draft created: ${correctedPhrase}`);
    } catch (err) {
      console.error("Failed to save lookup draft:", err);
      setLookupStatus("Something went wrong.");
    } finally {
      setSavingLookupDraft(false);
    }
  };

  const toggleLookupOpen = () => {
    setLookupOpen((prev) => !prev);
  };

  const translateAssistantMessage = async (messageIndex: number, text: string) => {
    if (messageTranslations[messageIndex]) {
      setShowTranslationByMessage((prev) => ({
        ...prev,
        [messageIndex]: !prev[messageIndex],
      }));
      return;
    }

    setTranslatingMessageIndex(messageIndex);

    try {
      const res = await fetch("/api/translate-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Translate backend error:", data);
        return;
      }

      const translation = data.translation ?? "";

      setMessageTranslations((prev) => ({
        ...prev,
        [messageIndex]: translation,
      }));

      setShowTranslationByMessage((prev) => ({
        ...prev,
        [messageIndex]: true,
      }));
    } catch (err) {
      console.error("Failed to translate message:", err);
    } finally {
      setTranslatingMessageIndex(null);
    }
  };

  const applyCardUpdates = async (
    updater: (prevCards: PhraseCard[]) => PhraseCard[]
  ) => {
    setCards((prevCards) => {
      const updatedCards = updater(prevCards);

      void Promise.all(
        updatedCards.map((card) =>
          supabase
            .from("phrases")
            .update({
              times_attempted: card.times_attempted,
              times_correct: card.times_correct,
              times_almost: card.times_almost,
              times_wrong: card.times_wrong,
              last_practiced_at: card.last_practiced_at,
            })
            .eq("id", card.id)
        )
      ).then((results) => {
        const failed = results.find((result) => result.error);
        const failedError = failed?.error;

        if (failedError) {
          console.error("Failed to update phrase stats:", failedError);
        }
      });

      return updatedCards;
    });
  };

  useEffect(() => {
    const initialize = async () => {
      const loadedCards = await loadCardsFromSupabase();
      setCards(loadedCards);

      const storedSelectedIds = localStorage.getItem("selected_phrase_ids");

      let parsedSelectedIds: string[] = [];

      if (storedSelectedIds) {
        try {
          parsedSelectedIds = JSON.parse(storedSelectedIds);
        } catch {
          parsedSelectedIds = [];
        }
      }

      setSelectedIds(parsedSelectedIds);
      setPracticeSource(parsedSelectedIds.length > 0 ? "selected" : "all");

      if (parsedSelectedIds.length > 0) {
        localStorage.removeItem("selected_phrase_ids");
      }
    };

    void initialize();
  }, []);

  useEffect(() => {
    if (messages.length > 0) return;

    const picked = pickPracticeCards(cards, practiceCount, practiceSource, selectedIds);
    setSelectedCards(picked);
  }, [cards, practiceCount, practiceSource, selectedIds, messages.length]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, lastPhraseFeedback]);

  useEffect(() => {
    if (lookupOpen) {
      setTimeout(() => {
        lookupInputRef.current?.focus();
      }, 0);
    }
  }, [lookupOpen]);

  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 720;
    if (isMobile) {
      setFeedbackOpen(false);
      setTargetsOpen(true);
    } else {
      setFeedbackOpen(true);
      setTargetsOpen(true);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (draftSavedTimeoutRef.current !== null) {
        window.clearTimeout(draftSavedTimeoutRef.current);
      }
      if (secondOpinionTimeoutRef.current !== null) {
        window.clearTimeout(secondOpinionTimeoutRef.current);
      }
    };
  }, []);

  const resetSessionUi = () => {
    setMessages([]);
    setLastPhraseFeedback([]);
    setUsedPhraseSet([]);
    setInput("");
    setAddFromMessageIndex(null);
    setCandidatePhrase("");
    setAddPhraseStatus(null);
    setAddingPhrase(false);
    setMessageTranslations({});
    setShowTranslationByMessage({});
    setTranslatingMessageIndex(null);
    setDraftSavedMessage(null);
    setRetryState(null);
    setReviewingSecondOpinion(false);
    setSecondOpinionNote(null);

    if (draftSavedTimeoutRef.current !== null) {
      window.clearTimeout(draftSavedTimeoutRef.current);
      draftSavedTimeoutRef.current = null;
    }
    if (secondOpinionTimeoutRef.current !== null) {
      window.clearTimeout(secondOpinionTimeoutRef.current);
      secondOpinionTimeoutRef.current = null;
    }
  };

  const endSession = () => {
    resetSessionUi();
  };

  const startPractice = async (cardsToPractice = selectedCards) => {
    if (cardsToPractice.length === 0) return;

    setLoading(true);
    resetSessionUi();

    try {
      const res = await fetch("/api/practice-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cards: cardsToPractice,
          history: [],
          userMessage: "",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Backend error:", data);
        return;
      }

      const parsed: PracticeResponse = JSON.parse(data.result);
      setMessages([{ role: "assistant", content: parsed.reply }]);

      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (err) {
      console.error("Failed to start practice:", err);
    } finally {
      setLoading(false);
    }
  };

  const startNewWeakPhrasePractice = async () => {
    const freshCards = await loadCardsFromSupabase();
    setCards(freshCards);

    const newSelection = pickPracticeCards(
      freshCards,
      practiceCount,
      practiceSource,
      selectedIds
    );
    setSelectedCards(newSelection);

    await startPractice(newSelection);
  };

  const getFeedbackStatusMap = (feedback: PhraseFeedback[]) => {
    const map = new Map<string, PhraseFeedback["status"]>();
    for (const item of feedback) {
      map.set(item.phrase, item.status);
    }
    return map;
  };

  const getCountedRetryStatus = (
    oldStatus: PhraseFeedback["status"],
    newStatus: PhraseFeedback["status"]
  ): PhraseFeedback["status"] => {
    if (newStatus === "unused") return "unused";
    if (newStatus === "wrong") return "wrong";
    if (newStatus === "almost") return "almost";
    if (oldStatus === "wrong" || oldStatus === "almost") return "almost";
    return "correct";
  };

  const addRetryNotesToFeedback = (
    newFeedback: PhraseFeedback[],
    oldFeedback: PhraseFeedback[]
  ) => {
    const oldStatusMap = getFeedbackStatusMap(oldFeedback);

    return newFeedback.map((item) => {
      const oldStatus = oldStatusMap.get(item.phrase) ?? "unused";

      if (item.status === "correct" && (oldStatus === "wrong" || oldStatus === "almost")) {
        const retryNote = "Correct on retry — counted as almost for stats.";

        return {
          ...item,
          comment: item.comment ? `${item.comment} ${retryNote}` : retryNote,
        };
      }

      return item;
    });
  };

  const reconcileRetryStats = (
    prevCards: PhraseCard[],
    oldFeedback: PhraseFeedback[],
    newFeedback: PhraseFeedback[],
    nowIso: string
  ) => {
    const oldStatusMap = getFeedbackStatusMap(oldFeedback);
    const newStatusMap = getFeedbackStatusMap(newFeedback);

    return prevCards.map((card) => {
      const oldStatus = oldStatusMap.get(card.phrase) ?? "unused";
      const rawNewStatus = newStatusMap.get(card.phrase) ?? "unused";
      const newCountedStatus = getCountedRetryStatus(oldStatus, rawNewStatus);

      const oldAttempted = oldStatus !== "unused" ? 1 : 0;
      const newAttempted = newCountedStatus !== "unused" ? 1 : 0;

      const oldCorrect = oldStatus === "correct" ? 1 : 0;
      const oldAlmost = oldStatus === "almost" ? 1 : 0;
      const oldWrong = oldStatus === "wrong" ? 1 : 0;

      const newCorrect = newCountedStatus === "correct" ? 1 : 0;
      const newAlmost = newCountedStatus === "almost" ? 1 : 0;
      const newWrong = newCountedStatus === "wrong" ? 1 : 0;

      const attemptDelta = newAttempted - oldAttempted;
      const correctDelta = newCorrect - oldCorrect;
      const almostDelta = newAlmost - oldAlmost;
      const wrongDelta = newWrong - oldWrong;

      if (
        attemptDelta === 0 &&
        correctDelta === 0 &&
        almostDelta === 0 &&
        wrongDelta === 0
      ) {
        return card;
      }

      return {
        ...card,
        times_attempted: Math.max(0, (card.times_attempted ?? 0) + attemptDelta),
        times_correct: Math.max(0, (card.times_correct ?? 0) + correctDelta),
        times_almost: Math.max(0, (card.times_almost ?? 0) + almostDelta),
        times_wrong: Math.max(0, (card.times_wrong ?? 0) + wrongDelta),
        last_practiced_at: nowIso,
      };
    });
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    if (messages.length === 0 && !retryState) return;

    const userText = input.trim();
    const historyBase = retryState ? retryState.baseMessages : messages;

    const newUserMessage: Message = { role: "user", content: userText };
    const newHistory: Message[] = [...historyBase, newUserMessage];

    setMessages(newHistory);
    setInput("");
    setLoading(true);
    setLastPhraseFeedback([]);
    setAddFromMessageIndex(null);
    setCandidatePhrase("");
    setAddPhraseStatus(null);
    setSecondOpinionNote(null);

    try {
      const res = await fetch("/api/practice-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cards: selectedCards,
          history: historyBase,
          userMessage: userText,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Backend error:", data);
        return;
      }

      const parsed: PracticeResponse = JSON.parse(data.result);
      const assistantMessage: Message = {
        role: "assistant",
        content: parsed.reply,
      };

      setMessages([...newHistory, assistantMessage]);

      const rawFeedback = parsed.phraseFeedback || [];
      const feedbackForDisplay = retryState
        ? addRetryNotesToFeedback(rawFeedback, retryState.originalFeedback)
        : rawFeedback;

      setLastPhraseFeedback(feedbackForDisplay);

      const correctlyUsed = feedbackForDisplay
        .filter((item) => item.status === "correct")
        .map((item) => item.phrase);

      setUsedPhraseSet((prev) => Array.from(new Set([...prev, ...correctlyUsed])));

      if (feedbackForDisplay.some((item) => item.status !== "unused")) {
        setFeedbackOpen(true);
      }

      const nowIso = new Date().toISOString();

      if (retryState) {
        applyCardUpdates((prevCards) =>
          reconcileRetryStats(prevCards, retryState.originalFeedback, rawFeedback, nowIso)
        );
        setRetryState(null);
      } else {
        applyCardUpdates((prevCards) =>
          prevCards.map((card) => {
            const item = rawFeedback.find((f) => f.phrase === card.phrase);
            if (!item || item.status === "unused") return card;

            const updated = {
              ...card,
              times_attempted: (card.times_attempted ?? 0) + 1,
              last_practiced_at: nowIso,
            };

            if (item.status === "correct") {
              updated.times_correct = (card.times_correct ?? 0) + 1;
            }

            if (item.status === "almost") {
              updated.times_almost = (card.times_almost ?? 0) + 1;
            }

            if (item.status === "wrong") {
              updated.times_wrong = (card.times_wrong ?? 0) + 1;
            }

            return updated;
          })
        );
      }

      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setLoading(false);
    }
  };

  const startTryAgain = () => {
    if (messages.length < 2) return;
    if (messages[messages.length - 1]?.role !== "assistant") return;
    if (lastPhraseFeedback.every((item) => item.status === "unused")) return;

    const latestUserIndex =
      [...messages]
        .map((m, i) => ({ ...m, i }))
        .filter((m) => m.role === "user")
        .slice(-1)[0]?.i ?? -1;

    if (latestUserIndex < 0) return;

    const originalUserMessage = messages[latestUserIndex]?.content ?? "";
    const baseMessages = messages.slice(0, latestUserIndex);

    setRetryState({
      baseMessages,
      originalUserMessage,
      originalFeedback: lastPhraseFeedback,
    });

    setMessages(baseMessages);
    setInput(originalUserMessage);
    setLastPhraseFeedback([]);
    setAddFromMessageIndex(null);
    setCandidatePhrase("");
    setAddPhraseStatus(null);
    setSecondOpinionNote(null);

    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const requestSecondOpinion = async () => {
    if (reviewingSecondOpinion) return;
    if (lastPhraseFeedback.every((item) => item.status === "unused")) return;

    const latestUserMessage =
      [...messages]
        .reverse()
        .find((msg) => msg.role === "user")
        ?.content ?? "";

    if (!latestUserMessage) return;

    setReviewingSecondOpinion(true);
    setSecondOpinionNote(null);

    try {
      const res = await fetch("/api/practice-second-opinion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cards: selectedCards,
          history: messages,
          userMessage: latestUserMessage,
          currentFeedback: lastPhraseFeedback,
          retryState: retryState
            ? {
                originalFeedback: retryState.originalFeedback,
              }
            : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Second opinion backend error:", data);
        setSecondOpinionNote("Could not get a second opinion.");
        return;
      }

      const revisedFeedback = data.phraseFeedback as PhraseFeedback[] | undefined;

      if (Array.isArray(revisedFeedback)) {
        const displayFeedback = retryState
          ? addRetryNotesToFeedback(revisedFeedback, retryState.originalFeedback)
          : revisedFeedback;

        setLastPhraseFeedback(displayFeedback);

        const revisedCorrectSet = new Set(
          displayFeedback
            .filter((item) => item.status === "correct")
            .map((item) => item.phrase)
        );

        const revisedMentionedPhrases = new Set(
          displayFeedback
            .filter((item) => item.status !== "unused")
            .map((item) => item.phrase)
        );

        setUsedPhraseSet((prev) => {
          const next = new Set(prev);

          for (const phrase of revisedMentionedPhrases) {
            if (revisedCorrectSet.has(phrase)) {
              next.add(phrase);
            } else {
              next.delete(phrase);
            }
          }

          return Array.from(next);
        });

        setFeedbackOpen(true);
        setSecondOpinionNote("Second opinion applied.");

        if (secondOpinionTimeoutRef.current !== null) {
          window.clearTimeout(secondOpinionTimeoutRef.current);
        }

        secondOpinionTimeoutRef.current = window.setTimeout(() => {
          setSecondOpinionNote(null);
          secondOpinionTimeoutRef.current = null;
        }, 2600);
      } else {
        setSecondOpinionNote("Second opinion returned no feedback.");
      }
    } catch (err) {
      console.error("Failed to get second opinion:", err);
      setSecondOpinionNote("Could not get a second opinion.");
    } finally {
      setReviewingSecondOpinion(false);
    }
  };

  const regenerateAnswer = async () => {
    if (messages.length === 0) return;
    if (messages[messages.length - 1]?.role !== "assistant") return;

    const historyWithoutLastAssistant = messages.slice(0, -1);

    setLoading(true);
    setAddFromMessageIndex(null);
    setCandidatePhrase("");
    setAddPhraseStatus(null);
    setSecondOpinionNote(null);

    try {
      const res = await fetch("/api/practice-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cards: selectedCards,
          history: historyWithoutLastAssistant,
          userMessage: "",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Backend error:", data);
        return;
      }

      const parsed: PracticeResponse = JSON.parse(data.result);
      const newAssistantIndex = historyWithoutLastAssistant.length;

      setMessages([
        ...historyWithoutLastAssistant,
        { role: "assistant", content: parsed.reply },
      ]);

      setMessageTranslations((prev) => {
        const updated = { ...prev };
        delete updated[newAssistantIndex];
        return updated;
      });

      setShowTranslationByMessage((prev) => {
        const updated = { ...prev };
        delete updated[newAssistantIndex];
        return updated;
      });

      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (err) {
      console.error("Failed to regenerate answer:", err);
    } finally {
      setLoading(false);
    }
  };

  const openAddPhraseFromMessage = (messageIndex: number) => {
    const selectedText = window.getSelection?.()?.toString().trim() || "";
    setAddFromMessageIndex(messageIndex);
    setCandidatePhrase(selectedText);
    setAddPhraseStatus(null);
  };

  const savePhraseFromMessage = async () => {
    const rawPhrase = candidatePhrase.trim();
    if (!rawPhrase) return;

    setAddingPhrase(true);
    setAddPhraseStatus(null);

    try {
      const parsed = await analyzePhrase(rawPhrase);
      if (!parsed) {
        setAddPhraseStatus("Could not analyze that phrase.");
        return;
      }

      const correctedPhrase = parsed.corrected_phrase.trim();
      const newKey = normalizePhraseKey(correctedPhrase);

      const duplicateInCards = cards.some(
        (card) => normalizePhraseKey(card.phrase) === newKey
      );

      if (duplicateInCards) {
        setAddPhraseStatus(`Already in database: ${correctedPhrase}`);
        return;
      }

      const { data: existingDrafts, error: draftsLoadError } = await supabase
        .from("phrase_drafts")
        .select("phrase");

      if (draftsLoadError) {
        console.error("Failed to check existing drafts:", draftsLoadError);
        setAddPhraseStatus("Could not check drafts.");
        return;
      }

      const duplicateInDrafts = (existingDrafts || []).some(
        (draft: { phrase: string }) =>
          normalizePhraseKey(draft.phrase) === newKey
      );

      if (duplicateInDrafts) {
        setAddPhraseStatus(`Already waiting in drafts: ${correctedPhrase}`);
        return;
      }

      const autoTags =
        practiceSource !== "all" && practiceSource !== "selected"
          ? [practiceSource]
          : [];

      const newDraft: PhraseDraft = {
        id: crypto.randomUUID(),
        phrase: correctedPhrase,
        translation_en: parsed.translation_en,
        short_explanation: parsed.short_explanation_da,
        example_da: parsed.example_da,
        example_en: parsed.example_en,
        extra_info: parsed.extra_info,
        tags: autoTags,
        created_at: new Date().toISOString(),
        source: "practice",
      };

      const { error } = await supabase.from("phrase_drafts").insert(newDraft);

      if (error) {
        console.error("Failed to save phrase draft from message:", error);
        setAddPhraseStatus("Failed to save draft.");
        return;
      }

      setCandidatePhrase("");
      setAddFromMessageIndex(null);
      setAddPhraseStatus(null);

      setDraftSavedMessage(`Draft created: ${correctedPhrase}`);

      if (draftSavedTimeoutRef.current !== null) {
        window.clearTimeout(draftSavedTimeoutRef.current);
      }

      draftSavedTimeoutRef.current = window.setTimeout(() => {
        setDraftSavedMessage(null);
        draftSavedTimeoutRef.current = null;
      }, 2200);
    } catch (err) {
      console.error("Failed to add phrase draft from message:", err);
      setAddPhraseStatus("Something went wrong.");
    } finally {
      setAddingPhrase(false);
    }
  };

  const handleSendKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading && (messages.length > 0 || retryState) && !allPhrasesUsed) {
        void sendMessage();
      }
    }
  };

  const handleAddPhraseKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!addingPhrase) {
        void savePhraseFromMessage();
      }
    }
  };

  const handleLookupKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!lookupLoading) {
        void lookupWord();
      }
    }
  };

  const allPhrasesUsed =
    selectedCards.length > 0 &&
    selectedCards.every((card) => usedPhraseSet.includes(card.phrase));

  const getPhraseStatusSymbol = (phrase: string) => {
    const latest = lastPhraseFeedback.find((item) => item.phrase === phrase);

    if (usedPhraseSet.includes(phrase)) return "✓";
    if (latest?.status === "almost") return "~";
    if (latest?.status === "wrong") return "✗";
    return "○";
  };

  const highlightDetectedText = (message: string, feedback: PhraseFeedback[]) => {
    const matches = feedback
      .filter(
        (item) =>
          (item.status === "correct" ||
            item.status === "almost" ||
            item.status === "wrong") &&
          item.detectedText &&
          message.includes(item.detectedText)
      )
      .map((item) => item.detectedText)
      .filter((text, index, arr) => arr.indexOf(text) === index)
      .sort((a, b) => b.length - a.length);

    if (matches.length === 0) return message;

    const pattern = new RegExp(
      `(${matches.map((text) => escapeRegExp(text)).join("|")})`,
      "g"
    );

    const parts = message.split(pattern);

    return (
      <>
        {parts.map((part, index) =>
          matches.includes(part) ? <mark key={index}>{part}</mark> : part
        )}
      </>
    );
  };

  const latestUserMessageIndex =
    [...messages]
      .map((m, i) => ({ ...m, i }))
      .filter((m) => m.role === "user")
      .slice(-1)[0]?.i ?? -1;

  const canRegenerate =
    messages.length > 0 && messages[messages.length - 1]?.role === "assistant";

  const hasVisibleFeedback = lastPhraseFeedback.some((item) => item.status !== "unused");

  const practiceSourceLabel =
    practiceSource === "all"
      ? "All phrases"
      : practiceSource === "selected"
        ? "Selected phrases"
        : practiceSource;

  return (
    <main className="app-page">
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="app-title">📚 Mit ordforråd: ord for ord</h1>
          <p className="app-subtitle">Øvetilstand</p>
        </div>

        <div className="page-header-side">
          <Link href="/" className="link-reset">
            <span className="nav-button">← Back to Phrase Collector</span>
          </Link>
        </div>
      </div>

      <div className="card card-strong" style={{ marginBottom: 24 }}>
        <div
          className="controls-row-spread"
          style={{ marginBottom: settingsOpen ? 14 : 0 }}
        >
          <div>
            <h2 className="section-title" style={{ marginBottom: 4 }}>
              Conversation practice
            </h2>
            <div className="meta-text">
              Configure your session here, then start it from the chat area below.
            </div>
          </div>

          <button
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="button-secondary"
          >
            {settingsOpen ? "Hide settings" : "Show settings"}
          </button>
        </div>

        {settingsOpen && (
          <div className="mini-box" style={{ marginBottom: 0 }}>
            <h3 className="subsection-title">Practice settings</h3>

            <div className="controls-row">
              <div>
                <label className="meta-text" style={{ display: "block", marginBottom: 6 }}>
                  How many phrases?
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={practiceCount}
                  onChange={(e) =>
                    setPracticeCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                  }
                  className="text-input"
                  style={{ width: 120 }}
                />
              </div>

              <div>
                <label className="meta-text" style={{ display: "block", marginBottom: 6 }}>
                  Prefer phrases from
                </label>
                <select
                  value={practiceSource}
                  onChange={(e) => setPracticeSource(e.target.value)}
                  className="select-input"
                  style={{ minWidth: 220 }}
                >
                  <option value="all">All phrases</option>
                  {selectedIds.length > 0 && <option value="selected">Selected phrases</option>}
                  {allTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="meta-text" style={{ display: "block", marginBottom: 6 }}>
                  Hover card English
                </label>
                <button
                  onClick={() => setShowEnglishInHover((prev) => !prev)}
                  className="button-secondary"
                >
                  {showEnglishInHover ? "Hide English" : "Show English"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card card-quiet" style={{ marginBottom: 24 }}>
        <div className="controls-row-spread">
          <div>
            <h2 className="subsection-title" style={{ marginBottom: 4 }}>
              Quick lookup
            </h2>
            <div className="meta-text">
              Optional help if you get stuck on a word.
            </div>
          </div>

          <button onClick={toggleLookupOpen} className="button-secondary">
            {lookupOpen ? "Hide lookup" : "Open lookup"}
          </button>
        </div>

        {lookupOpen && (
          <div className="mini-box" style={{ marginTop: 14 }}>
            <div className="controls-row" style={{ alignItems: "flex-start" }}>
              <input
                ref={lookupInputRef}
                value={lookupEnglish}
                onChange={(e) => setLookupEnglish(e.target.value)}
                onKeyDown={handleLookupKeyDown}
                placeholder="Type English word or phrase..."
                className="text-input"
                style={{ width: "100%", maxWidth: 320 }}
              />

              <button
                onClick={() => void lookupWord()}
                disabled={lookupLoading || !lookupEnglish.trim()}
                className={`button-primary ${
                  lookupLoading || !lookupEnglish.trim() ? "button-disabled" : ""
                }`}
              >
                {lookupLoading ? "Looking up..." : "Look up"}
              </button>
            </div>

            {lookupStatus && (
              <div className="meta-text" style={{ marginTop: 10 }}>
                {lookupStatus}
              </div>
            )}

            {lookupResult && (
              <div style={{ marginTop: 14 }}>
                <p><b>Danish:</b> {lookupResult.corrected_phrase}</p>
                <p><b>Explanation:</b> {lookupResult.short_explanation_da}</p>
                <p><b>Example:</b> {lookupResult.example_da}</p>
                <p><b>English:</b> {lookupResult.translation_en}</p>
                <p><b>Example EN:</b> {lookupResult.example_en}</p>
                <p><b>Extra info:</b> {lookupResult.extra_info || "—"}</p>

                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={() => void saveLookupResultAsDraft()}
                    disabled={savingLookupDraft}
                    className={`button-secondary ${
                      savingLookupDraft ? "button-disabled" : ""
                    }`}
                  >
                    {savingLookupDraft ? "Saving..." : "Create draft"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ overflow: "visible", marginBottom: 24 }}>
        <div className="controls-row-spread" style={{ marginBottom: 10 }}>
          <div>
            <h2 className="subsection-title" style={{ marginBottom: 4 }}>
              Target phrases
            </h2>
            <div className="meta-text">
              Keep these visible while chatting.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => setShowEnglishInHover((prev) => !prev)}
              className="button-secondary"
            >
              {showEnglishInHover ? "Hide English" : "Show English"}
            </button>

            <button
              onClick={() => setTargetsOpen((prev) => !prev)}
              className="button-secondary"
            >
              {targetsOpen ? "Hide targets" : "Show targets"}
            </button>
          </div>
        </div>

        {targetsOpen && (
          <>
            {selectedCards.length === 0 ? (
              <p>No saved phrases yet. Go back and add some first.</p>
            ) : (
             <div
  style={{
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  }}
>
  {selectedCards.map((card) => (
    <div
      key={card.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        background: "#f3f4f6",
        fontSize: 13,
        cursor: "help",
        position: "relative",
      }}
      onClick={() => {
  const phraseToInsert = card.phrase;

  setInput((prev) => {
    if (!prev.trim()) return phraseToInsert;

    // avoid double spaces
    if (prev.endsWith(" ")) return prev + phraseToInsert;

    return prev + " " + phraseToInsert;
  });

  // focus back to textarea
  setTimeout(() => {
    inputRef.current?.focus();
  }, 0);
}}
      onMouseEnter={() => setHoveredPhraseId(card.id)}
      onMouseLeave={() =>
        setHoveredPhraseId((prev) => (prev === card.id ? null : prev))
      }
    >
      <span>{getPhraseStatusSymbol(card.phrase)}</span>

      <span style={{ fontWeight: 500 }}>
        {card.phrase}
      </span>

      {hoveredPhraseId === card.id && (
        <div
          style={{
            position: "absolute",
            top: "120%",
            left: 0,
            zIndex: 20,
            minWidth: 220,
            maxWidth: 300,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 10,
            boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {card.phrase}
          </div>

          {showEnglishInHover && (
            <div style={{ marginTop: 4, fontWeight: 500 }}>
              {card.translation_en}
            </div>
          )}

          <div style={{ marginTop: 4 }}>
            {card.short_explanation}
          </div>
        </div>
      )}
    </div>
  ))}
</div>
            )}

            {selectedCards.length > 0 && (
              <div className="badge badge-neutral">
                Progress: {usedPhraseSet.length} / {selectedCards.length} phrases used correctly
              </div>
            )}
          </>
        )}
      </div>

      <div className="chat-shell">
        <div
          className="controls-row-spread"
          style={{ marginBottom: 12, gap: 12, flexWrap: "wrap", alignItems: "center" }}
        >
          <div>
            <h2 className="section-title" style={{ marginBottom: 4 }}>
              Chat
            </h2>
            <div className="meta-text">
              {selectedCards.length > 0
                ? `${selectedCards.length} target phrase${selectedCards.length === 1 ? "" : "s"} selected`
                : "No target phrases selected yet"}
            </div>
            <div className="meta-text">
              Source: {practiceSourceLabel} · Count: {practiceCount}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => setSettingsOpen((prev) => !prev)}
              className="button-secondary"
            >
              {settingsOpen ? "Hide settings" : "Show settings"}
            </button>

            {!allPhrasesUsed && (
              <button
                onClick={() => void startPractice()}
                disabled={loading || selectedCards.length === 0}
                className={`button-primary ${
                  loading || selectedCards.length === 0 ? "button-disabled" : ""
                }`}
              >
                {loading
                  ? "Starting..."
                  : messages.length > 0
                    ? "Restart practice"
                    : "Start practice"}
              </button>
            )}
          </div>
        </div>

        <div className="chat-box" style={{ marginBottom: 16 }}>
          {messages.length === 0 ? (
            <p>No conversation yet.</p>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`chat-message ${
                  msg.role === "assistant" ? "chat-message-assistant" : "chat-message-user"
                }`}
              >
                <strong>{msg.role === "assistant" ? "Assistant" : "You"}:</strong>{" "}
                {msg.role === "user" && i === latestUserMessageIndex
                  ? highlightDetectedText(msg.content, lastPhraseFeedback)
                  : msg.content}

                {msg.role === "assistant" && (
                  <div style={{ marginTop: 10 }}>
                    <div
  className="utility-actions"
  style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
>
                      <button
                        className="button-secondary button-small"
                        onClick={() => openAddPhraseFromMessage(i)}
                      >
                        Create card draft
                      </button>

                      <button
                        className="button-secondary button-small"
                        onClick={() => void translateAssistantMessage(i, msg.content)}
                        disabled={translatingMessageIndex === i}
                      >
                        {translatingMessageIndex === i
                          ? "Translating..."
                          : showTranslationByMessage[i]
                            ? "Hide translation"
                            : "Translate message"}
                      </button>
                    </div>

                    {showTranslationByMessage[i] && messageTranslations[i] && (
                      <div className="mini-box" style={{ marginTop: 10 }}>
                        <div className="meta-text" style={{ marginBottom: 6 }}>
                          English translation
                        </div>
                        <div>{messageTranslations[i]}</div>
                      </div>
                    )}

                    {addFromMessageIndex === i && (
                      <div className="mini-box">
                        <div className="meta-text" style={{ marginBottom: 8 }}>
                          Select text in the message above, or type the phrase here.
                        </div>

                        <div className="controls-row">
                          <input
                            value={candidatePhrase}
                            onChange={(e) => setCandidatePhrase(e.target.value)}
                            onKeyDown={handleAddPhraseKeyDown}
                            placeholder="Phrase to save as draft..."
                            className="text-input"
                            style={{ width: "100%", maxWidth: 300 }}
                          />

                          <button
                            onClick={() => void savePhraseFromMessage()}
                            disabled={addingPhrase}
                            className={`button-primary ${
                              addingPhrase ? "button-disabled" : ""
                            }`}
                          >
                            {addingPhrase ? "Creating..." : "Create draft"}
                          </button>

                          <button
                            onClick={() => {
                              setAddFromMessageIndex(null);
                              setCandidatePhrase("");
                              setAddPhraseStatus(null);
                            }}
                            className="button-secondary"
                          >
                            Cancel
                          </button>
                        </div>

                        {addPhraseStatus && (
                          <div className="meta-text" style={{ marginTop: 8 }}>
                            {addPhraseStatus}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={chatBottomRef} />
        </div>

        {!allPhrasesUsed ? (
          <>
            {retryState && (
              <div
                className="mini-box"
                style={{
                  background: "#fff7ed",
                  border: "1px solid #fdba74",
                  color: "#9a3412",
                  marginBottom: 12,
                }}
              >
                You are editing your last reply. If it becomes correct now, it will count
                as almost for stats.
              </div>
            )}

            <div className="mini-box composer-box">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleSendKeyDown}
                placeholder="Write your reply in Danish..."
                className="textarea-input"
                rows={4}
                style={{ width: "100%", fontSize: 16, marginBottom: 12 }}
              />

              <div className="composer-actions">
                <div
  style={{
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    alignItems: "center",
  }}
>
  {messages.length > 0 && (
    <button
      onClick={endSession}
      disabled={loading}
      className={`button-secondary button-small ${loading ? "button-disabled" : ""}`}
    >
      End
    </button>
  )}

  {canRegenerate && (
    <button
      onClick={() => void regenerateAnswer()}
      disabled={loading}
      className={`button-secondary button-small ${loading ? "button-disabled" : ""}`}
    >
      Retry
    </button>
  )}

  {canRegenerate &&
    lastPhraseFeedback.some(
      (item) => item.status === "wrong" || item.status === "almost"
    ) && (
      <button
        onClick={startTryAgain}
        disabled={loading || reviewingSecondOpinion}
        className={`button-secondary button-small ${
          loading || reviewingSecondOpinion ? "button-disabled" : ""
        }`}
      >
        Fix
      </button>
    )}
</div>

                <div className="send-button-wrap">
                  <button
                    onClick={() => void sendMessage()}
                    disabled={
                      loading ||
                      reviewingSecondOpinion ||
                      (messages.length === 0 && !retryState) ||
                      !input.trim()
                    }
                    className={`button-primary send-button ${
                      loading ||
                      reviewingSecondOpinion ||
                      (messages.length === 0 && !retryState) ||
                      !input.trim()
                        ? "button-disabled"
                        : ""
                    }`}
                  >
                    {loading ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div
            className="success-box"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <strong>Nice — you used all target phrases correctly.</strong>
            <button
              onClick={() => void startNewWeakPhrasePractice()}
              disabled={loading}
              className={`button-primary ${loading ? "button-disabled" : ""}`}
            >
              {loading ? "Loading..." : "Start new session"}
            </button>
          </div>
        )}
      </div>

      {hasVisibleFeedback && (
        <div className="info-box">
          <div className="controls-row-spread" style={{ alignItems: "center" }}>
            <div>
              <strong>Phrase feedback</strong>
              <div className="meta-text" style={{ marginTop: 4 }}>
                Review how your last reply went.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => setFeedbackOpen((prev) => !prev)}
                className="button-secondary button-small"
              >
                {feedbackOpen ? "Hide feedback" : "Show feedback"}
              </button>

              <button
                onClick={() => void requestSecondOpinion()}
                disabled={reviewingSecondOpinion || loading}
                className={`button-secondary button-small ${
                  reviewingSecondOpinion || loading ? "button-disabled" : ""
                }`}
              >
                {reviewingSecondOpinion ? "Reviewing..." : "Second opinion"}
              </button>
            </div>
          </div>

          {secondOpinionNote && (
            <div className="meta-text" style={{ marginTop: 8 }}>
              {secondOpinionNote}
            </div>
          )}

          {feedbackOpen && (
            <ul style={{ marginTop: 10 }}>
              {lastPhraseFeedback
                .filter((item) => item.status !== "unused")
                .map((item) => (
                  <li key={item.phrase} style={{ marginBottom: 12 }}>
                    {item.status === "correct" && "✓"}
                    {item.status === "almost" && "~"}
                    {item.status === "wrong" && "✗"}{" "}
                    <strong>{item.phrase}</strong>
                    {item.comment ? ` — ${item.comment}` : ""}

                    {item.suggestion && (
                      <div style={{ marginTop: 4 }}>
                        <em>Suggestion:</em> {item.suggestion}
                      </div>
                    )}

                    {item.sentenceIssue !== "none" && item.sentenceComment && (
                      <div style={{ marginTop: 4 }}>
                        <em>Grammar elsewhere:</em> {item.sentenceComment}
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {draftSavedMessage && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 22,
            transform: "translateX(-50%)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "linear-gradient(135deg, #15803d 0%, #16a34a 100%)",
            color: "#ffffff",
            padding: "12px 16px",
            borderRadius: "14px",
            boxShadow: "0 14px 34px rgba(0,0,0,0.22)",
            border: "1px solid rgba(255,255,255,0.15)",
            fontWeight: 600,
            fontSize: 14,
            letterSpacing: "0.01em",
            maxWidth: "min(92vw, 520px)",
            transition: "opacity 180ms ease, transform 180ms ease",
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "999px",
              background: "rgba(255,255,255,0.18)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            ✓
          </span>

          <span>{draftSavedMessage}</span>
        </div>
      )}
    </main>
  );
}
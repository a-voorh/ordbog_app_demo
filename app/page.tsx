"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

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
  times_attempted?: number | null;
  times_correct?: number | null;
  times_almost?: number | null;
  times_wrong?: number | null;
  last_practiced_at?: string | null;
};

type PendingDraft = {
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

type AnalysisResult = {
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

type EditDraft = {
  phrase: string;
  translation_en: string;
  short_explanation: string;
  example_da: string;
  example_en: string;
  extra_info: string;
};

type DraftCard = {
  phrase: string;
  translation_en: string;
  short_explanation: string;
  example_da: string;
  example_en: string;
  extra_info: string;
  tags: string[];
};

type DatabaseViewMode = "attention" | "all";

const normalizeTag = (tag: string) => tag.trim();

const normalizePhraseKey = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const sortKeyDa = (phrase: string) => phrase.trim().replace(/^at\s+/i, "");

const sortByPhraseDa = <T extends { phrase: string }>(items: T[]) =>
  [...items].sort((a, b) =>
    sortKeyDa(a.phrase).localeCompare(sortKeyDa(b.phrase), "da")
  );

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const TAG_PALETTE = [
  { bg: "#dbeafe", text: "#1d4ed8", border: "#93c5fd" },
  { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  { bg: "#f3e8ff", text: "#7e22ce", border: "#d8b4fe" },
  { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  { bg: "#ffe4e6", text: "#be123c", border: "#fda4af" },
  { bg: "#e0f2fe", text: "#075985", border: "#7dd3fc" },
  { bg: "#fae8ff", text: "#a21caf", border: "#f0abfc" },
  { bg: "#ecfccb", text: "#3f6212", border: "#bef264" },
  { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" },
  { bg: "#cffafe", text: "#155e75", border: "#67e8f9" },
  { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  { bg: "#fef2f2", text: "#b91c1c", border: "#fca5a5" },
  { bg: "#f0fdf4", text: "#15803d", border: "#86efac" },
  { bg: "#eff6ff", text: "#1e40af", border: "#60a5fa" },
  { bg: "#fff7ed", text: "#c2410c", border: "#fdba74" },
  { bg: "#f5f3ff", text: "#6d28d9", border: "#c4b5fd" },
  { bg: "#f0f9ff", text: "#0369a1", border: "#7dd3fc" },
  { bg: "#f7fee7", text: "#4d7c0f", border: "#bef264" },
  { bg: "#fdf2f8", text: "#be185d", border: "#f9a8d4" },
  { bg: "#ecfeff", text: "#0f766e", border: "#5eead4" },
];

function tagPillStyle(tag: string) {
  const colors = TAG_PALETTE[hashString(tag.toLowerCase()) % TAG_PALETTE.length];
  return {
    backgroundColor: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
  } as const;
}

export default function Home() {
  const [phrase, setPhrase] = useState("");
  const [cards, setCards] = useState<PhraseCard[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<PendingDraft[]>([]);
  const [analysis, setAnalysis] = useState<PhraseCard | null>(null);
  const [draftCard, setDraftCard] = useState<DraftCard | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPendingDraftId, setExpandedPendingDraftId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [draftEdit, setDraftEdit] = useState<EditDraft | null>(null);

  const [editingPendingDraftId, setEditingPendingDraftId] = useState<string | null>(null);
  const [pendingDraftEdit, setPendingDraftEdit] = useState<EditDraft | null>(null);

  const [selectedForPractice, setSelectedForPractice] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [inlineTagInputByCard, setInlineTagInputByCard] = useState<Record<string, string>>({});
  const [inlineTagInputByPendingDraft, setInlineTagInputByPendingDraft] = useState<Record<string, string>>({});

  const [showStatsByCard, setShowStatsByCard] = useState<Record<string, boolean>>({});
  const [showAllTagsByCard, setShowAllTagsByCard] = useState<Record<string, boolean>>({});
  const [showAllTagsByPendingDraft, setShowAllTagsByPendingDraft] = useState<Record<string, boolean>>({});

  const [showAllNewPhraseTags, setShowAllNewPhraseTags] = useState(false);
  const [showAllFilterTags, setShowAllFilterTags] = useState(false);
  const [showAllInlinePickerByCard, setShowAllInlinePickerByCard] = useState<Record<string, boolean>>({});
  const [showAllInlinePickerByPendingDraft, setShowAllInlinePickerByPendingDraft] = useState<Record<string, boolean>>({});

  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [showManageTags, setShowManageTags] = useState(false);

  const [draftTagInput, setDraftTagInput] = useState("");
  const [showAllDraftTags, setShowAllDraftTags] = useState(false);

  const [databaseViewMode, setDatabaseViewMode] = useState<DatabaseViewMode>("attention");

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupEnglish, setLookupEnglish] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupStatus, setLookupStatus] = useState<string | null>(null);
  const [savingLookupDraft, setSavingLookupDraft] = useState(false);

  const [newPhraseToolsOpen, setNewPhraseToolsOpen] = useState(false);
  const [libraryFiltersOpen, setLibraryFiltersOpen] = useState(false);

  const lookupInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: phraseData } = await supabase.from("phrases").select("*");
      setCards(sortByPhraseDa((phraseData || []) as PhraseCard[]));

      const { data: draftData } = await supabase
        .from("phrase_drafts")
        .select("*")
        .order("created_at", { ascending: false });

      setPendingDrafts((draftData || []) as PendingDraft[]);
    };

    void load();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("selected_phrase_ids");
    if (stored) {
      try {
        setSelectedForPractice(JSON.parse(stored));
      } catch {
        // ignore invalid localStorage
      }
    }
  }, []);

  useEffect(() => {
    if (lookupOpen) {
      setTimeout(() => {
        lookupInputRef.current?.focus();
      }, 0);
    }
  }, [lookupOpen]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();

    for (const card of cards) {
      for (const tag of card.tags || []) {
        if (tag.trim()) tags.add(tag.trim());
      }
    }

    for (const draft of pendingDrafts) {
      for (const tag of draft.tags || []) {
        if (tag.trim()) tags.add(tag.trim());
      }
    }

    for (const tag of extraTags) {
      if (tag.trim()) tags.add(tag.trim());
    }

    return Array.from(tags).sort((a, b) => a.localeCompare(b, "da"));
  }, [cards, pendingDrafts, extraTags]);

  const attemptsOf = (card: PhraseCard) => card.times_attempted ?? 0;
  const correctOf = (card: PhraseCard) => card.times_correct ?? 0;
  const almostOf = (card: PhraseCard) => card.times_almost ?? 0;
  const wrongOf = (card: PhraseCard) => card.times_wrong ?? 0;

  const daysSinceLastPracticed = (card: PhraseCard) => {
    if (!card.last_practiced_at) return null;
    const diffMs = Date.now() - new Date(card.last_practiced_at).getTime();
    return diffMs / (1000 * 60 * 60 * 24);
  };

  const successScore = (card: PhraseCard) => {
    const attempted = attemptsOf(card);
    const correct = correctOf(card);
    const almost = almostOf(card);

    if (attempted === 0) return 0;
    return (correct + 0.8 * almost) / attempted;
  };

  const effectiveSuccessScore = (card: PhraseCard) => {
    const attempted = attemptsOf(card);
    if (attempted === 0) return 0;

    const base = successScore(card);
    const days = daysSinceLastPracticed(card);

    let confidenceBonus = 0;
    if (attempted >= 6) confidenceBonus = 0.12;
    else if (attempted >= 3) confidenceBonus = 0.08;
    else confidenceBonus = 0.04;

    let stalePenalty = 0;
    if (days !== null) {
      if (days > 30) stalePenalty = 0.18;
      else if (days > 14) stalePenalty = 0.1;
      else if (days > 7) stalePenalty = 0.05;
    }

    return Math.max(0, Math.min(1, base + confidenceBonus - stalePenalty));
  };

  const masteryColor = (card: PhraseCard) => {
    const attempted = attemptsOf(card);
    if (attempted < 3) return "#e5e7eb";

    const s = effectiveSuccessScore(card);
    if (s < 0.45) return "#fca5a5";
    if (s < 0.68) return "#fcd34d";
    return "#86efac";
  };

  const masteryText = (card: PhraseCard) => {
    const attempted = attemptsOf(card);
    if (attempted < 3) return `new (${attempted}/3)`;
    return `${Math.round(effectiveSuccessScore(card) * 100)}%`;
  };

  const staleLabel = (card: PhraseCard) => {
    const days = daysSinceLastPracticed(card);
    if (days === null) return "";
    if (days > 30) return "stale";
    if (days > 14) return "cooling off";
    if (days > 7) return "needs review";
    return "";
  };

  const attentionCards = useMemo(() => {
    const scored = [...cards].sort((a, b) => {
      const aAttempts = attemptsOf(a);
      const bAttempts = attemptsOf(b);

      if (aAttempts < 3 && bAttempts >= 3) return -1;
      if (bAttempts < 3 && aAttempts >= 3) return 1;

      const aScore = effectiveSuccessScore(a);
      const bScore = effectiveSuccessScore(b);

      if (aScore !== bScore) return aScore - bScore;

      const aDays = daysSinceLastPracticed(a) ?? -1;
      const bDays = daysSinceLastPracticed(b) ?? -1;

      return bDays - aDays;
    });

    return scored.slice(0, 10);
  }, [cards]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();

    let result = databaseViewMode === "attention" ? attentionCards : cards;

    if (tagFilter) {
      result = result.filter((c) => (c.tags || []).includes(tagFilter));
    }

    if (!q) return result;

    return result.filter(
      (c) =>
        c.phrase.toLowerCase().includes(q) ||
        c.translation_en.toLowerCase().includes(q) ||
        c.short_explanation.toLowerCase().includes(q) ||
        c.example_da.toLowerCase().includes(q) ||
        c.example_en.toLowerCase().includes(q) ||
        (c.tags || []).some((tag) => tag.toLowerCase().includes(q))
    );
  }, [cards, attentionCards, databaseViewMode, search, tagFilter]);

  const totalSaved = cards.length;
  const activeVocabularyCount = cards.filter(
    (card) => attemptsOf(card) >= 3 && effectiveSuccessScore(card) >= 0.68
  ).length;
  const needsReviewCount = cards.filter((card) => {
    const attempts = attemptsOf(card);
    const score = effectiveSuccessScore(card);
    const days = daysSinceLastPracticed(card);
    return attempts < 3 || score < 0.68 || (days !== null && days > 14);
  }).length;

  const analyzePhrase = async (p: string) => {
    const res = await fetch("/api/analyze-phrase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phrase: p }),
    });

    const data = await res.json();
    if (!res.ok) return null;

    try {
      return JSON.parse(data.result) as AnalysisResult;
    } catch {
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

  const saveLookupResultAsPendingDraft = async () => {
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

      const duplicateInPendingDrafts = pendingDrafts.some(
        (draft) => normalizePhraseKey(draft.phrase) === newKey
      );

      if (duplicateInPendingDrafts) {
        setLookupStatus(`Already waiting in drafts: ${correctedPhrase}`);
        return;
      }

      const newDraft: PendingDraft = {
        id: crypto.randomUUID(),
        phrase: correctedPhrase,
        translation_en: lookupResult.translation_en,
        short_explanation: lookupResult.short_explanation_da,
        example_da: lookupResult.example_da,
        example_en: lookupResult.example_en,
        extra_info: lookupResult.extra_info,
        tags: [],
        created_at: new Date().toISOString(),
        source: "lookup",
      };

      const { error } = await supabase.from("phrase_drafts").insert(newDraft);

      if (error) {
        console.error("Failed to save lookup draft:", error);
        setLookupStatus("Failed to save draft.");
        return;
      }

      setPendingDrafts((prev) => [newDraft, ...prev]);
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

  const toggleTagFilter = (tag: string) => {
    setTagFilter((prev) => (prev === tag ? null : tag));
  };

  const toggleSelectedTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addNewTag = () => {
    const tag = normalizeTag(newTagInput);
    if (!tag) return;

    if (!allTags.includes(tag)) {
      setExtraTags((prev) => [...prev, tag].sort((a, b) => a.localeCompare(b, "da")));
    }

    setNewTagInput("");
  };

  const removeSelectedTag = (tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  };

  const clearPracticeSelection = () => {
    setSelectedForPractice([]);
    localStorage.removeItem("selected_phrase_ids");
  };

  const createDraftFromPhrase = async () => {
    if (!phrase.trim()) return;

    setLoading(true);

    const parsed = await analyzePhrase(phrase.trim());

    if (!parsed) {
      setLoading(false);
      return;
    }

    const correctedPhrase = parsed.corrected_phrase.trim();
    const newKey = normalizePhraseKey(correctedPhrase);

    const duplicateInCards = cards.some(
      (card) => normalizePhraseKey(card.phrase) === newKey
    );

    const duplicateInPendingDrafts = pendingDrafts.some(
      (draft) => normalizePhraseKey(draft.phrase) === newKey
    );

    if (duplicateInCards || duplicateInPendingDrafts) {
      setLoading(false);
      alert(`This phrase already exists: ${correctedPhrase}`);
      return;
    }

    const normalizedTags = Array.from(
      new Set(selectedTags.map(normalizeTag).filter(Boolean))
    );

    setDraftCard({
      phrase: correctedPhrase,
      translation_en: parsed.translation_en,
      short_explanation: parsed.short_explanation_da,
      example_da: parsed.example_da,
      example_en: parsed.example_en,
      extra_info: parsed.extra_info,
      tags: normalizedTags,
    });

    setIsEditingDraft(false);
    setDraftEdit(null);
    setPhrase("");
    setLoading(false);
  };

  const saveDraftToDatabase = async () => {
    if (!draftCard) return;

    const normalizedPhrase = draftCard.phrase.trim();
    const newKey = normalizePhraseKey(normalizedPhrase);

    const duplicate = cards.some(
      (card) => normalizePhraseKey(card.phrase) === newKey
    );

    if (duplicate) {
      alert(`This phrase already exists: ${normalizedPhrase}`);
      return;
    }

    const normalizedTags = Array.from(
      new Set(draftCard.tags.map(normalizeTag).filter(Boolean))
    );

    const newCard: PhraseCard = {
      id: crypto.randomUUID(),
      phrase: normalizedPhrase,
      translation_en: draftCard.translation_en,
      short_explanation: draftCard.short_explanation,
      example_da: draftCard.example_da,
      example_en: draftCard.example_en,
      extra_info: draftCard.extra_info,
      created_at: new Date().toISOString(),
      tags: normalizedTags,
      times_attempted: 0,
      times_correct: 0,
      times_almost: 0,
      times_wrong: 0,
      last_practiced_at: null,
    };

    const { error } = await supabase.from("phrases").insert(newCard);

    if (error) {
      alert("Could not save the phrase. It may already exist.");
      return;
    }

    setCards((prev) => sortByPhraseDa([...prev, newCard]));
    setAnalysis(newCard);
    setExpandedId(newCard.id);
    setDraftCard(null);
    setIsEditingDraft(false);
    setDraftEdit(null);
    setSelectedTags([]);
    setDraftTagInput("");
    setShowAllDraftTags(false);
  };

  const discardDraft = () => {
    setDraftCard(null);
    setIsEditingDraft(false);
    setDraftEdit(null);
    setDraftTagInput("");
    setShowAllDraftTags(false);
  };

  const startEditingDraft = () => {
    if (!draftCard) return;

    setIsEditingDraft(true);
    setDraftEdit({
      phrase: draftCard.phrase,
      translation_en: draftCard.translation_en,
      short_explanation: draftCard.short_explanation,
      example_da: draftCard.example_da,
      example_en: draftCard.example_en,
      extra_info: draftCard.extra_info,
    });
  };

  const saveDraftEdit = () => {
    if (!draftCard || !draftEdit) return;

    setDraftCard({
      ...draftCard,
      phrase: draftEdit.phrase.trim(),
      translation_en: draftEdit.translation_en,
      short_explanation: draftEdit.short_explanation,
      example_da: draftEdit.example_da,
      example_en: draftEdit.example_en,
      extra_info: draftEdit.extra_info,
    });

    setIsEditingDraft(false);
    setDraftEdit(null);
  };

  const refreshDraftAnalysis = async () => {
    if (!draftCard) return;

    const parsed = await analyzePhrase(draftCard.phrase);
    if (!parsed) return;

    const refreshedPhrase = parsed.corrected_phrase.trim();
    const newKey = normalizePhraseKey(refreshedPhrase);

    const duplicate = cards.some(
      (card) => normalizePhraseKey(card.phrase) === newKey
    );

    if (duplicate) {
      alert(`Cannot refresh because this phrase already exists: ${refreshedPhrase}`);
      return;
    }

    setDraftCard((prev) =>
      prev
        ? {
            ...prev,
            phrase: refreshedPhrase,
            translation_en: parsed.translation_en,
            short_explanation: parsed.short_explanation_da,
            example_da: parsed.example_da,
            example_en: parsed.example_en,
            extra_info: parsed.extra_info,
          }
        : prev
    );

    setIsEditingDraft(false);
    setDraftEdit(null);
  };

  const toggleDraftTag = (tag: string) => {
    if (!draftCard) return;

    setDraftCard((prev) =>
      prev
        ? {
            ...prev,
            tags: prev.tags.includes(tag)
              ? prev.tags.filter((t) => t !== tag)
              : [...prev.tags, tag],
          }
        : prev
    );
  };

  const addDraftTag = () => {
    if (!draftCard) return;

    const tag = normalizeTag(draftTagInput);
    if (!tag) return;

    if (!allTags.includes(tag)) {
      setExtraTags((prev) => [...prev, tag].sort((a, b) => a.localeCompare(b, "da")));
    }

    setDraftCard((prev) =>
      prev
        ? {
            ...prev,
            tags: prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag],
          }
        : prev
    );

    setDraftTagInput("");
  };

  const saveCardTags = async (cardId: string, tags: string[]) => {
    const normalized = Array.from(new Set(tags.map(normalizeTag).filter(Boolean)));

    const { error } = await supabase
      .from("phrases")
      .update({ tags: normalized })
      .eq("id", cardId);

    if (error) {
      alert("Could not update tags.");
      return;
    }

    setCards((prev) =>
      sortByPhraseDa(
        prev.map((c) => (c.id === cardId ? { ...c, tags: normalized } : c))
      )
    );

    if (analysis?.id === cardId) {
      setAnalysis((prev) => (prev ? { ...prev, tags: normalized } : prev));
    }
  };

  const savePendingDraftTags = async (draftId: string, tags: string[]) => {
    const normalized = Array.from(new Set(tags.map(normalizeTag).filter(Boolean)));

    const { error } = await supabase
      .from("phrase_drafts")
      .update({ tags: normalized })
      .eq("id", draftId);

    if (error) {
      alert("Could not update draft tags.");
      return;
    }

    setPendingDrafts((prev) =>
      prev.map((d) => (d.id === draftId ? { ...d, tags: normalized } : d))
    );
  };

  const toggleInlineCardTag = async (card: PhraseCard, tag: string) => {
    const nextTags = card.tags.includes(tag)
      ? card.tags.filter((t) => t !== tag)
      : [...card.tags, tag];

    await saveCardTags(card.id, nextTags);
  };

  const toggleInlinePendingDraftTag = async (draft: PendingDraft, tag: string) => {
    const nextTags = draft.tags.includes(tag)
      ? draft.tags.filter((t) => t !== tag)
      : [...draft.tags, tag];

    await savePendingDraftTags(draft.id, nextTags);
  };

  const addInlineCardTag = async (card: PhraseCard) => {
    const raw = inlineTagInputByCard[card.id] || "";
    const tag = normalizeTag(raw);
    if (!tag) return;

    if (!allTags.includes(tag)) {
      setExtraTags((prev) => [...prev, tag].sort((a, b) => a.localeCompare(b, "da")));
    }

    if (!card.tags.includes(tag)) {
      await saveCardTags(card.id, [...card.tags, tag]);
    }

    setInlineTagInputByCard((prev) => ({ ...prev, [card.id]: "" }));
  };

  const addInlinePendingDraftTag = async (draft: PendingDraft) => {
    const raw = inlineTagInputByPendingDraft[draft.id] || "";
    const tag = normalizeTag(raw);
    if (!tag) return;

    if (!allTags.includes(tag)) {
      setExtraTags((prev) => [...prev, tag].sort((a, b) => a.localeCompare(b, "da")));
    }

    if (!draft.tags.includes(tag)) {
      await savePendingDraftTags(draft.id, [...draft.tags, tag]);
    }

    setInlineTagInputByPendingDraft((prev) => ({ ...prev, [draft.id]: "" }));
  };

  const deleteCard = async (id: string) => {
    await supabase.from("phrases").delete().eq("id", id);

    setCards((prev) => prev.filter((c) => c.id !== id));
    setSelectedForPractice((prev) => {
      const updated = prev.filter((selectedId) => selectedId !== id);
      localStorage.setItem("selected_phrase_ids", JSON.stringify(updated));
      return updated;
    });

    if (analysis?.id === id) setAnalysis(null);
    if (editingId === id) {
      setEditingId(null);
      setEditDraft(null);
    }
    if (expandedId === id) setExpandedId(null);
  };

  const resetProgress = async (id: string) => {
    const updates = {
      times_attempted: 0,
      times_correct: 0,
      times_almost: 0,
      times_wrong: 0,
      last_practiced_at: null,
    };

    await supabase.from("phrases").update(updates).eq("id", id);

    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));

    if (analysis?.id === id) {
      setAnalysis((prev) => (prev ? { ...prev, ...updates } : prev));
    }
  };

  const startEditing = (card: PhraseCard) => {
    setEditingId(card.id);
    setEditDraft({
      phrase: card.phrase,
      translation_en: card.translation_en,
      short_explanation: card.short_explanation,
      example_da: card.example_da,
      example_en: card.example_en,
      extra_info: card.extra_info ?? "",
    });
  };

  const startEditingPendingDraft = (draft: PendingDraft) => {
    setEditingPendingDraftId(draft.id);
    setPendingDraftEdit({
      phrase: draft.phrase,
      translation_en: draft.translation_en,
      short_explanation: draft.short_explanation,
      example_da: draft.example_da,
      example_en: draft.example_en,
      extra_info: draft.extra_info ?? "",
    });
  };

  const saveEdit = async (id: string) => {
    if (!editDraft) return;

    const normalizedEditedPhrase = normalizePhraseKey(editDraft.phrase);

    const duplicate = cards.some(
      (card) =>
        card.id !== id &&
        normalizePhraseKey(card.phrase) === normalizedEditedPhrase
    );

    if (duplicate) {
      alert(`This phrase already exists: ${editDraft.phrase.trim()}`);
      return;
    }

    const updates = {
      phrase: editDraft.phrase.trim(),
      translation_en: editDraft.translation_en,
      short_explanation: editDraft.short_explanation,
      example_da: editDraft.example_da,
      example_en: editDraft.example_en,
      extra_info: editDraft.extra_info,
    };

    const { error } = await supabase.from("phrases").update(updates).eq("id", id);

    if (error) {
      alert("Could not save changes.");
      return;
    }

    setCards((prev) =>
      sortByPhraseDa(prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))
    );

    if (analysis?.id === id) {
      setAnalysis((prev) => (prev ? { ...prev, ...updates } : prev));
    }

    setEditingId(null);
    setEditDraft(null);
  };

  const savePendingDraftEdit = async (draftId: string) => {
    if (!pendingDraftEdit) return;

    const normalizedEditedPhrase = normalizePhraseKey(pendingDraftEdit.phrase);

    const duplicateInCards = cards.some(
      (card) => normalizePhraseKey(card.phrase) === normalizedEditedPhrase
    );

    if (duplicateInCards) {
      alert(`This phrase already exists in the database: ${pendingDraftEdit.phrase.trim()}`);
      return;
    }

    const duplicateInDrafts = pendingDrafts.some(
      (draft) =>
        draft.id !== draftId &&
        normalizePhraseKey(draft.phrase) === normalizedEditedPhrase
    );

    if (duplicateInDrafts) {
      alert(`This draft already exists: ${pendingDraftEdit.phrase.trim()}`);
      return;
    }

    const updates = {
      phrase: pendingDraftEdit.phrase.trim(),
      translation_en: pendingDraftEdit.translation_en,
      short_explanation: pendingDraftEdit.short_explanation,
      example_da: pendingDraftEdit.example_da,
      example_en: pendingDraftEdit.example_en,
      extra_info: pendingDraftEdit.extra_info,
    };

    const { error } = await supabase
      .from("phrase_drafts")
      .update(updates)
      .eq("id", draftId);

    if (error) {
      alert("Could not save draft changes.");
      return;
    }

    setPendingDrafts((prev) =>
      prev.map((d) => (d.id === draftId ? { ...d, ...updates } : d))
    );

    setEditingPendingDraftId(null);
    setPendingDraftEdit(null);
  };

  const refreshAnalysis = async (card: PhraseCard) => {
    const parsed = await analyzePhrase(card.phrase);
    if (!parsed) return;

    const refreshedPhrase = parsed.corrected_phrase.trim();
    const newKey = normalizePhraseKey(refreshedPhrase);

    const duplicate = cards.some(
      (other) =>
        other.id !== card.id &&
        normalizePhraseKey(other.phrase) === newKey
    );

    if (duplicate) {
      alert(`Cannot refresh because this would duplicate: ${refreshedPhrase}`);
      return;
    }

    const updates = {
      phrase: refreshedPhrase,
      translation_en: parsed.translation_en,
      short_explanation: parsed.short_explanation_da,
      example_da: parsed.example_da,
      example_en: parsed.example_en,
      extra_info: parsed.extra_info,
    };

    const { error } = await supabase.from("phrases").update(updates).eq("id", card.id);

    if (error) {
      alert("Could not refresh this phrase.");
      return;
    }

    setCards((prev) =>
      sortByPhraseDa(prev.map((c) => (c.id === card.id ? { ...c, ...updates } : c)))
    );

    setAnalysis((prev) => (prev?.id === card.id ? { ...prev, ...updates } : prev));
  };

  const refreshPendingDraftAnalysis = async (draft: PendingDraft) => {
    const parsed = await analyzePhrase(draft.phrase);
    if (!parsed) return;

    const refreshedPhrase = parsed.corrected_phrase.trim();
    const newKey = normalizePhraseKey(refreshedPhrase);

    const duplicateInCards = cards.some(
      (card) => normalizePhraseKey(card.phrase) === newKey
    );

    if (duplicateInCards) {
      alert(`Cannot refresh because this phrase already exists: ${refreshedPhrase}`);
      return;
    }

    const duplicateInDrafts = pendingDrafts.some(
      (other) =>
        other.id !== draft.id &&
        normalizePhraseKey(other.phrase) === newKey
    );

    if (duplicateInDrafts) {
      alert(`Cannot refresh because another draft already exists: ${refreshedPhrase}`);
      return;
    }

    const updates = {
      phrase: refreshedPhrase,
      translation_en: parsed.translation_en,
      short_explanation: parsed.short_explanation_da,
      example_da: parsed.example_da,
      example_en: parsed.example_en,
      extra_info: parsed.extra_info,
    };

    const { error } = await supabase
      .from("phrase_drafts")
      .update(updates)
      .eq("id", draft.id);

    if (error) {
      alert("Could not refresh this draft.");
      return;
    }

    setPendingDrafts((prev) =>
      prev.map((d) => (d.id === draft.id ? { ...d, ...updates } : d))
    );
  };

  const savePendingDraftToDatabase = async (draft: PendingDraft) => {
    const newKey = normalizePhraseKey(draft.phrase);

    const duplicateInCards = cards.some(
      (card) => normalizePhraseKey(card.phrase) === newKey
    );

    if (duplicateInCards) {
      alert(`This phrase already exists in the database: ${draft.phrase}`);
      return;
    }

    const newCard: PhraseCard = {
      id: crypto.randomUUID(),
      phrase: draft.phrase.trim(),
      translation_en: draft.translation_en,
      short_explanation: draft.short_explanation,
      example_da: draft.example_da,
      example_en: draft.example_en,
      extra_info: draft.extra_info,
      created_at: new Date().toISOString(),
      tags: Array.from(new Set(draft.tags.map(normalizeTag).filter(Boolean))),
      times_attempted: 0,
      times_correct: 0,
      times_almost: 0,
      times_wrong: 0,
      last_practiced_at: null,
    };

    const { error: insertError } = await supabase.from("phrases").insert(newCard);

    if (insertError) {
      alert("Could not save draft to database.");
      return;
    }

    const { error: deleteError } = await supabase
      .from("phrase_drafts")
      .delete()
      .eq("id", draft.id);

    if (deleteError) {
      alert("Saved to database, but could not remove draft.");
      setCards((prev) => sortByPhraseDa([...prev, newCard]));
      return;
    }

    setCards((prev) => sortByPhraseDa([...prev, newCard]));
    setPendingDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    setAnalysis(newCard);
    setExpandedId(newCard.id);

    if (expandedPendingDraftId === draft.id) setExpandedPendingDraftId(null);
    if (editingPendingDraftId === draft.id) {
      setEditingPendingDraftId(null);
      setPendingDraftEdit(null);
    }
  };

  const discardPendingDraft = async (draftId: string) => {
    const { error } = await supabase.from("phrase_drafts").delete().eq("id", draftId);

    if (error) {
      alert("Could not discard draft.");
      return;
    }

    setPendingDrafts((prev) => prev.filter((d) => d.id !== draftId));

    if (expandedPendingDraftId === draftId) setExpandedPendingDraftId(null);
    if (editingPendingDraftId === draftId) {
      setEditingPendingDraftId(null);
      setPendingDraftEdit(null);
    }
  };

  const renameTag = async () => {
    const from = renameFrom.trim();
    const to = renameTo.trim();

    if (!from || !to || from === to) return;

    const updatedCards = cards.map((card) => {
      if (!card.tags.includes(from)) return card;
      const newTags = Array.from(
        new Set(card.tags.map((tag) => (tag === from ? to : tag)))
      );
      return { ...card, tags: newTags };
    });

    const updatedPendingDrafts = pendingDrafts.map((draft) => {
      if (!draft.tags.includes(from)) return draft;
      const newTags = Array.from(
        new Set(draft.tags.map((tag) => (tag === from ? to : tag)))
      );
      return { ...draft, tags: newTags };
    });

    const changedCards = updatedCards.filter((card, idx) => {
      const oldTags = cards[idx].tags;
      return JSON.stringify(oldTags) !== JSON.stringify(card.tags);
    });

    const changedDrafts = updatedPendingDrafts.filter((draft, idx) => {
      const oldTags = pendingDrafts[idx].tags;
      return JSON.stringify(oldTags) !== JSON.stringify(draft.tags);
    });

    for (const card of changedCards) {
      const { error } = await supabase
        .from("phrases")
        .update({ tags: card.tags })
        .eq("id", card.id);

      if (error) {
        alert("Could not rename tag everywhere.");
        return;
      }
    }

    for (const draft of changedDrafts) {
      const { error } = await supabase
        .from("phrase_drafts")
        .update({ tags: draft.tags })
        .eq("id", draft.id);

      if (error) {
        alert("Could not rename tag everywhere.");
        return;
      }
    }

    setCards(sortByPhraseDa(updatedCards));
    setPendingDrafts(updatedPendingDrafts);

    if (analysis && analysis.tags.includes(from)) {
      setAnalysis({
        ...analysis,
        tags: Array.from(
          new Set(analysis.tags.map((tag) => (tag === from ? to : tag)))
        ),
      });
    }

    if (draftCard && draftCard.tags.includes(from)) {
      setDraftCard({
        ...draftCard,
        tags: Array.from(
          new Set(draftCard.tags.map((tag) => (tag === from ? to : tag)))
        ),
      });
    }

    if (tagFilter === from) {
      setTagFilter(to);
    }

    setRenameFrom("");
    setRenameTo("");
  };

  const handleEnterAdd = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void createDraftFromPhrase();
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

  const handleDraftTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addDraftTag();
    }
  };

  const handleInlineCardTagKeyDown = async (
    e: KeyboardEvent<HTMLInputElement>,
    card: PhraseCard
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await addInlineCardTag(card);
    }
  };

  const handleInlinePendingDraftTagKeyDown = async (
    e: KeyboardEvent<HTMLInputElement>,
    draft: PendingDraft
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await addInlinePendingDraftTag(draft);
    }
  };

  const handleSelectionToggle = (checked: boolean, cardId: string) => {
    let updated: string[];

    if (checked) {
      updated = [...selectedForPractice, cardId];
    } else {
      updated = selectedForPractice.filter((id) => id !== cardId);
    }

    setSelectedForPractice(updated);
    localStorage.setItem("selected_phrase_ids", JSON.stringify(updated));
  };

  const toggleShowStats = (cardId: string) => {
    setShowStatsByCard((prev) => ({
      ...prev,
      [cardId]: !prev[cardId],
    }));
  };

  const visibleNewPhraseTags = showAllNewPhraseTags ? allTags : allTags.slice(0, 4);
  const visibleFilterTags = showAllFilterTags ? allTags : allTags.slice(0, 4);
  const visibleDraftTags = showAllDraftTags ? allTags : allTags.slice(0, 4);

  return (
    <main className="app-page">
      <div
        style={{
          marginBottom: 28,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 320px" }}>
          <h1 className="app-title">📚 Mit ordforråd: ord for ord</h1>
          <p className="app-subtitle">Små danske vendinger, forklaringer og øvelse</p>
        </div>

        <div
          style={{
            flex: "0 0 220px",
            minWidth: 220,
            width: "100%",
            maxWidth: 280,
            display: "grid",
            gap: 10,
          }}
        >
          <Link href="/practice" className="link-reset">
            <span
              className="nav-button"
              style={{
                display: "block",
                textAlign: "center",
                width: "100%",
                padding: "14px 16px",
                fontSize: 16,
              }}
            >
              Practice Mode →
            </span>
          </Link>

          {selectedForPractice.length > 0 && (
            <button
              onClick={clearPracticeSelection}
              className="button-secondary"
              style={{ width: "100%" }}
            >
              Clear selected phrases ({selectedForPractice.length})
            </button>
          )}
        </div>
      </div>

      <div
        className="card"
        style={{
          marginBottom: 24,
          padding: 20,
          borderWidth: 2,
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <h2
            className="section-title"
            style={{ marginBottom: 6, fontSize: 24 }}
          >
            Add a new Danish phrase
          </h2>
          <p className="meta-text" style={{ fontSize: 14 }}>
            Start here. Add the phrase you want to learn, then review the generated draft card.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={handleEnterAdd}
            placeholder="Write a Danish phrase..."
            className="text-input"
            style={{
              width: "100%",
              fontSize: 18,
              padding: "14px 16px",
            }}
          />

          <button
            onClick={() => void createDraftFromPhrase()}
            className="button-primary"
            style={{
              width: "100%",
              padding: "14px 16px",
              fontSize: 16,
            }}
          >
            {loading ? "Analyzing..." : "Analyze phrase"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ margin: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3 className="subsection-title" style={{ marginBottom: 4 }}>
                Support tools
              </h3>
              <div className="meta-text">
                Useful, but secondary to adding a Danish phrase directly.
              </div>
            </div>

            <button
              onClick={() => setNewPhraseToolsOpen((prev) => !prev)}
              className="button-secondary"
            >
              {newPhraseToolsOpen ? "Hide tools" : "Show tools"}
            </button>
          </div>

          {newPhraseToolsOpen && (
            <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
              <div className="mini-box">
                <div style={{ marginBottom: 10 }} className="meta-text">
                  Tags for the new phrase
                </div>

                {allTags.length > 0 && (
                  <div className="tag-row" style={{ marginBottom: 12 }}>
                    {visibleNewPhraseTags.map((tag) => {
                      const selected = selectedTags.includes(tag);

                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleSelectedTag(tag)}
                          className={selected ? "tag-pill-selected" : "tag-pill"}
                          style={tagPillStyle(tag)}
                        >
                          {tag}
                        </button>
                      );
                    })}

                    {allTags.length > 4 && !showAllNewPhraseTags && (
                      <button className="tag-pill" onClick={() => setShowAllNewPhraseTags(true)}>
                        +{allTags.length - 4} more
                      </button>
                    )}

                    {allTags.length > 4 && showAllNewPhraseTags && (
                      <button className="tag-pill" onClick={() => setShowAllNewPhraseTags(false)}>
                        show less
                      </button>
                    )}
                  </div>
                )}

                <div className="controls-row" style={{ marginBottom: 12 }}>
                  <input
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    placeholder="New tag..."
                    className="text-input"
                    style={{ width: "100%", maxWidth: 260 }}
                  />

                  <button onClick={addNewTag} className="button-secondary">
                    Add tag
                  </button>
                </div>

                {selectedTags.length > 0 && (
                  <div>
                    <div style={{ marginBottom: 8 }} className="meta-text">
                      Selected tags
                    </div>

                    <div className="tag-row">
                      {selectedTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => removeSelectedTag(tag)}
                          className="tag-pill-selected"
                          style={tagPillStyle(tag)}
                        >
                          {tag} ✕
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mini-box">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h3 className="subsection-title" style={{ marginBottom: 4 }}>
                      Quick lookup
                    </h3>
                    <div className="meta-text">
                      Look up an English word or phrase and save it to drafts.
                    </div>
                  </div>

                  <button onClick={toggleLookupOpen} className="button-secondary">
                    {lookupOpen ? "Hide lookup" : "Open lookup"}
                  </button>
                </div>

                {lookupOpen && (
                  <div style={{ marginTop: 14 }}>
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
                            onClick={() => void saveLookupResultAsPendingDraft()}
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
            </div>
          )}
        </div>
      </div>

      {draftCard && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Draft card
          </h2>

          {!isEditingDraft ? (
            <>
              <p><b>Phrase:</b> {draftCard.phrase}</p>
              <p><b>Translation:</b> {draftCard.translation_en}</p>
              <p><b>Forklaring:</b> {draftCard.short_explanation}</p>
              <p><b>Eksempel:</b> {draftCard.example_da}</p>
              <p><b>Example:</b> {draftCard.example_en}</p>
              <p><b>Extra info:</b> {draftCard.extra_info || "—"}</p>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: 12,
                  marginBottom: 12,
                }}
              >
                <input
                  value={draftTagInput}
                  onChange={(e) => setDraftTagInput(e.target.value)}
                  onKeyDown={handleDraftTagKeyDown}
                  placeholder="New tag..."
                  className="text-input"
                  style={{ width: "100%", maxWidth: 180 }}
                />

                {visibleDraftTags.map((tag) => {
                  const selected = draftCard.tags.includes(tag);

                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleDraftTag(tag)}
                      className={selected ? "tag-pill-selected" : "tag-pill"}
                      style={tagPillStyle(tag)}
                    >
                      {selected ? `${tag} ✕` : tag}
                    </button>
                  );
                })}

                {allTags.length > 4 && !showAllDraftTags && (
                  <button className="tag-pill" onClick={() => setShowAllDraftTags(true)}>
                    +{allTags.length - 4} more
                  </button>
                )}

                {allTags.length > 4 && showAllDraftTags && (
                  <button className="tag-pill" onClick={() => setShowAllDraftTags(false)}>
                    show less
                  </button>
                )}
              </div>

              <div className="controls-row" style={{ marginTop: 10 }}>
                <button onClick={startEditingDraft} className="button-secondary">
                  Edit
                </button>

                <button onClick={() => void refreshDraftAnalysis()} className="button-secondary">
                  Refresh AI
                </button>

                <button onClick={() => void saveDraftToDatabase()} className="button-primary">
                  Save to database
                </button>

                <button onClick={discardDraft} className="button-danger">
                  Discard draft
                </button>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 16 }}>
              <input
                value={draftEdit?.phrase ?? ""}
                onChange={(e) =>
                  setDraftEdit((prev) => (prev ? { ...prev, phrase: e.target.value } : prev))
                }
                className="text-input"
                style={{ width: "100%", marginBottom: 8 }}
              />

              <input
                value={draftEdit?.translation_en ?? ""}
                onChange={(e) =>
                  setDraftEdit((prev) =>
                    prev ? { ...prev, translation_en: e.target.value } : prev
                  )
                }
                className="text-input"
                style={{ width: "100%", marginBottom: 8 }}
              />

              <textarea
                value={draftEdit?.short_explanation ?? ""}
                onChange={(e) =>
                  setDraftEdit((prev) =>
                    prev ? { ...prev, short_explanation: e.target.value } : prev
                  )
                }
                className="textarea-input"
                style={{ marginBottom: 8 }}
              />

              <textarea
                value={draftEdit?.example_da ?? ""}
                onChange={(e) =>
                  setDraftEdit((prev) =>
                    prev ? { ...prev, example_da: e.target.value } : prev
                  )
                }
                className="textarea-input"
                style={{ marginBottom: 8 }}
              />

              <textarea
                value={draftEdit?.example_en ?? ""}
                onChange={(e) =>
                  setDraftEdit((prev) =>
                    prev ? { ...prev, example_en: e.target.value } : prev
                  )
                }
                className="textarea-input"
                style={{ marginBottom: 8 }}
              />

              <input
                value={draftEdit?.extra_info ?? ""}
                onChange={(e) =>
                  setDraftEdit((prev) =>
                    prev ? { ...prev, extra_info: e.target.value } : prev
                  )
                }
                className="text-input"
                placeholder="Extra info..."
                style={{ width: "100%", marginBottom: 8 }}
              />

              <div className="controls-row" style={{ marginTop: 10 }}>
                <button onClick={saveDraftEdit} className="button-primary">
                  Save
                </button>

                <button
                  onClick={() => {
                    setIsEditingDraft(false);
                    setDraftEdit(null);
                  }}
                  className="button-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ margin: 0 }}>
          <div className="meta-text">Total saved</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{totalSaved}</div>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div className="meta-text">Active vocabulary</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{activeVocabularyCount}</div>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div className="meta-text">Needs attention</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{needsReviewCount}</div>
        </div>
      </div>

      {pendingDrafts.length > 0 && (
        <>
          <h2 className="section-title">Pending drafts</h2>

          {pendingDrafts.map((draft) => {
            const expanded = expandedPendingDraftId === draft.id;
            const showAllTags = !!showAllTagsByPendingDraft[draft.id];
            const visibleTags = showAllTags ? draft.tags : draft.tags.slice(0, 4);

            const showAllInlinePicker = !!showAllInlinePickerByPendingDraft[draft.id];
            const visibleInlinePickerTags = showAllInlinePicker ? allTags : allTags.slice(0, 4);

            return (
              <div key={draft.id} className="card">
                <div
                  className="controls-row"
                  style={{ justifyContent: "space-between", alignItems: "flex-start" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      cursor: "pointer",
                      flex: 1,
                    }}
                    onClick={() =>
                      setExpandedPendingDraftId(expanded ? null : draft.id)
                    }
                  >
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{draft.phrase}</span>

                    {visibleTags.map((tag) => (
                      <span key={tag} className="badge" style={tagPillStyle(tag)}>
                        {tag}
                      </span>
                    ))}

                    {draft.tags.length > 4 && !showAllTags && (
                      <button
                        className="tag-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAllTagsByPendingDraft((prev) => ({
                            ...prev,
                            [draft.id]: true,
                          }));
                        }}
                      >
                        +{draft.tags.length - 4} more
                      </button>
                    )}

                    {draft.tags.length > 4 && showAllTags && (
                      <button
                        className="tag-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAllTagsByPendingDraft((prev) => ({
                            ...prev,
                            [draft.id]: false,
                          }));
                        }}
                      >
                        show less
                      </button>
                    )}
                  </div>

                  <div className="inline-row">
                    <span
                      className="badge"
                      style={{ backgroundColor: "#ede9fe", color: "#5b21b6" }}
                    >
                      draft
                    </span>
                  </div>
                </div>

                {expanded && (
                  <div style={{ marginTop: 12 }}>
                    <p><b>Translation:</b> {draft.translation_en}</p>
                    <p><b>Forklaring:</b> {draft.short_explanation}</p>
                    <p><b>Eksempel:</b> {draft.example_da}</p>
                    <p><b>Example:</b> {draft.example_en}</p>
                    <p><b>Extra info:</b> {draft.extra_info || "—"}</p>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginTop: 12,
                        marginBottom: 12,
                      }}
                    >
                      <input
                        value={inlineTagInputByPendingDraft[draft.id] || ""}
                        onChange={(e) =>
                          setInlineTagInputByPendingDraft((prev) => ({
                            ...prev,
                            [draft.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => void handleInlinePendingDraftTagKeyDown(e, draft)}
                        placeholder="New tag..."
                        className="text-input"
                        style={{ width: "100%", maxWidth: 160 }}
                      />

                      {visibleInlinePickerTags.map((tag) => {
                        const selectedOnDraft = draft.tags.includes(tag);

                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => void toggleInlinePendingDraftTag(draft, tag)}
                            className={selectedOnDraft ? "tag-pill-selected" : "tag-pill"}
                            style={tagPillStyle(tag)}
                          >
                            {selectedOnDraft ? `${tag} ✕` : tag}
                          </button>
                        );
                      })}

                      {allTags.length > 4 && !showAllInlinePicker && (
                        <button
                          className="tag-pill"
                          onClick={() =>
                            setShowAllInlinePickerByPendingDraft((prev) => ({
                              ...prev,
                              [draft.id]: true,
                            }))
                          }
                        >
                          +{allTags.length - 4} more
                        </button>
                      )}

                      {allTags.length > 4 && showAllInlinePicker && (
                        <button
                          className="tag-pill"
                          onClick={() =>
                            setShowAllInlinePickerByPendingDraft((prev) => ({
                              ...prev,
                              [draft.id]: false,
                            }))
                          }
                        >
                          show less
                        </button>
                      )}
                    </div>

                    <div className="controls-row" style={{ marginTop: 10 }}>
                      <button
                        onClick={() => startEditingPendingDraft(draft)}
                        className="button-secondary"
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => void refreshPendingDraftAnalysis(draft)}
                        className="button-secondary"
                      >
                        Refresh AI
                      </button>

                      <button
                        onClick={() => void savePendingDraftToDatabase(draft)}
                        className="button-primary"
                      >
                        Save to database
                      </button>

                      <button
                        onClick={() => void discardPendingDraft(draft.id)}
                        className="button-danger"
                      >
                        Discard draft
                      </button>
                    </div>

                    {editingPendingDraftId === draft.id && pendingDraftEdit && (
                      <div style={{ marginTop: 16 }}>
                        <input
                          value={pendingDraftEdit.phrase}
                          onChange={(e) =>
                            setPendingDraftEdit({
                              ...pendingDraftEdit,
                              phrase: e.target.value,
                            })
                          }
                          className="text-input"
                          style={{ width: "100%", marginBottom: 8 }}
                        />

                        <input
                          value={pendingDraftEdit.translation_en}
                          onChange={(e) =>
                            setPendingDraftEdit({
                              ...pendingDraftEdit,
                              translation_en: e.target.value,
                            })
                          }
                          className="text-input"
                          style={{ width: "100%", marginBottom: 8 }}
                        />

                        <textarea
                          value={pendingDraftEdit.short_explanation}
                          onChange={(e) =>
                            setPendingDraftEdit({
                              ...pendingDraftEdit,
                              short_explanation: e.target.value,
                            })
                          }
                          className="textarea-input"
                          style={{ marginBottom: 8 }}
                        />

                        <textarea
                          value={pendingDraftEdit.example_da}
                          onChange={(e) =>
                            setPendingDraftEdit({
                              ...pendingDraftEdit,
                              example_da: e.target.value,
                            })
                          }
                          className="textarea-input"
                          style={{ marginBottom: 8 }}
                        />

                        <textarea
                          value={pendingDraftEdit.example_en}
                          onChange={(e) =>
                            setPendingDraftEdit({
                              ...pendingDraftEdit,
                              example_en: e.target.value,
                            })
                          }
                          className="textarea-input"
                          style={{ marginBottom: 8 }}
                        />

                        <input
                          value={pendingDraftEdit.extra_info}
                          onChange={(e) =>
                            setPendingDraftEdit({
                              ...pendingDraftEdit,
                              extra_info: e.target.value,
                            })
                          }
                          className="text-input"
                          placeholder="Extra info..."
                          style={{ width: "100%", marginBottom: 8 }}
                        />

                        <div className="controls-row" style={{ marginTop: 10 }}>
                          <button
                            onClick={() => void savePendingDraftEdit(draft.id)}
                            className="button-primary"
                          >
                            Save
                          </button>

                          <button
                            onClick={() => {
                              setEditingPendingDraftId(null);
                              setPendingDraftEdit(null);
                            }}
                            className="button-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {analysis && (
        <div className="card">
          <h2 className="subsection-title">Latest saved card</h2>
          <p><b>Phrase:</b> {analysis.phrase}</p>
          <p><b>Translation:</b> {analysis.translation_en}</p>
          <p><b>Forklaring:</b> {analysis.short_explanation}</p>
          <p><b>Eksempel:</b> {analysis.example_da}</p>
          <p><b>Example:</b> {analysis.example_en}</p>
          <p><b>Extra info:</b> {analysis.extra_info || "—"}</p>
          <p><b>Tags:</b> {analysis.tags.length > 0 ? analysis.tags.join(", ") : "—"}</p>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <h2 className="section-title">Phrase database</h2>

        <div className="controls-row" style={{ marginBottom: 12 }}>
          <button
            onClick={() => setDatabaseViewMode("attention")}
            className={databaseViewMode === "attention" ? "button-primary" : "button-secondary"}
          >
            Needs attention
          </button>

          <button
            onClick={() => setDatabaseViewMode("all")}
            className={databaseViewMode === "all" ? "button-primary" : "button-secondary"}
          >
            All phrases
          </button>

          <button
            onClick={() => setLibraryFiltersOpen((prev) => !prev)}
            className="button-secondary"
          >
            {libraryFiltersOpen ? "Hide filters" : "Show filters"}
          </button>
        </div>

        <div style={{ marginBottom: 8 }} className="meta-text">
          {databaseViewMode === "attention"
            ? "Showing 10 phrases that need attention most"
            : `Showing all ${cards.length} saved phrases`}
        </div>

        {libraryFiltersOpen && (
          <div className="card" style={{ marginTop: 0 }}>
            <div style={{ marginBottom: 16 }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search phrases..."
                className="text-input"
                style={{ width: "100%", maxWidth: 360 }}
              />
            </div>

            <div style={{ marginBottom: 10 }} className="meta-text">
              Filter database by tag
            </div>

            {allTags.length > 0 && (
              <div className="tag-row" style={{ marginBottom: 12 }}>
                {visibleFilterTags.map((tag) => {
                  const selected = tagFilter === tag;

                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTagFilter(tag)}
                      className={selected ? "tag-pill-selected" : "tag-pill"}
                      style={tagPillStyle(tag)}
                    >
                      {tag}
                    </button>
                  );
                })}

                {allTags.length > 4 && !showAllFilterTags && (
                  <button className="tag-pill" onClick={() => setShowAllFilterTags(true)}>
                    +{allTags.length - 4} more
                  </button>
                )}

                {allTags.length > 4 && showAllFilterTags && (
                  <button className="tag-pill" onClick={() => setShowAllFilterTags(false)}>
                    show less
                  </button>
                )}
              </div>
            )}

            {tagFilter && (
              <div style={{ marginBottom: 16 }}>
                <button className="button-secondary button-small" onClick={() => setTagFilter(null)}>
                  Clear tag filter
                </button>
              </div>
            )}

            <div style={{ marginTop: 8, marginBottom: 12 }}>
              <button
                onClick={() => setShowManageTags((prev) => !prev)}
                className="button-secondary"
              >
                {showManageTags ? "Hide tag management" : "Manage tags"}
              </button>
            </div>

            {showManageTags && (
              <div className="mini-box" style={{ marginTop: 0 }}>
                <h3 className="subsection-title">Manage tags</h3>

                <div className="controls-row">
                  <input
                    value={renameFrom}
                    onChange={(e) => setRenameFrom(e.target.value)}
                    placeholder="Old tag"
                    className="text-input"
                    style={{ width: "100%", maxWidth: 180 }}
                  />

                  <input
                    value={renameTo}
                    onChange={(e) => setRenameTo(e.target.value)}
                    placeholder="New tag"
                    className="text-input"
                    style={{ width: "100%", maxWidth: 180 }}
                  />

                  <button onClick={renameTag} className="button-secondary">
                    Rename tag
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {filteredCards.map((card) => {
          const expanded = expandedId === card.id;
          const selected = selectedForPractice.includes(card.id);
          const stale = staleLabel(card);
          const showStats = !!showStatsByCard[card.id];
          const showAllTags = !!showAllTagsByCard[card.id];
          const visibleTags = showAllTags ? card.tags : card.tags.slice(0, 4);

          const showAllInlinePicker = !!showAllInlinePickerByCard[card.id];
          const visibleInlinePickerTags = showAllInlinePicker ? allTags : allTags.slice(0, 4);

          return (
            <div key={card.id} className="card">
              <div
                className="controls-row"
                style={{ justifyContent: "space-between", alignItems: "flex-start" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => handleSelectionToggle(e.target.checked, card.id)}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      cursor: "pointer",
                      flex: 1,
                    }}
                    onClick={() => setExpandedId(expanded ? null : card.id)}
                  >
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{card.phrase}</span>

                    {visibleTags.map((tag) => (
                      <span key={tag} className="badge" style={tagPillStyle(tag)}>
                        {tag}
                      </span>
                    ))}

                    {card.tags.length > 4 && !showAllTags && (
                      <button
                        className="tag-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAllTagsByCard((prev) => ({ ...prev, [card.id]: true }));
                        }}
                      >
                        +{card.tags.length - 4} more
                      </button>
                    )}

                    {card.tags.length > 4 && showAllTags && (
                      <button
                        className="tag-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAllTagsByCard((prev) => ({ ...prev, [card.id]: false }));
                        }}
                      >
                        show less
                      </button>
                    )}
                  </div>
                </div>

                <div className="inline-row">
                  {stale && (
                    <span
                      className="badge"
                      style={{ backgroundColor: "#e0f2fe", color: "#075985" }}
                    >
                      {stale}
                    </span>
                  )}

                  <span
                    className="badge"
                    style={{ background: masteryColor(card), color: "#111827" }}
                  >
                    {masteryText(card)}
                  </span>
                </div>
              </div>

              {expanded && (
                <div style={{ marginTop: 12 }}>
                  <p><b>Translation:</b> {card.translation_en}</p>
                  <p><b>Forklaring:</b> {card.short_explanation}</p>
                  <p><b>Eksempel:</b> {card.example_da}</p>
                  <p><b>Example:</b> {card.example_en}</p>
                  <p><b>Extra info:</b> {card.extra_info || "—"}</p>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 12,
                      marginBottom: 12,
                    }}
                  >
                    <input
                      value={inlineTagInputByCard[card.id] || ""}
                      onChange={(e) =>
                        setInlineTagInputByCard((prev) => ({
                          ...prev,
                          [card.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => void handleInlineCardTagKeyDown(e, card)}
                      placeholder="New tag..."
                      className="text-input"
                      style={{ width: "100%", maxWidth: 160 }}
                    />

                    {visibleInlinePickerTags.map((tag) => {
                      const selectedOnCard = card.tags.includes(tag);

                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => void toggleInlineCardTag(card, tag)}
                          className={selectedOnCard ? "tag-pill-selected" : "tag-pill"}
                          style={tagPillStyle(tag)}
                        >
                          {selectedOnCard ? `${tag} ✕` : tag}
                        </button>
                      );
                    })}

                    {allTags.length > 4 && !showAllInlinePicker && (
                      <button
                        className="tag-pill"
                        onClick={() =>
                          setShowAllInlinePickerByCard((prev) => ({
                            ...prev,
                            [card.id]: true,
                          }))
                        }
                      >
                        +{allTags.length - 4} more
                      </button>
                    )}

                    {allTags.length > 4 && showAllInlinePicker && (
                      <button
                        className="tag-pill"
                        onClick={() =>
                          setShowAllInlinePickerByCard((prev) => ({
                            ...prev,
                            [card.id]: false,
                          }))
                        }
                      >
                        show less
                      </button>
                    )}
                  </div>

                  <div className="controls-row" style={{ marginTop: 10 }}>
                    <button onClick={() => startEditing(card)} className="button-secondary">
                      Edit
                    </button>

                    <button onClick={() => void refreshAnalysis(card)} className="button-secondary">
                      Refresh AI
                    </button>

                    <button onClick={() => toggleShowStats(card.id)} className="button-secondary">
                      {showStats ? "Hide stats" : "Show stats"}
                    </button>

                    <button onClick={() => void resetProgress(card.id)} className="button-secondary">
                      Reset progress
                    </button>

                    <button onClick={() => void deleteCard(card.id)} className="button-danger">
                      Delete
                    </button>
                  </div>

                  {showStats && (
                    <div style={{ marginTop: 12 }}>
                      <p><b>Attempts:</b> {attemptsOf(card)}</p>
                      <p><b>Correct:</b> {correctOf(card)}</p>
                      <p><b>Almost:</b> {almostOf(card)}</p>
                      <p><b>Wrong:</b> {wrongOf(card)}</p>
                      <p><b>Success:</b> {Math.round(successScore(card) * 100)}%</p>
                      <p>
                        <b>Last attempted:</b>{" "}
                        {card.last_practiced_at
                          ? new Date(card.last_practiced_at).toLocaleString()
                          : "Never"}
                      </p>
                    </div>
                  )}

                  {editingId === card.id && editDraft && (
                    <div style={{ marginTop: 16 }}>
                      <input
                        value={editDraft.phrase}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, phrase: e.target.value })
                        }
                        className="text-input"
                        style={{ width: "100%", marginBottom: 8 }}
                      />

                      <input
                        value={editDraft.translation_en}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, translation_en: e.target.value })
                        }
                        className="text-input"
                        style={{ width: "100%", marginBottom: 8 }}
                      />

                      <textarea
                        value={editDraft.short_explanation}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, short_explanation: e.target.value })
                        }
                        className="textarea-input"
                        style={{ marginBottom: 8 }}
                      />

                      <textarea
                        value={editDraft.example_da}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, example_da: e.target.value })
                        }
                        className="textarea-input"
                        style={{ marginBottom: 8 }}
                      />

                      <textarea
                        value={editDraft.example_en}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, example_en: e.target.value })
                        }
                        className="textarea-input"
                        style={{ marginBottom: 8 }}
                      />

                      <input
                        value={editDraft.extra_info}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, extra_info: e.target.value })
                        }
                        className="text-input"
                        placeholder="Extra info..."
                        style={{ width: "100%", marginBottom: 8 }}
                      />

                      <div className="controls-row" style={{ marginTop: 10 }}>
                        <button onClick={() => void saveEdit(card.id)} className="button-primary">
                          Save
                        </button>

                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft(null);
                          }}
                          className="button-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
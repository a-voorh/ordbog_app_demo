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
  meanings?: string[];
  times_attempted?: number | null;
  times_correct?: number | null;
  times_almost?: number | null;
  times_wrong?: number | null;
  last_practiced_at?: string | null;
  times_spontaneous_correct?: number | null;
  times_spontaneous_almost?: number | null;
  times_spontaneous_wrong?: number | null;
  last_spontaneous_used_at?: string | null;
  times_retry_correct?: number | null;
  times_re_requested?: number | null;
  last_requested_again_at?: string | null;
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
  meanings?: string[];
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

type MeaningOption = {
  translation_en: string;
  short_explanation_da: string;
  example_da: string;
};

type MeaningDetectionResult = {
  phrase: string;
  options: MeaningOption[];
};

type PendingMeaningChoice = {
  source: "draft" | "pending";
  rawPhrase: string;
  normalizedTags: string[];
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

type GeneratedUsageVariant = {
  variant_da: string;
  variant_tag?: string | null;
};

type DatabaseViewMode = "attention" | "all";

type RefreshEntityType = "phrase" | "draft";

type RefreshField =
  | "translation_en"
  | "short_explanation"
  | "extra_info"
  | "example_da"
  | "example_en";

type RefreshAction =
  | "generate_meaning_candidates"
  | "set_meaning"
  | "rewrite_shorter"
  | "rewrite_clearer"
  | "rewrite_format"
  | "new_example"
  | "less_straightforward"
  | "more_natural"
  | "retranslate_from_danish";

type RefreshableItem = PhraseCard | PendingDraft;

type RefreshMeaningPickerState = {
  open: boolean;
  itemId: string | null;
  entityType: RefreshEntityType | null;
  candidates: string[];
};

  const refreshButtonStyle = (isLoading: boolean) =>
    ({
      opacity: isLoading ? 0.7 : 1,
      cursor: isLoading ? "wait" : "pointer",
      transform: isLoading ? "scale(0.98)" : "scale(1)",
      transition: "all 0.15s ease",
    }) as const;

const normalizeTag = (tag: string) => tag.trim();

const normalizePhraseKey = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeMeaningKey = (value?: string | null) =>
  (value || "").trim().toLowerCase().replace(/\s+/g, " ");

const isSamePhraseMeaning = (
  a: { phrase: string; translation_en?: string | null },
  b: { phrase: string; translation_en?: string | null }
) =>
  normalizePhraseKey(a.phrase) === normalizePhraseKey(b.phrase) &&
  normalizeMeaningKey(a.translation_en) === normalizeMeaningKey(b.translation_en);

const sortKeyDa = (phrase: string) => phrase.trim().replace(/^at\s+/i, "");

const sortByPhraseDa = <T extends { phrase: string; translation_en?: string }>(
  items: T[]
) =>
  [...items].sort((a, b) => {
    const phraseCompare = sortKeyDa(a.phrase).localeCompare(
      sortKeyDa(b.phrase),
      "da"
    );
    if (phraseCompare !== 0) return phraseCompare;
    return (a.translation_en || "").localeCompare(b.translation_en || "", "en");
  });

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
  const [savingPhraseToPendingDraft, setSavingPhraseToPendingDraft] = useState(false);

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

  const [meaningPickerOpen, setMeaningPickerOpen] = useState(false);
  const [meaningPickerLoading, setMeaningPickerLoading] = useState(false);
  const [meaningPickerError, setMeaningPickerError] = useState<string | null>(null);
  const [meaningOptions, setMeaningOptions] = useState<MeaningOption[]>([]);
  const [pendingMeaningChoice, setPendingMeaningChoice] = useState<PendingMeaningChoice | null>(null);

  const [refreshMeaningPicker, setRefreshMeaningPicker] =
    useState<RefreshMeaningPickerState>({
      open: false,
      itemId: null,
      entityType: null,
      candidates: [],
    });

  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);

  const lookupInputRef = useRef<HTMLInputElement | null>(null);

  const refreshBtnClass =
    "ml-2 rounded border px-2 py-0.5 text-xs hover:bg-neutral-100";

  useEffect(() => {
    const load = async () => {
      const { data: phraseData } = await supabase.from("phrases").select("*");
      setCards(sortByPhraseDa((phraseData || []) as PhraseCard[]));

      const { data: draftData } = await supabase
        .from("phrase_drafts")
        .select("*")
        .order("created_at", { ascending: false });

      setPendingDrafts(sortByPhraseDa((draftData || []) as PendingDraft[]));
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

  const spontaneousCorrectOf = (card: PhraseCard) =>
    card.times_spontaneous_correct ?? 0;
  const spontaneousAlmostOf = (card: PhraseCard) =>
    card.times_spontaneous_almost ?? 0;
  const spontaneousWrongOf = (card: PhraseCard) =>
    card.times_spontaneous_wrong ?? 0;
  const retryCorrectOf = (card: PhraseCard) => card.times_retry_correct ?? 0;
  const reRequestedOf = (card: PhraseCard) => card.times_re_requested ?? 0;

  const daysSinceIso = (iso?: string | null) => {
    if (!iso) return null;
    const diffMs = Date.now() - new Date(iso).getTime();
    return diffMs / (1000 * 60 * 60 * 24);
  };

  const daysSinceLastPracticed = (card: PhraseCard) =>
    daysSinceIso(card.last_practiced_at);

  const masteryPoints = (card: PhraseCard) => {
    const promptedCorrect = correctOf(card) * 1.0;
    const promptedAlmost = almostOf(card) * 0.6;
    const promptedWrong = wrongOf(card) * -1.0;

    const spontaneousCorrect = spontaneousCorrectOf(card) * 2.0;
    const spontaneousAlmost = spontaneousAlmostOf(card) * 1.2;
    const spontaneousWrong = spontaneousWrongOf(card) * 0.0;

    const retryCorrect = retryCorrectOf(card) * 0.3;

    const total =
      promptedCorrect +
      promptedAlmost +
      promptedWrong +
      spontaneousCorrect +
      spontaneousAlmost +
      spontaneousWrong +
      retryCorrect;

    return Math.max(0, total);
  };

  const masteryLabel = (card: PhraseCard) => {
    const points = masteryPoints(card);

    if (points < 2) return "new";
    if (points < 5) return "familiar";
    if (points < 9) return "active";
    if (spontaneousCorrectOf(card) >= 1) return "automatic";
    return "active";
  };

  const masteryColor = (card: PhraseCard) => {
    const label = masteryLabel(card);

    if (label === "new") return "#e5e7eb";
    if (label === "familiar") return "#dbeafe";
    if (label === "active") return "#dcfce7";
    return "#fef3c7";
  };

  const masteryText = (card: PhraseCard) => masteryLabel(card);

  const masteryTextColor = (card: PhraseCard) => {
    const label = masteryLabel(card);

    if (label === "new") return "#374151";
    if (label === "familiar") return "#1d4ed8";
    if (label === "active") return "#166534";
    return "#92400e";
  };

  const staleLabel = (card: PhraseCard) => {
    const days = daysSinceLastPracticed(card);
    if (days === null) return "";
    if (days > 30) return "stale";
    if (days > 14) return "needs review";
    if (days > 7) return "review soon";
    return "";
  };

  const attentionCards = useMemo(() => {
    const scored = [...cards].sort((a, b) => {
      const aPoints = masteryPoints(a);
      const bPoints = masteryPoints(b);

      if (aPoints !== bPoints) return aPoints - bPoints;

      const aBoost = reRequestedOf(a);
      const bBoost = reRequestedOf(b);

      if (aBoost !== bBoost) return bBoost - aBoost;

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
    (card) => masteryLabel(card) === "active" || masteryLabel(card) === "automatic"
  ).length;

  const needsReviewCount = cards.filter((card) => {
    const label = masteryLabel(card);
    const days = daysSinceLastPracticed(card);
    return label === "new" || label === "familiar" || (days !== null && days > 14);
  }).length;

  const hasSamePhraseMeaningInCards = (
    phraseValue: string,
    translationEn: string,
    excludeCardId?: string
  ) => {
    return cards.some(
      (card) =>
        card.id !== excludeCardId &&
        isSamePhraseMeaning(card, {
          phrase: phraseValue,
          translation_en: translationEn,
        })
    );
  };

  const hasSamePhraseMeaningInPendingDrafts = (
    phraseValue: string,
    translationEn: string,
    excludeDraftId?: string
  ) => {
    return pendingDrafts.some(
      (draft) =>
        draft.id !== excludeDraftId &&
        isSamePhraseMeaning(draft, {
          phrase: phraseValue,
          translation_en: translationEn,
        })
    );
  };

  const getRefreshKey = (id: string, field: RefreshField) => `${id}:${field}`;

  const updateItemInList = <T extends RefreshableItem>(
    items: T[],
    id: string,
    updates: Partial<T>
  ): T[] => items.map((item) => (item.id === id ? { ...item, ...updates } : item));

  const findRefreshItemById = (
    entityType: RefreshEntityType,
    id: string
  ): RefreshableItem | null => {
    if (entityType === "phrase") {
      return cards.find((card) => card.id === id) ?? null;
    }
    return pendingDrafts.find((draft) => draft.id === id) ?? null;
  };

  const applyUpdatedFieldsLocally = (
    entityType: RefreshEntityType,
    id: string,
    updatedFields: Partial<RefreshableItem>
  ) => {
    if (entityType === "phrase") {
      setCards((prev) =>
        sortByPhraseDa(
          updateItemInList(prev, id, updatedFields as Partial<PhraseCard>)
        )
      );

      setAnalysis((prev) =>
        prev?.id === id ? ({ ...prev, ...updatedFields } as PhraseCard) : prev
      );
    } else {
      setPendingDrafts((prev) =>
        sortByPhraseDa(
          updateItemInList(prev, id, updatedFields as Partial<PendingDraft>)
        )
      );
    }
  };

  const closeRefreshMeaningPicker = () => {
    setRefreshMeaningPicker({
      open: false,
      itemId: null,
      entityType: null,
      candidates: [],
    });
  };

  const maybeRefreshUsageVariantsAfterFieldRefresh = async (
    entityType: RefreshEntityType,
    id: string,
    updatedFields: Partial<RefreshableItem>
  ) => {
    if (entityType !== "phrase") return;

    const currentCard = cards.find((card) => card.id === id);
    if (!currentCard) return;

    const merged: PhraseCard = {
      ...currentCard,
      ...(updatedFields as Partial<PhraseCard>),
    };

    await replaceUsageVariantsForPhrase(id, {
      phrase: merged.phrase,
      translation_en: merged.translation_en,
      short_explanation: merged.short_explanation,
      example_da: merged.example_da,
      example_en: merged.example_en,
      extra_info: merged.extra_info,
    });
  };

  const callRefreshField = async (params: {
    entityType: RefreshEntityType;
    id: string;
    field: RefreshField;
    action: RefreshAction;
    existingMeanings?: string[];
    selectedMeaning?: string;
  }) => {
    const key = getRefreshKey(params.id, params.field);
    setRefreshingKey(key);

    try {
      const res = await fetch("/api/refresh-card-field", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to refresh field.");
      }

      return json;
    } finally {
      setRefreshingKey(null);
    }
  };

  const openMeaningCandidatesForItem = async (
    item: RefreshableItem,
    entityType: RefreshEntityType
  ) => {
    try {
      const json = await callRefreshField({
        entityType,
        id: item.id,
        field: "translation_en",
        action: "generate_meaning_candidates",
        existingMeanings: item.meanings ?? [],
      });

      setRefreshMeaningPicker({
        open: true,
        itemId: item.id,
        entityType,
        candidates: Array.isArray(json.candidates) ? json.candidates : [],
      });
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Could not load meaning candidates."
      );
    }
  };

  const chooseMeaningForItem = async (
    itemId: string,
    entityType: RefreshEntityType,
    selectedMeaning: string
  ) => {
    try {
      const item = findRefreshItemById(entityType, itemId);
      if (!item) {
        alert("Could not find the item to update.");
        return;
      }

      const json = await callRefreshField({
        entityType,
        id: itemId,
        field: "translation_en",
        action: "set_meaning",
        selectedMeaning,
      });

      const updatedMeaningList = Array.from(
        new Set(
          [
            ...(item.meanings ?? []),
            ...refreshMeaningPicker.candidates,
            selectedMeaning,
          ]
            .map((x) => x.trim())
            .filter(Boolean)
        )
      );

      const updatedFields: Partial<RefreshableItem> = {
        ...(json.updatedFields || {}),
        meanings: updatedMeaningList,
      };

      applyUpdatedFieldsLocally(entityType, itemId, updatedFields);
      await maybeRefreshUsageVariantsAfterFieldRefresh(
        entityType,
        itemId,
        updatedFields
      );
      closeRefreshMeaningPicker();
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error ? error.message : "Could not save selected meaning."
      );
    }
  };

  const refreshExplanationField = async (
    item: RefreshableItem,
    entityType: RefreshEntityType,
    action: "rewrite_shorter" | "rewrite_clearer" = "rewrite_shorter"
  ) => {
    try {
      const json = await callRefreshField({
        entityType,
        id: item.id,
        field: "short_explanation",
        action,
      });

      const updatedFields = (json.updatedFields || {}) as Partial<RefreshableItem>;
      applyUpdatedFieldsLocally(entityType, item.id, updatedFields);
      await maybeRefreshUsageVariantsAfterFieldRefresh(
        entityType,
        item.id,
        updatedFields
      );
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error ? error.message : "Could not refresh explanation."
      );
    }
  };

  const refreshExtraInfoField = async (
    item: RefreshableItem,
    entityType: RefreshEntityType
  ) => {
    try {
      const json = await callRefreshField({
        entityType,
        id: item.id,
        field: "extra_info",
        action: "rewrite_format",
      });

      const updatedFields = (json.updatedFields || {}) as Partial<RefreshableItem>;
      applyUpdatedFieldsLocally(entityType, item.id, updatedFields);
      await maybeRefreshUsageVariantsAfterFieldRefresh(
        entityType,
        item.id,
        updatedFields
      );
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error ? error.message : "Could not refresh extra info."
      );
    }
  };

  const refreshDanishExampleField = async (
    item: RefreshableItem,
    entityType: RefreshEntityType,
    action: "new_example" | "less_straightforward" | "more_natural" = "new_example"
  ) => {
    try {
      const json = await callRefreshField({
        entityType,
        id: item.id,
        field: "example_da",
        action,
      });

      const updatedFields = (json.updatedFields || {}) as Partial<RefreshableItem>;
      applyUpdatedFieldsLocally(entityType, item.id, updatedFields);
      await maybeRefreshUsageVariantsAfterFieldRefresh(
        entityType,
        item.id,
        updatedFields
      );
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Could not refresh example.");
    }
  };

  const refreshEnglishExampleField = async (
    item: RefreshableItem,
    entityType: RefreshEntityType
  ) => {
    try {
      const json = await callRefreshField({
        entityType,
        id: item.id,
        field: "example_en",
        action: "retranslate_from_danish",
      });

      const updatedFields = (json.updatedFields || {}) as Partial<RefreshableItem>;
      applyUpdatedFieldsLocally(entityType, item.id, updatedFields);
      await maybeRefreshUsageVariantsAfterFieldRefresh(
        entityType,
        item.id,
        updatedFields
      );
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Could not refresh English example."
      );
    }
  };

  const resetMeaningPicker = () => {
    setMeaningPickerOpen(false);
    setMeaningPickerLoading(false);
    setMeaningPickerError(null);
    setMeaningOptions([]);
    setPendingMeaningChoice(null);
  };

  const generateUsageVariants = async (input: {
    phrase: string;
    translation_en: string;
    short_explanation: string;
    example_da: string;
    example_en: string;
    extra_info?: string | null;
  }) => {
    try {
      const res = await fetch("/api/generate-usage-variants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Usage variant backend error:", data);
        return [] as GeneratedUsageVariant[];
      }

      try {
        const parsed = JSON.parse(data.result) as GeneratedUsageVariant[];

        const cleaned = parsed
          .map((item) => ({
            variant_da: item.variant_da?.trim(),
            variant_tag: item.variant_tag?.trim() || null,
          }))
          .filter((item) => item.variant_da);

        const deduped = Array.from(
          new Map(
            cleaned.map((item) => [normalizePhraseKey(item.variant_da), item])
          ).values()
        );

        return deduped;
      } catch (err) {
        console.error("Invalid JSON from usage variant route:", data?.result, err);
        return [] as GeneratedUsageVariant[];
      }
    } catch (err) {
      console.error("Failed to generate usage variants:", err);
      return [] as GeneratedUsageVariant[];
    }
  };

  const replaceUsageVariantsForPhrase = async (
    phraseId: string,
    input: {
      phrase: string;
      translation_en: string;
      short_explanation: string;
      example_da: string;
      example_en: string;
      extra_info?: string | null;
    }
  ) => {
    const generatedVariants = await generateUsageVariants(input);

    const { error: deleteError } = await supabase
      .from("phrase_usage_variants_main")
      .delete()
      .eq("phrase_id", phraseId);

    if (deleteError) {
      console.error("Failed to clear existing usage variants:", deleteError);
      return;
    }

    if (generatedVariants.length === 0) {
      return;
    }

    const rows = generatedVariants.map((variant) => ({
      phrase_id: phraseId,
      variant_da: variant.variant_da,
      variant_tag: variant.variant_tag ?? null,
      usable_for_matching: true,
      usable_for_practice: true,
      source: "generated",
    }));

    const { error: insertError } = await supabase
      .from("phrase_usage_variants_main")
      .insert(rows);

    if (insertError) {
      console.error("Failed to save usage variants:", insertError);
    }
  };

  const bumpRequestedAgain = async (
    phraseKey: string,
    translationEn?: string | null
  ) => {
    const existingCard = cards.find((card) => {
      const samePhrase =
        normalizePhraseKey(card.phrase) === normalizePhraseKey(phraseKey);
      if (!samePhrase) return false;

      if (!translationEn) return true;

      return (
        normalizeMeaningKey(card.translation_en) ===
        normalizeMeaningKey(translationEn)
      );
    });

    if (!existingCard) return false;

    const nextRequestedCount = (existingCard.times_re_requested ?? 0) + 1;
    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("phrases")
      .update({
        times_re_requested: nextRequestedCount,
        last_requested_again_at: nowIso,
      })
      .eq("id", existingCard.id);

    if (updateError) {
      console.error("Failed to bump requested-again stats:", updateError);
      return true;
    }

    setCards((prev) =>
      prev.map((card) =>
        card.id === existingCard.id
          ? {
              ...card,
              times_re_requested: nextRequestedCount,
              last_requested_again_at: nowIso,
            }
          : card
      )
    );

    if (analysis?.id === existingCard.id) {
      setAnalysis((prev) =>
        prev
          ? {
              ...prev,
              times_re_requested: nextRequestedCount,
              last_requested_again_at: nowIso,
            }
          : prev
      );
    }

    return true;
  };

  const detectPhraseMeanings = async (p: string) => {
    const res = await fetch("/api/detect-phrase-meanings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phrase: p }),
    });

    const data = await res.json();
    if (!res.ok) return null;

    return data as MeaningDetectionResult;
  };

  const analyzePhrase = async (p: string, translationEn?: string) => {
    const res = await fetch("/api/analyze-phrase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phrase: p,
        ...(translationEn ? { translation_en: translationEn } : {}),
      }),
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
      const translationEn = lookupResult.translation_en;

      const duplicateInCards = hasSamePhraseMeaningInCards(
        correctedPhrase,
        translationEn
      );

      if (duplicateInCards) {
        await bumpRequestedAgain(correctedPhrase, translationEn);
        setLookupStatus(`Already in database: ${correctedPhrase} (${translationEn})`);
        return;
      }

      const duplicateInPendingDrafts = hasSamePhraseMeaningInPendingDrafts(
        correctedPhrase,
        translationEn
      );

      if (duplicateInPendingDrafts) {
        setLookupStatus(`Already waiting in drafts: ${correctedPhrase} (${translationEn})`);
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
        meanings: [lookupResult.translation_en],
        created_at: new Date().toISOString(),
        source: "lookup",
      };

      const { error } = await supabase.from("phrase_drafts").insert(newDraft);

      if (error) {
        console.error("Failed to save lookup draft:", error);
        setLookupStatus("Failed to save draft.");
        return;
      }

      setPendingDrafts((prev) => sortByPhraseDa([newDraft, ...prev]));
      setLookupStatus(`Draft created: ${correctedPhrase}`);
    } catch (err) {
      console.error("Failed to save lookup draft:", err);
      setLookupStatus("Something went wrong.");
    } finally {
      setSavingLookupDraft(false);
    }
  };

  const createDraftCardFromAnalysis = (
    parsed: AnalysisResult,
    normalizedTags: string[]
  ) => {
    setDraftCard({
      phrase: parsed.corrected_phrase.trim(),
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
  };

  const createPendingDraftFromAnalysis = async (
    parsed: AnalysisResult,
    normalizedTags: string[]
  ) => {
    const correctedPhrase = parsed.corrected_phrase.trim();
    const translationEn = parsed.translation_en;

    const duplicateInCards = hasSamePhraseMeaningInCards(
      correctedPhrase,
      translationEn
    );
    const duplicateInPendingDrafts = hasSamePhraseMeaningInPendingDrafts(
      correctedPhrase,
      translationEn
    );

    if (duplicateInCards || duplicateInPendingDrafts) {
      if (duplicateInCards) {
        await bumpRequestedAgain(correctedPhrase, translationEn);
      }

      alert(`This phrase already exists: ${correctedPhrase} (${translationEn})`);
      return;
    }

    const newDraft: PendingDraft = {
      id: crypto.randomUUID(),
      phrase: correctedPhrase,
      translation_en: parsed.translation_en,
      short_explanation: parsed.short_explanation_da,
      example_da: parsed.example_da,
      example_en: parsed.example_en,
      extra_info: parsed.extra_info,
      tags: normalizedTags,
      meanings: [parsed.translation_en],
      created_at: new Date().toISOString(),
      source: "phrase_input",
    };

    const { error } = await supabase.from("phrase_drafts").insert(newDraft);

    if (error) {
      alert("Could not save draft.");
      return;
    }

    setPendingDrafts((prev) => sortByPhraseDa([newDraft, ...prev]));
    setPhrase("");
  };

  const beginMeaningChoiceFlow = async (
    rawPhrase: string,
    source: "draft" | "pending",
    normalizedTags: string[]
  ) => {
    setMeaningPickerLoading(true);
    setMeaningPickerError(null);

    try {
      const detected = await detectPhraseMeanings(rawPhrase);

      if (!detected || !Array.isArray(detected.options) || detected.options.length === 0) {
        const parsed = await analyzePhrase(rawPhrase);

        if (!parsed) {
          alert("Could not analyze this phrase.");
          return;
        }

        if (source === "draft") {
          createDraftCardFromAnalysis(parsed, normalizedTags);
        } else {
          await createPendingDraftFromAnalysis(parsed, normalizedTags);
        }

        return;
      }

      if (detected.options.length === 1) {
        const chosenMeaning = detected.options[0].translation_en;
        const parsed = await analyzePhrase(rawPhrase, chosenMeaning);

        if (!parsed) {
          alert("Could not analyze this phrase.");
          return;
        }

        if (source === "draft") {
          createDraftCardFromAnalysis(parsed, normalizedTags);
        } else {
          await createPendingDraftFromAnalysis(parsed, normalizedTags);
        }

        return;
      }

      setPendingMeaningChoice({
        source,
        rawPhrase,
        normalizedTags,
      });
      setMeaningOptions(detected.options);
      setMeaningPickerOpen(true);
    } finally {
      setMeaningPickerLoading(false);
    }
  };

  const confirmMeaningChoice = async (option: MeaningOption) => {
    if (!pendingMeaningChoice) return;

    const { source, rawPhrase, normalizedTags } = pendingMeaningChoice;

    setMeaningPickerLoading(true);
    setMeaningPickerError(null);

    try {
      const parsed = await analyzePhrase(rawPhrase, option.translation_en);

      if (!parsed) {
        setMeaningPickerError("Could not generate the card for that meaning.");
        return;
      }

      resetMeaningPicker();

      if (source === "draft") {
        createDraftCardFromAnalysis(parsed, normalizedTags);
      } else {
        await createPendingDraftFromAnalysis(parsed, normalizedTags);
      }
    } finally {
      setMeaningPickerLoading(false);
    }
  };

  const closeMeaningPicker = () => {
    if (meaningPickerLoading) return;
    resetMeaningPicker();
  };

  const createPendingDraftFromPhrase = async () => {
    if (!phrase.trim()) return;

    setSavingPhraseToPendingDraft(true);

    try {
      const normalizedTags = Array.from(
        new Set(selectedTags.map(normalizeTag).filter(Boolean))
      );

      await beginMeaningChoiceFlow(phrase.trim(), "pending", normalizedTags);
    } finally {
      setSavingPhraseToPendingDraft(false);
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

    try {
      const normalizedTags = Array.from(
        new Set(selectedTags.map(normalizeTag).filter(Boolean))
      );

      await beginMeaningChoiceFlow(phrase.trim(), "draft", normalizedTags);
    } finally {
      setLoading(false);
    }
  };

  const saveDraftToDatabase = async () => {
    if (!draftCard) return;

    const normalizedPhrase = draftCard.phrase.trim();
    const translationEn = draftCard.translation_en;

    const duplicate = hasSamePhraseMeaningInCards(
      normalizedPhrase,
      translationEn
    );

    if (duplicate) {
      alert(`This phrase already exists: ${normalizedPhrase} (${translationEn})`);
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
      meanings: [draftCard.translation_en],
      times_attempted: 0,
      times_correct: 0,
      times_almost: 0,
      times_wrong: 0,
      last_practiced_at: null,
      times_spontaneous_correct: 0,
      times_spontaneous_almost: 0,
      times_spontaneous_wrong: 0,
      last_spontaneous_used_at: null,
      times_retry_correct: 0,
      times_re_requested: 0,
      last_requested_again_at: null,
    };

    const { error } = await supabase.from("phrases").insert(newCard);

    if (error) {
      console.error("Save phrase error:", error);
      alert(`Could not save the phrase: ${error.message}`);
      return;
    }

    await replaceUsageVariantsForPhrase(newCard.id, {
      phrase: newCard.phrase,
      translation_en: newCard.translation_en,
      short_explanation: newCard.short_explanation,
      example_da: newCard.example_da,
      example_en: newCard.example_en,
      extra_info: newCard.extra_info,
    });

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

    const parsed = await analyzePhrase(draftCard.phrase, draftCard.translation_en);
    if (!parsed) return;

    const refreshedPhrase = parsed.corrected_phrase.trim();

    const duplicate = hasSamePhraseMeaningInCards(
      refreshedPhrase,
      parsed.translation_en
    );

    if (duplicate) {
      alert(
        `Cannot refresh because this phrase already exists: ${refreshedPhrase} (${parsed.translation_en})`
      );
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
      sortByPhraseDa(prev.map((d) => (d.id === draftId ? { ...d, tags: normalized } : d)))
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
      times_spontaneous_correct: 0,
      times_spontaneous_almost: 0,
      times_spontaneous_wrong: 0,
      times_retry_correct: 0,
      times_re_requested: 0,
      last_practiced_at: null,
      last_spontaneous_used_at: null,
      last_requested_again_at: null,
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

    const duplicate = hasSamePhraseMeaningInCards(
      editDraft.phrase,
      editDraft.translation_en,
      id
    );

    if (duplicate) {
      alert(`This phrase already exists: ${editDraft.phrase.trim()} (${editDraft.translation_en})`);
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

    await replaceUsageVariantsForPhrase(id, {
      phrase: updates.phrase,
      translation_en: updates.translation_en,
      short_explanation: updates.short_explanation,
      example_da: updates.example_da,
      example_en: updates.example_en,
      extra_info: updates.extra_info,
    });

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

    const duplicateInCards = hasSamePhraseMeaningInCards(
      pendingDraftEdit.phrase,
      pendingDraftEdit.translation_en
    );

    if (duplicateInCards) {
      alert(
        `This phrase already exists in the database: ${pendingDraftEdit.phrase.trim()} (${pendingDraftEdit.translation_en})`
      );
      return;
    }

    const duplicateInDrafts = hasSamePhraseMeaningInPendingDrafts(
      pendingDraftEdit.phrase,
      pendingDraftEdit.translation_en,
      draftId
    );

    if (duplicateInDrafts) {
      alert(
        `This draft already exists: ${pendingDraftEdit.phrase.trim()} (${pendingDraftEdit.translation_en})`
      );
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
      sortByPhraseDa(prev.map((d) => (d.id === draftId ? { ...d, ...updates } : d)))
    );

    setEditingPendingDraftId(null);
    setPendingDraftEdit(null);
  };

  const refreshAnalysis = async (card: PhraseCard) => {
    const parsed = await analyzePhrase(card.phrase, card.translation_en);
    if (!parsed) return;

    const refreshedPhrase = parsed.corrected_phrase.trim();

    const duplicate = hasSamePhraseMeaningInCards(
      refreshedPhrase,
      parsed.translation_en,
      card.id
    );

    if (duplicate) {
      alert(
        `Cannot refresh because this would duplicate: ${refreshedPhrase} (${parsed.translation_en})`
      );
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

    await replaceUsageVariantsForPhrase(card.id, {
      phrase: updates.phrase,
      translation_en: updates.translation_en,
      short_explanation: updates.short_explanation,
      example_da: updates.example_da,
      example_en: updates.example_en,
      extra_info: updates.extra_info,
    });

    setCards((prev) =>
      sortByPhraseDa(prev.map((c) => (c.id === card.id ? { ...c, ...updates } : c)))
    );

    setAnalysis((prev) => (prev?.id === card.id ? { ...prev, ...updates } : prev));
  };

  const refreshPendingDraftAnalysis = async (draft: PendingDraft) => {
    const parsed = await analyzePhrase(draft.phrase, draft.translation_en);
    if (!parsed) return;

    const refreshedPhrase = parsed.corrected_phrase.trim();

    const duplicateInCards = hasSamePhraseMeaningInCards(
      refreshedPhrase,
      parsed.translation_en
    );

    if (duplicateInCards) {
      alert(
        `Cannot refresh because this phrase already exists: ${refreshedPhrase} (${parsed.translation_en})`
      );
      return;
    }

    const duplicateInDrafts = hasSamePhraseMeaningInPendingDrafts(
      refreshedPhrase,
      parsed.translation_en,
      draft.id
    );

    if (duplicateInDrafts) {
      alert(
        `Cannot refresh because another draft already exists: ${refreshedPhrase} (${parsed.translation_en})`
      );
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
      sortByPhraseDa(prev.map((d) => (d.id === draft.id ? { ...d, ...updates } : d)))
    );
  };

  const savePendingDraftToDatabase = async (draft: PendingDraft) => {
    const duplicateInCards = hasSamePhraseMeaningInCards(
      draft.phrase,
      draft.translation_en
    );

    if (duplicateInCards) {
      alert(`This phrase already exists in the database: ${draft.phrase} (${draft.translation_en})`);
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
      meanings: draft.meanings ?? [draft.translation_en],
      times_attempted: 0,
      times_correct: 0,
      times_almost: 0,
      times_wrong: 0,
      last_practiced_at: null,
      times_spontaneous_correct: 0,
      times_spontaneous_almost: 0,
      times_spontaneous_wrong: 0,
      last_spontaneous_used_at: null,
      times_retry_correct: 0,
      times_re_requested: 0,
      last_requested_again_at: null,
    };

    const { error: insertError } = await supabase.from("phrases").insert(newCard);

    if (insertError) {
      console.error("Save pending draft error:", insertError);
      alert(`Could not save draft to database: ${insertError.message}`);
      return;
    }

    await replaceUsageVariantsForPhrase(newCard.id, {
      phrase: newCard.phrase,
      translation_en: newCard.translation_en,
      short_explanation: newCard.short_explanation,
      example_da: newCard.example_da,
      example_en: newCard.example_en,
      extra_info: newCard.extra_info,
    });

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
    setPendingDrafts(sortByPhraseDa(updatedPendingDrafts));

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
            className="nav-button button-full"
            style={{
              display: "block",
              textAlign: "center",
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
            className="button-secondary button-full"
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

        <div
          className="inline-action-row"
          style={{
            display: "flex",
            gap: 12,
            alignItems: "stretch",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => void createDraftFromPhrase()}
            className="button-primary"
            style={{
              padding: "14px 16px",
              fontSize: 16,
              minHeight: 52,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            disabled={loading || savingPhraseToPendingDraft || meaningPickerLoading}
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>

          <button
            onClick={() => void createPendingDraftFromPhrase()}
            className="button-secondary"
            style={{
              padding: "14px 16px",
              fontSize: 16,
              minHeight: 52,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            disabled={loading || savingPhraseToPendingDraft || meaningPickerLoading}
          >
            {savingPhraseToPendingDraft ? "Saving..." : "Create draft"}
          </button>
        </div>
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
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1 }}>
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

                  <button
                    type="button"
                    className="button-secondary button-small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedPendingDraftId(expanded ? null : draft.id);
                    }}
                  >
                    {expanded ? "Close" : "Open"}
                  </button>
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
                  <div style={{ display: "grid", gap: 10 }}>
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 4,
                        }}
                      >
                        <b>Translation:</b>
                        <span>{draft.translation_en}</span>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() => void openMeaningCandidatesForItem(draft, "draft")}
                          disabled={refreshingKey === getRefreshKey(draft.id, "translation_en")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "translation_en")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "translation_en")
                            ? "Loading..."
                            : "Change meaning"}
                        </button>
                      </div>

                      {draft.meanings && draft.meanings.length > 0 && (
                        <div className="meta-text">
                          Known meanings: {draft.meanings.join(" · ")}
                        </div>
                      )}
                    </div>

                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 4,
                        }}
                      >
                        <b>Forklaring:</b>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() =>
                            void refreshExplanationField(draft, "draft", "rewrite_shorter")
                          }
                          disabled={refreshingKey === getRefreshKey(draft.id, "short_explanation")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "short_explanation")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "short_explanation")
                            ? "Loading..."
                            : "shorter"}
                        </button>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() =>
                            void refreshExplanationField(draft, "draft", "rewrite_clearer")
                          }
                          disabled={refreshingKey === getRefreshKey(draft.id, "short_explanation")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "short_explanation")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "short_explanation")
                            ? "Loading..."
                            : "clearer"}
                        </button>
                      </div>
                      <div>{draft.short_explanation}</div>
                    </div>

                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 4,
                        }}
                      >
                        <b>Eksempel:</b>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() =>
                            void refreshDanishExampleField(draft, "draft", "new_example")
                          }
                          disabled={refreshingKey === getRefreshKey(draft.id, "example_da")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "example_da")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "example_da")
                            ? "Loading..."
                            : "new"}
                        </button>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() =>
                            void refreshDanishExampleField(
                              draft,
                              "draft",
                              "less_straightforward"
                            )
                          }
                          disabled={refreshingKey === getRefreshKey(draft.id, "example_da")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "example_da")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "example_da")
                            ? "Loading..."
                            : "less straightforward"}
                        </button>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() =>
                            void refreshDanishExampleField(draft, "draft", "more_natural")
                          }
                          disabled={refreshingKey === getRefreshKey(draft.id, "example_da")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "example_da")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "example_da")
                            ? "Loading..."
                            : "more natural"}
                        </button>
                      </div>
                      <div>{draft.example_da}</div>
                    </div>

                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 4,
                        }}
                      >
                        <b>Example:</b>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() => void refreshEnglishExampleField(draft, "draft")}
                          disabled={refreshingKey === getRefreshKey(draft.id, "example_en")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "example_en")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "example_en")
                            ? "Loading..."
                            : "retranslate"}
                        </button>
                      </div>
                      <div>{draft.example_en}</div>
                    </div>

                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 4,
                        }}
                      >
                        <b>Extra info:</b>
                        <button
                          type="button"
                          className="button-secondary button-small"
                          onClick={() => void refreshExtraInfoField(draft, "draft")}
                          disabled={refreshingKey === getRefreshKey(draft.id, "extra_info")}
                          style={refreshButtonStyle(
                            refreshingKey === getRefreshKey(draft.id, "extra_info")
                          )}
                        >
                          {refreshingKey === getRefreshKey(draft.id, "extra_info")
                            ? "Loading..."
                            : "reformat"}
                        </button>
                      </div>
                      <div>{draft.extra_info || "—"}</div>
                    </div>
                  </div>

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
      <div style={{ marginBottom: 10 }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          Library
        </h2>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
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
            All
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => setLibraryFiltersOpen((prev) => !prev)}
            className="button-secondary"
            title="Search and filter"
            aria-label="Search and filter"
            style={{
              minHeight: 42,
              minWidth: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            🔍
          </button>

          <button
            onClick={() => setShowManageTags((prev) => !prev)}
            className="button-secondary"
            style={{
              minHeight: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            Tags
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }} className="meta-text">
        {databaseViewMode === "attention"
          ? "Showing 10 phrases that need attention most"
          : `Showing all ${cards.length} saved phrases`}
      </div>

      {(libraryFiltersOpen || tagFilter || search) && (
        <div className="card" style={{ marginTop: 0, marginBottom: 16 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phrase, translation, explanation, example, or tag..."
              className="text-input"
              style={{ width: "100%", maxWidth: 420 }}
            />

            {allTags.length > 0 && (
              <>
                <div className="meta-text">Filter by tag</div>

                <div className="tag-row">
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
              </>
            )}

            {(search || tagFilter) && (
              <div className="inline-action-row">
                {search && (
                  <span
                    className="badge"
                    style={{ backgroundColor: "#f3f4f6", color: "#374151" }}
                  >
                    Search: {search}
                  </span>
                )}

                {tagFilter && (
                  <button
                    className="tag-pill-selected"
                    onClick={() => setTagFilter(null)}
                    style={tagPillStyle(tagFilter)}
                  >
                    {tagFilter} ✕
                  </button>
                )}

                <button
                  className="button-secondary button-small"
                  onClick={() => {
                    setSearch("");
                    setTagFilter(null);
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            {showManageTags && (
              <div className="mini-box" style={{ marginTop: 0 }}>
                <h3 className="subsection-title">Manage tags</h3>

                <div className="inline-action-row">
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
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 12,
                alignItems: "start",
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => handleSelectionToggle(e.target.checked, card.id)}
                style={{ marginTop: 4 }}
              />

              <div
                onClick={() => setExpandedId(expanded ? null : card.id)}
                style={{ cursor: "pointer", minWidth: 0 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontWeight: 650, fontSize: 16 }}>{card.phrase}</span>

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
                    style={{ background: masteryColor(card), color: masteryTextColor(card) }}
                  >
                    {masteryText(card)}
                  </span>
                </div>

                <div
                  style={{
                    color: "#4b5563",
                    fontSize: 14,
                    marginBottom: 8,
                  }}
                >
                  {card.translation_en}
                </div>

                <div className="tag-row">
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

              <button
                type="button"
                className="button-secondary button-small"
                onClick={() => setExpandedId(expanded ? null : card.id)}
              >
                {expanded ? "Close" : "Open"}
              </button>
            </div>

            {expanded && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 4,
                      }}
                    >
                      <b>Translation:</b>
                      <span>{card.translation_en}</span>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() => void openMeaningCandidatesForItem(card, "phrase")}
                        disabled={refreshingKey === getRefreshKey(card.id, "translation_en")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "translation_en")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "translation_en")
                          ? "Loading..."
                          : "Change meaning"}
                      </button>
                    </div>

                    {card.meanings && card.meanings.length > 0 && (
                      <div className="meta-text">
                        Known meanings: {card.meanings.join(" · ")}
                      </div>
                    )}
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 4,
                      }}
                    >
                      <b>Forklaring:</b>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() =>
                          void refreshExplanationField(card, "phrase", "rewrite_shorter")
                        }
                        disabled={refreshingKey === getRefreshKey(card.id, "short_explanation")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "short_explanation")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "short_explanation")
                          ? "Loading..."
                          : "shorter"}
                      </button>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() =>
                          void refreshExplanationField(card, "phrase", "rewrite_clearer")
                        }
                        disabled={refreshingKey === getRefreshKey(card.id, "short_explanation")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "short_explanation")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "short_explanation")
                          ? "Loading..."
                          : "clearer"}
                      </button>
                    </div>
                    <div>{card.short_explanation}</div>
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 4,
                      }}
                    >
                      <b>Eksempel:</b>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() =>
                          void refreshDanishExampleField(card, "phrase", "new_example")
                        }
                        disabled={refreshingKey === getRefreshKey(card.id, "example_da")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "example_da")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "example_da")
                          ? "Loading..."
                          : "new"}
                      </button>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() =>
                          void refreshDanishExampleField(
                            card,
                            "phrase",
                            "less_straightforward"
                          )
                        }
                        disabled={refreshingKey === getRefreshKey(card.id, "example_da")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "example_da")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "example_da")
                          ? "Loading..."
                          : "less straightforward"}
                      </button>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() =>
                          void refreshDanishExampleField(card, "phrase", "more_natural")
                        }
                        disabled={refreshingKey === getRefreshKey(card.id, "example_da")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "example_da")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "example_da")
                          ? "Loading..."
                          : "more natural"}
                      </button>
                    </div>
                    <div>{card.example_da}</div>
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 4,
                      }}
                    >
                      <b>Example:</b>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() => void refreshEnglishExampleField(card, "phrase")}
                        disabled={refreshingKey === getRefreshKey(card.id, "example_en")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "example_en")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "example_en")
                          ? "Loading..."
                          : "retranslate"}
                      </button>
                    </div>
                    <div>{card.example_en}</div>
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 4,
                      }}
                    >
                      <b>Extra info:</b>
                      <button
                        type="button"
                        className="button-secondary button-small"
                        onClick={() => void refreshExtraInfoField(card, "phrase")}
                        disabled={refreshingKey === getRefreshKey(card.id, "extra_info")}
                        style={refreshButtonStyle(
                          refreshingKey === getRefreshKey(card.id, "extra_info")
                        )}
                      >
                        {refreshingKey === getRefreshKey(card.id, "extra_info")
                          ? "Loading..."
                          : "reformat"}
                      </button>
                    </div>
                    <div>{card.extra_info || "—"}</div>
                  </div>
                </div>

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
                    Reanalyze
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
                    <p><b>Stage:</b> {masteryLabel(card)}</p>
                    <p><b>Points:</b> {masteryPoints(card).toFixed(1)}</p>
                    <p><b>Spontaneous correct:</b> {spontaneousCorrectOf(card)}</p>
                    <p><b>Spontaneous almost:</b> {spontaneousAlmostOf(card)}</p>
                    <p><b>Spontaneous wrong:</b> {spontaneousWrongOf(card)}</p>
                    <p><b>Retry correct:</b> {retryCorrectOf(card)}</p>
                    <p><b>Requested again:</b> {reRequestedOf(card)}</p>
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

    {meaningPickerOpen && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.45)",
          zIndex: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        onClick={() => {
          if (!meaningPickerLoading) {
            closeMeaningPicker();
          }
        }}
      >
        <div
          className="card"
          style={{
            width: "100%",
            maxWidth: 760,
            maxHeight: "85vh",
            overflowY: "auto",
            margin: 0,
            padding: 20,
            boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <h2 className="section-title" style={{ marginBottom: 6 }}>
                Which meaning did you mean?
              </h2>
              <div className="meta-text">
                The phrase seems to have more than one possible meaning. Choose the one you want for this card.
              </div>
            </div>

            <button
              onClick={closeMeaningPicker}
              className="button-secondary"
              disabled={meaningPickerLoading}
            >
              Close
            </button>
          </div>

          {pendingMeaningChoice && (
            <div
              className="mini-box"
              style={{ marginBottom: 14, background: "#f8fafc" }}
            >
              <div><b>Phrase:</b> {pendingMeaningChoice.rawPhrase}</div>
            </div>
          )}

          {meaningPickerError && (
            <div
              className="mini-box"
              style={{
                marginBottom: 14,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
              }}
            >
              {meaningPickerError}
            </div>
          )}

          {meaningPickerLoading && meaningOptions.length === 0 ? (
            <div className="mini-box" style={{ margin: 0 }}>
              Preparing meaning options...
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {meaningOptions.map((option, index) => (
                <div
                  key={`${option.translation_en}-${index}`}
                  className="mini-box"
                  style={{
                    margin: 0,
                    padding: 14,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {option.translation_en}
                    </div>
                    <div className="meta-text" style={{ marginTop: 4 }}>
                      {option.short_explanation_da}
                    </div>
                  </div>

                  {option.example_da && (
                    <div style={{ marginBottom: 10, fontSize: 14, color: "#374151" }}>
                      <b>Example:</b> {option.example_da}
                    </div>
                  )}

                  <button
                    onClick={() => void confirmMeaningChoice(option)}
                    className="button-primary"
                    disabled={meaningPickerLoading}
                  >
                    {meaningPickerLoading ? "Generating..." : "Choose this meaning"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}

    {refreshMeaningPicker.open && refreshMeaningPicker.itemId && refreshMeaningPicker.entityType && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.45)",
          zIndex: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        onClick={closeRefreshMeaningPicker}
      >
        <div
          className="card"
          style={{
            width: "100%",
            maxWidth: 760,
            maxHeight: "85vh",
            overflowY: "auto",
            margin: 0,
            padding: 20,
            boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <h2 className="section-title" style={{ marginBottom: 6 }}>
                Choose meaning for this card
              </h2>
              <div className="meta-text">
                Pick one of the existing or newly generated meaning options.
              </div>
            </div>

            <button
              onClick={closeRefreshMeaningPicker}
              className="button-secondary"
            >
              Close
            </button>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {refreshMeaningPicker.candidates.map((candidate, index) => (
              <div
                key={`${candidate}-${index}`}
                className="mini-box"
                style={{
                  margin: 0,
                  padding: 14,
                  border: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontWeight: 600 }}>{candidate}</div>

                <button
                  type="button"
                  className="button-primary"
                  onClick={() =>
                    void chooseMeaningForItem(
                      refreshMeaningPicker.itemId!,
                      refreshMeaningPicker.entityType!,
                      candidate
                    )
                  }
                >
                  Choose this meaning
                </button>
              </div>
            ))}

            {refreshMeaningPicker.candidates.length === 0 && (
              <div className="mini-box" style={{ margin: 0 }}>
                No meaning candidates available.
              </div>
            )}
          </div>
        </div>
      </div>
    )}
  </main>
);
}
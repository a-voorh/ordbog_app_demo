"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { TABLES } from "../lib/tables";

type PhraseCard = {
  id: string;
  phrase: string;
  created_at: string;
  times_correct?: number | null;
  times_almost?: number | null;
  times_wrong?: number | null;
  times_spontaneous_correct?: number | null;
  times_spontaneous_almost?: number | null;
  times_spontaneous_wrong?: number | null;
  times_retry_correct?: number | null;
  learning_attempted?: number | null;
  learning_correct?: number | null;
  learning_almost?: number | null;
  learning_wrong?: number | null;
  last_learning_at?: string | null;
  last_practiced_at?: string | null;
  last_spontaneous_used_at?: string | null;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const masteryPoints = (card: PhraseCard) => {
  const promptedCorrect = (card.times_correct || 0) * 2;
  const promptedAlmost = (card.times_almost || 0) * 1.2;
  const promptedWrong = (card.times_wrong || 0) * -0.8;

  const spontaneousCorrect = (card.times_spontaneous_correct || 0) * 3;
  const spontaneousAlmost = (card.times_spontaneous_almost || 0) * 1.7;
  const spontaneousWrong = (card.times_spontaneous_wrong || 0) * -0.2;

  const retryCorrect = (card.times_retry_correct || 0) * 0.9;

  const learningCorrect = (card.learning_correct || 0) * 1.2;
  const learningAlmost = (card.learning_almost || 0) * 0.6;
  const learningWrong = (card.learning_wrong || 0) * -0.4;

  return Math.max(
    0,
    promptedCorrect +
      promptedAlmost +
      promptedWrong +
      spontaneousCorrect +
      spontaneousAlmost +
      spontaneousWrong +
      retryCorrect +
      learningCorrect +
      learningAlmost +
      learningWrong
  );
};

const masteryLabel = (card: PhraseCard) => {
  const points = masteryPoints(card);

  if (points < 2) return "new";
  if (points < 5) return "familiar";
  if (points < 9) return "active";

  return "automatic";
};

const wasUsedToday = (card: PhraseCard) => {
  const today = todayKey();

  return (
    card.last_learning_at?.startsWith(today) ||
    card.last_practiced_at?.startsWith(today) ||
    card.last_spontaneous_used_at?.startsWith(today)
  );
};

const tileStyle = {
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  minHeight: 92,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "white",
  textDecoration: "none",
  color: "inherit",
};

export default function HomePage() {
  const [cards, setCards] = useState<PhraseCard[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      const { data, error } = await supabase
        .from(TABLES.phrases)
        .select(`
          id,
          phrase,
          created_at,
          times_correct,
          times_almost,
          times_wrong,
          times_spontaneous_correct,
          times_spontaneous_almost,
          times_spontaneous_wrong,
          times_retry_correct,
          learning_attempted,
          learning_correct,
          learning_almost,
          learning_wrong,
          last_learning_at,
          last_practiced_at,
          last_spontaneous_used_at
        `)
        .limit(1000);

      if (error) {
        console.error("Failed to load dashboard stats:", error);
        setLoadingStats(false);
        return;
      }

      setCards((data || []) as PhraseCard[]);
      setLoadingStats(false);
    };

    loadStats();
  }, []);

  const stats = useMemo(() => {
    const today = todayKey();

    const totalCards = cards.length;

    const addedToday = cards.filter((card) =>
      card.created_at?.startsWith(today)
    ).length;

    const practicedToday = cards.filter(wasUsedToday).length;

    const activeWords = cards.filter(
      (card) => masteryLabel(card) === "active"
    ).length;

    const automaticWords = cards.filter(
      (card) => masteryLabel(card) === "automatic"
    ).length;

    const needsAttention = cards.filter(
      (card) => masteryLabel(card) === "new"
    ).length;

    return {
      totalCards,
      addedToday,
      practicedToday,
      activeWords,
      automaticWords,
      needsAttention,
    };
  }, [cards]);

  return (
    <main className="app-page">
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        <div
          className="card card-strong"
          style={{
            marginBottom: 16,
            textAlign: "center",
            padding: "28px 18px",
          }}
        >
          <h1
            className="app-title"
            style={{
              marginBottom: 10,
            }}
          >
            📚 Mit ordforråd: ord for ord
          </h1>

          <p
            className="app-subtitle"
            style={{
              lineHeight: 1.5,
              fontSize: 14,
            }}
          >
            A small system for turning passive vocabulary into active language.
          </p>
        </div>

        <div
          className="card"
          style={{
            marginBottom: 14,
          }}
        >
          <h2
            className="section-title"
            style={{
              marginBottom: 10,
              fontSize: 16,
            }}
          >
            Today
          </h2>

          {loadingStats ? (
            <p className="meta-text">Loading stats...</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <div>
                <strong>{stats.practicedToday}</strong>
                <div className="meta-text">practiced</div>
              </div>

              <div>
                <strong>{stats.addedToday}</strong>
                <div className="meta-text">added</div>
              </div>
            </div>
          )}
        </div>

        <div
          className="card"
          style={{
            marginBottom: 16,
          }}
        >
          <h2
            className="section-title"
            style={{
              marginBottom: 10,
              fontSize: 16,
            }}
          >
            Vocabulary
          </h2>

          {loadingStats ? (
            <p className="meta-text">Loading stats...</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <div>
                <strong>{stats.totalCards}</strong>
                <div className="meta-text">cards</div>
              </div>

              <div>
                <strong>{stats.activeWords}</strong>
                <div className="meta-text">active</div>
              </div>

              <div>
                <strong>{stats.automaticWords}</strong>
                <div className="meta-text">automatic</div>
              </div>

              <div>
                <strong>{stats.needsAttention}</strong>
                <div className="meta-text">need attention</div>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10,
          }}
        >
          <Link href="/collector" className="card" style={tileStyle}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>📝</div>

            <div>
              <h2
                className="section-title"
                style={{
                  marginBottom: 6,
                  fontSize: 15,
                }}
              >
                Phrase Collector
              </h2>

              <p
                className="meta-text"
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                Add and organize vocabulary cards.
              </p>
            </div>
          </Link>

          <Link href="/learning" className="card" style={tileStyle}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>🧠</div>

            <div>
              <h2
                className="section-title"
                style={{
                  marginBottom: 6,
                  fontSize: 15,
                }}
              >
                Learning Mode
              </h2>

              <p
                className="meta-text"
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                Exercises, repetition, and quests.
              </p>
            </div>
          </Link>

          <Link href="/practice" className="card" style={tileStyle}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>💬</div>

            <div>
              <h2
                className="section-title"
                style={{
                  marginBottom: 6,
                  fontSize: 15,
                }}
              >
                Practice Mode
              </h2>

              <p
                className="meta-text"
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                Use phrases actively in conversation.
              </p>
            </div>
          </Link>

          <Link href="/maintenance" className="card" style={tileStyle}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>🛠</div>

            <div>
              <h2
                className="section-title"
                style={{
                  marginBottom: 6,
                  fontSize: 15,
                }}
              >
                Maintenance
              </h2>

              <p
                className="meta-text"
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                Cleanup, diagnostics, and tools.
              </p>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
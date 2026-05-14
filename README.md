# Mit ordforråd: ord for ord

🔗 **Live demo:** https://ordbog-app-demo.vercel.app/  
💻 **Source code:** https://github.com/a-voorh/ordbog_app_demo

---

## Overview

**Mit ordforråd: ord for ord** is a lightweight AI-assisted language-learning app focused on helping learners actively use Danish phrases in realistic contexts instead of only memorizing isolated vocabulary.

The project started as a personal tool while preparing for the Danish PD3 exam and gradually evolved into a broader experiment in contextual vocabulary acquisition, active recall, and AI-assisted language practice.

The app combines phrase collection, contextual examples, conversational practice, learning exercises, and lightweight progress tracking into a single workflow.

---

## Core idea

```text
Traditional vocabulary learning:
    recognize word → forget word

This app focuses on:
    understand phrase
        ↓
    see it in context
        ↓
    actively produce it
        ↓
    repeat it naturally
        ↓
    move it into active vocabulary
```

---

## Main workflow

```text
User enters a Danish phrase
        ↓
AI analyses the phrase
        ↓
The app generates:
  - English translation
  - short explanation
  - contextual examples
  - additional usage notes
        ↓
User edits and saves the phrase card
        ↓
The phrase becomes available in:
  - Practice Mode
  - Learning Mode
```

---

# Features

## Phrase collection

- Add Danish words, phrases, and expressions
- Generate AI-assisted draft cards
- Edit cards before saving
- Organize phrases with custom tags
- Search and filter saved phrases
- Store multiple usage variants for flexible matching
- Track phrase history and practice statistics

---

## Practice Mode

A conversational practice system focused on active phrase production.

```text
App creates conversational context
        ↓
User responds in Danish
        ↓
System checks:
  - whether target phrase was used
  - whether usage sounds natural
  - whether grammar is acceptable
        ↓
Feedback is recorded:
  - correct
  - almost correct
  - incorrect
  - unused
```

Features include:

- Chat-like interface
- AI-generated conversational prompts
- Flexible phrase matching
- Context-aware evaluation
- Suggested corrections and rewrites
- Tracking of spontaneous phrase usage

---

## Learning Mode

Structured exercises for repetition and recall.

### Translation exercises

```text
English prompt
      ↓
User writes Danish answer
      ↓
System evaluates similarity and correctness
```

### Preposition quests

```text
Prepositions removed from sentence
        ↓
User restores correct prepositions
        ↓
Session score is recorded
```

The app attempts to reduce immediate repetition and surface phrases that require additional attention.

---

## Attention system

The app keeps lightweight learning statistics and attempts to identify phrases that may need reinforcement.

Factors include:

- correctness history
- recent mistakes
- spontaneous usage
- repetition frequency
- recency of practice

---

## Why I built this

While learning Danish, I realized that my main difficulty was not understanding vocabulary, but actually using it naturally in conversation and writing.

Many language-learning tools are excellent for recognition-based learning, but far fewer focus on helping users repeatedly produce phrases in realistic contexts.

This project started as an attempt to solve that problem for myself.

---

## Tech stack

- Next.js
- React
- TypeScript
- Supabase
- OpenAI API
- Vercel

---

## Project status

Prototype / ongoing personal project.

The system is actively evolving and many ideas are still experimental.

The public demo may occasionally contain simplified functionality or temporary limitations.

---

## Author

**Arina Voorhaar**  
Postdoctoral researcher in mathematics

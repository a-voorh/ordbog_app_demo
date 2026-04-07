# Danish Phrase Trainer (Demo)

🔗 Live demo: https://ordbog-app-demo.vercel.app/  
💻 Source code: https://github.com/a-voorh/ordbog_app_demo

---

## Overview

A lightweight web app for practicing Danish phrases in context rather than memorizing isolated vocabulary.

The app focuses on helping users actively use phrases through structured input, tagging, and conversational practice, with simple progress tracking to identify what needs attention.

---

## Features

- Add and organize phrases with tags  
- Generate draft cards with explanations and examples  
- Practice phrases in a chat-like interface  
- Provide feedback on phrase usage (correct / almost correct / incorrect)  
- Suggest improved phrasing and corrections  
- Track progress and highlight phrases that need attention  
- Search and filter through saved phrases  

---

## How to use

1. Add a phrase  
   Type a Danish phrase you want to learn and click Analyze or Create draft.

2. Review the draft card  
   The app generates:
   - translation  
   - explanation  
   - example sentences  

   You can edit or save it.

3. Organize with tags  
   Add tags to group phrases by topic or context.

4. Practice in context  
   Use Practice Mode to simulate conversation and recall phrases naturally.

5. Get feedback and improve  
   Each message you send in a practice session is evaluated. The app detects usage of relevant phrases and classifies it as:
   - correct  
   - almost correct  
   - incorrect  

   You also receive suggested corrections and improved phrasing.

6. Refine and retry  
   You can:
   - retry your answer after feedback  
   - regenerate responses  
   - request an alternative explanation or “second opinion”  

   This supports iterative learning rather than one-shot answers.

7. Track progress  
   The app highlights phrases that need attention, helping you focus on weaker areas.

8. Search and filter  
   Use search and tags in the Library to quickly find phrases.

---

## Run locally

Clone the repository and install dependencies:

    npm install
    npm run dev

Create a file called .env.local and add:

    NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
    OPENAI_API_KEY=your_openai_key

Then open:

    http://localhost:3000

---

## Supabase setup

This project uses Supabase for storing phrases and drafts.

To run locally, create two tables in your Supabase project:

phrases_demo
- id (uuid, primary key)
- phrase (text)
- translation_en (text)
- short_explanation (text)
- example_da (text)
- example_en (text)
- extra_info (text)
- tags (text[])
- created_at (timestamp)

pending_drafts_demo
- id (uuid, primary key)
- phrase (text)
- translation_en (text)
- short_explanation (text)
- example_da (text)
- example_en (text)
- extra_info (text)
- tags (text[])
- created_at (timestamp)

You can create these tables manually in the Supabase dashboard.

This demo uses separate tables (*_demo) to isolate test data.

---

## Tech stack

- Next.js (React)
- Supabase (database)
- OpenAI API (language processing)
- Vercel (deployment)

---

## Motivation

Originally built to support my own Danish learning (PD3 level), the project focuses on practicing phrases in realistic conversational contexts rather than memorizing isolated vocabulary.

During development, it evolved into a small product exploring how structure, repetition, and usability can support language learning.

---

## Status

This is a simplified demo version with a limited dataset, created to showcase functionality and product thinking.

---

## What I would improve next

- Smarter spaced repetition based on usage patterns  
- Better prioritization of phrases for practice  
- Improved chat experience (more natural conversational flow)  
- Optional user accounts and persistent progress tracking  

---

## Notes

The goal of this project is not just technical implementation, but exploring how small, focused tools can improve real-world learning workflows.

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { TABLES } from "../../../lib/tables";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type EntityType = "phrase" | "draft";
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

type RowData = {
  id: string;
  phrase: string;
  translation_en: string | null;
  short_explanation: string | null;
  extra_info: string | null;
  example_da: string | null;
  example_en: string | null;
};

type RequestBody = {
  entityType: EntityType;
  id: string;
  field: RefreshField;
  action: RefreshAction;
  existingMeanings?: string[];
  selectedMeaning?: string;
};

function getTableName(entityType: EntityType) {
  return entityType === "phrase" ? TABLES.phrases : TABLES.drafts;
}

async function getRow(entityType: EntityType, id: string): Promise<RowData> {
  const table = getTableName(entityType);

  const { data, error } = await supabase
    .from(table)
    .select(
      "id, phrase, translation_en, short_explanation, extra_info, example_da, example_en"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(
      `Could not load row from ${table}: ${error?.message ?? "Unknown error"}`
    );
  }

  return data as RowData;
}

async function updateRow(
  entityType: EntityType,
  id: string,
  updates: Partial<RowData>
) {
  const table = getTableName(entityType);

  const { data, error } = await supabase
    .from(table)
    .update(updates)
    .eq("id", id)
    .select(
      "id, phrase, translation_en, short_explanation, extra_info, example_da, example_en"
    )
    .single();

  if (error || !data) {
    throw new Error(
      `Could not update row in ${table}: ${error?.message ?? "Unknown error"}`
    );
  }

  return data as RowData;
}

async function askModel(prompt: string): Promise<string> {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  const text = response.output_text?.trim();

  if (!text) {
    throw new Error("Model returned empty output.");
  }

  return text;
}

async function askModelForJson<T>(prompt: string): Promise<T> {
  const raw = await askModel(prompt);

  try {
    return JSON.parse(raw) as T;
  } catch {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    return JSON.parse(cleaned) as T;
  }
}

async function generateMeaningCandidates(params: {
  phrase: string;
  currentTranslation: string;
  existingMeanings: string[];
}) {
  const { phrase, currentTranslation, existingMeanings } = params;

  const prompt = `
You are improving a Danish phrase card.

Phrase:
${phrase}

Current English translation:
${currentTranslation || "(empty)"}

Existing meaning options already known:
${existingMeanings.length ? existingMeanings.map((m) => `- ${m}`).join("\n") : "(none)"}

Task:
Generate 3 concise, natural English meaning options for this Danish phrase.
They should be plausible meaning labels or short translations, not long explanations.
Avoid duplicates of each other.
Avoid repeating any existing meanings verbatim if possible.
Keep each option short.

Return valid JSON only in this exact shape:
{"candidates":["option 1","option 2","option 3"]}
`.trim();

  const result = await askModelForJson<{ candidates: string[] }>(prompt);

  return (result.candidates || [])
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i);
}

async function rewriteExplanation(params: {
  phrase: string;
  translationEn: string;
  currentExplanation: string;
  mode: "rewrite_shorter" | "rewrite_clearer";
}) {
  const { phrase, translationEn, currentExplanation, mode } = params;

  const styleInstruction =
    mode === "rewrite_shorter"
      ? "Omskriv forklaringen, så den bliver kortere, strammere og mere direkte."
      : "Omskriv forklaringen, så den bliver klarere, mere naturlig og lettere at forstå.";

  const prompt = `
Du forbedrer et kort med en dansk frase.

Frase:
${phrase}

Valgt engelsk betydning:
${translationEn}

Nuværende forklaring:
${currentExplanation || "(tom)"}

Opgave:
${styleInstruction}
Forklaringen skal være på dansk.
Den skal passe til den valgte engelske betydning.
Hold den kort og naturlig.
Giv ikke en eksempel-sætning.
Højst 1-2 korte sætninger.

Returnér kun den nye forklaringstekst.
`.trim();

  return askModel(prompt);
}

async function rewriteExtraInfo(params: {
  phrase: string;
  translationEn: string;
  explanation: string;
  currentExtraInfo: string;
}) {
  const { phrase, translationEn, explanation, currentExtraInfo } = params;

  const prompt = `
Du forbedrer feltet "extra info" for et kort med en dansk frase.

Frase:
${phrase}

Valgt engelsk betydning:
${translationEn}

Kort forklaring:
${explanation || "(tom)"}

Nuværende extra info:
${currentExtraInfo || "(tom)"}

Opgave:
Skriv "extra info" på dansk i et fast, kort format.

Vælg det format, der passer bedst:

1. Hvis frasen er et verbum:
Brug formatet:
"verbum · nutid: ... · datid: ... · perfektum: ..."

Eksempel:
"verbum · nutid: advarer · datid: advarede · perfektum: har advaret"

2. Hvis frasen er et substantiv:
Brug formatet:
"substantiv · en/et: ... · pluralis: ..."

Eksempel:
"substantiv · et ord · pluralis: ord"

Hvis pluralis normalt ikke bruges, må du skrive:
"substantiv · en/et: ... · pluralis: bruges sjældent"

3. Hvis frasen er et adjektiv:
Brug ét af disse formater:
"adjektiv · intetkøn: ... · flertal: ..."
eller
"adjektiv · fælleskøn/flertal: ..."

Eksempler:
"adjektiv · intetkøn: vigtigt · flertal: vigtige"
"adjektiv · fælleskøn/flertal: vigtige"

4. Hvis frasen er et fast udtryk:
Brug formatet:
"fast udtryk · ..."
Efter prikken må du skrive en meget kort nyttig bemærkning eller lille nuance.

Eksempel:
"fast udtryk · bruges som samlet vending, ikke ord for ord"

5. Hvis frasen er et adverbium:
Brug formatet:
"adverbium · ..."
Efter prikken må du skrive en meget kort nyttig bemærkning eller lille nuance.

Eksempel:
"adverbium · bruges til at nuancere tonen i sætningen"

Regler:
- Skriv kun én kort linje.
- Skriv på dansk.
- Hold det kompakt og ensartet.
- Gentag ikke hele forklaringen.
- Giv ikke et helt eksempel.
- Hvis ordklassen er lidt uklar, vælg den mest nyttige løsning for en sprogstuderende.
- Bevar punkt-separatoren " · " mellem delene.

Returnér kun den nye tekst til extra info.
`.trim();

  return askModel(prompt);
}

async function generateExampleDa(params: {
  phrase: string;
  translationEn: string;
  explanation: string;
  extraInfo: string;
  currentExampleDa: string;
  mode: "new_example" | "less_straightforward" | "more_natural";
}) {
  const { phrase, translationEn, explanation, extraInfo, currentExampleDa, mode } = params;

  const modeInstruction =
    mode === "less_straightforward"
      ? "Generate a new Danish example that is a bit less obvious and less textbook-like, but still natural and clear."
      : mode === "more_natural"
        ? "Generate a new Danish example that sounds especially natural and everyday."
        : "Generate a new Danish example.";

  const prompt = `
You are improving a Danish phrase card.

Phrase:
${phrase}

Chosen English meaning:
${translationEn}

Danish explanation:
${explanation || "(empty)"}

Extra info:
${extraInfo || "(empty)"}

Current Danish example:
${currentExampleDa || "(empty)"}

Task:
${modeInstruction}
The example must use the phrase naturally.
It must match the chosen English meaning.
Make it realistic and idiomatic.
Avoid copying the current example too closely.
Write exactly one sentence in Danish.

Return only the Danish example sentence.
`.trim();

  return askModel(prompt);
}

async function translateExampleEn(params: {
  phrase: string;
  translationEn: string;
  exampleDa: string;
}) {
  const { phrase, translationEn, exampleDa } = params;

  const prompt = `
You are translating the Danish example sentence of a Danish phrase card.

Phrase:
${phrase}

Chosen English meaning:
${translationEn}

Danish example:
${exampleDa}

Task:
Translate the Danish example into natural English.
Preserve the actual meaning of the Danish sentence.
Do not explain.
Return only the English translation sentence.
`.trim();

  return askModel(prompt);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const {
      entityType,
      id,
      field,
      action,
      existingMeanings = [],
      selectedMeaning,
    } = body;

    if (!entityType || !id || !field || !action) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 }
      );
    }

    const row = await getRow(entityType, id);

    if (field === "translation_en" && action === "generate_meaning_candidates") {
      const candidates = await generateMeaningCandidates({
        phrase: row.phrase,
        currentTranslation: row.translation_en ?? "",
        existingMeanings,
      });

      const combined = [
        ...existingMeanings.map((x) => x.trim()).filter(Boolean),
        ...candidates,
      ].filter((x, i, arr) => arr.indexOf(x) === i);

      return NextResponse.json({
        ok: true,
        mode: "meaning_candidates",
        candidates: combined,
      });
    }

    if (field === "translation_en" && action === "set_meaning") {
      if (!selectedMeaning?.trim()) {
        return NextResponse.json(
          { error: "selectedMeaning is required for set_meaning." },
          { status: 400 }
        );
      }

      const updated = await updateRow(entityType, id, {
        translation_en: selectedMeaning.trim(),
      });

      return NextResponse.json({
        ok: true,
        updated,
        updatedFields: {
          translation_en: updated.translation_en,
        },
      });
    }

    if (field === "short_explanation") {
      const mode =
        action === "rewrite_clearer" ? "rewrite_clearer" : "rewrite_shorter";

      const newExplanation = await rewriteExplanation({
        phrase: row.phrase,
        translationEn: row.translation_en ?? "",
        currentExplanation: row.short_explanation ?? "",
        mode,
      });

      const updated = await updateRow(entityType, id, {
        short_explanation: newExplanation,
      });

      return NextResponse.json({
        ok: true,
        updated,
        updatedFields: {
          short_explanation: updated.short_explanation,
        },
      });
    }

    if (field === "extra_info") {
      const newExtraInfo = await rewriteExtraInfo({
        phrase: row.phrase,
        translationEn: row.translation_en ?? "",
        explanation: row.short_explanation ?? "",
        currentExtraInfo: row.extra_info ?? "",
      });

      const updated = await updateRow(entityType, id, {
        extra_info: newExtraInfo,
      });

      return NextResponse.json({
        ok: true,
        updated,
        updatedFields: {
          extra_info: updated.extra_info,
        },
      });
    }

    if (field === "example_da") {
      const mode =
        action === "less_straightforward"
          ? "less_straightforward"
          : action === "more_natural"
            ? "more_natural"
            : "new_example";

      const newExampleDa = await generateExampleDa({
        phrase: row.phrase,
        translationEn: row.translation_en ?? "",
        explanation: row.short_explanation ?? "",
        extraInfo: row.extra_info ?? "",
        currentExampleDa: row.example_da ?? "",
        mode,
      });

      const newExampleEn = await translateExampleEn({
        phrase: row.phrase,
        translationEn: row.translation_en ?? "",
        exampleDa: newExampleDa,
      });

      const updated = await updateRow(entityType, id, {
        example_da: newExampleDa,
        example_en: newExampleEn,
      });

      return NextResponse.json({
        ok: true,
        updated,
        updatedFields: {
          example_da: updated.example_da,
          example_en: updated.example_en,
        },
      });
    }

    if (field === "example_en" && action === "retranslate_from_danish") {
      const newExampleEn = await translateExampleEn({
        phrase: row.phrase,
        translationEn: row.translation_en ?? "",
        exampleDa: row.example_da ?? "",
      });

      const updated = await updateRow(entityType, id, {
        example_en: newExampleEn,
      });

      return NextResponse.json({
        ok: true,
        updated,
        updatedFields: {
          example_en: updated.example_en,
        },
      });
    }

    return NextResponse.json(
      { error: "Unsupported field/action combination." },
      { status: 400 }
    );
  } catch (error) {
    console.error("refresh-card-field route error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}

import OpenAI from "openai";

const MODEL = "gpt-4.1-mini";

export async function POST(req: Request) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();

    const phrase = typeof body.phrase === "string" ? body.phrase.trim() : "";

    const translationEn =
      typeof body.translation_en === "string"
        ? body.translation_en.trim()
        : "";

    const intendedMeaning =
      typeof body.intendedMeaning === "string"
        ? body.intendedMeaning.trim()
        : "";

    const contextSentence =
      typeof body.contextSentence === "string"
        ? body.contextSentence.trim()
        : "";

    if (!phrase) {
      return Response.json({ error: "Missing phrase" }, { status: 400 });
    }

    const hasCustomMeaning = intendedMeaning || contextSentence;

    const meaningInstruction = hasCustomMeaning
      ? `Important custom meaning/context constraint:
The learner says the automatically suggested meanings did NOT match what they meant.

Learner's intended meaning:
"${intendedMeaning || "(not provided)"}"

Context sentence where the learner saw the phrase:
"${contextSentence || "(not provided)"}"

You must decide whether the intended meaning actually belongs to the Danish phrase.

Set:
- meaning_match_status = "matched" if the intended/context meaning fits this Danish phrase.
- meaning_match_status = "mismatch" if the intended meaning probably belongs to a different Danish word or phrase.

If meaning_match_status = "matched":
- Generate the card for the intended/context meaning.
- suggested_alternative_da must be "".

If meaning_match_status = "mismatch":
- Do NOT silently replace the Danish phrase with another Danish word.
- Keep corrected_phrase close to the learner's original Danish phrase.
- Generate the card for a real meaning of the original Danish phrase.
- Put the better Danish suggestion in suggested_alternative_da if there is one.
- In extra_info, briefly mention the suggestion, for example:
  "Mente du måske: skud?"
- Keep the tone gentle and non-scolding.

Examples:
- phrase: "række", intended meaning: "shot"
  meaning_match_status: "mismatch"
  corrected_phrase: "række"
  suggested_alternative_da: "skud"
  Do NOT change corrected_phrase to "skud".

- phrase: "krop", intended meaning: "body of a book/text"
  If this is possible in context:
  meaning_match_status: "matched"
  corrected_phrase: "krop"

Priority:
1. The context sentence is the strongest evidence.
2. The learner's intended meaning is the second strongest evidence.
3. Do NOT fall back to the most common meaning if the context clearly supports another real meaning.
4. If the intended meaning does not fit the Danish phrase, return mismatch instead of forcing it.`
      : translationEn
        ? `Important meaning constraint:
The intended English meaning of this phrase is: "${translationEn}".

You MUST generate the card for this meaning only.
Do NOT switch to another meaning of the same Danish word or phrase.
All fields must match this intended meaning.

For this case:
- meaning_match_status must be "matched"
- suggested_alternative_da must be ""`
        : `If the phrase has multiple meanings, choose the most common useful learner meaning.
Prefer the meaning that would be most useful in everyday Danish.

For this case:
- meaning_match_status must be "matched"
- suggested_alternative_da must be ""`;

    const userContent = hasCustomMeaning
      ? `Analyze this Danish phrase: "${phrase}"

The learner did NOT mean the automatically suggested meaning.

Learner's intended meaning:
"${intendedMeaning || "(not provided)"}"

Context sentence:
"${contextSentence || "(not provided)"}"

Return JSON with exactly this structure:
{
  "corrected_phrase": "...",
  "translation_en": "...",
  "short_explanation_da": "...",
  "example_da": "...",
  "example_en": "...",
  "extra_info": "...",
  "meaning_match_status": "matched",
  "suggested_alternative_da": ""
}`
      : translationEn
        ? `Analyze this Danish phrase: "${phrase}"

The intended English meaning is:
"${translationEn}"

Return JSON with exactly this structure:
{
  "corrected_phrase": "...",
  "translation_en": "...",
  "short_explanation_da": "...",
  "example_da": "...",
  "example_en": "...",
  "extra_info": "...",
  "meaning_match_status": "matched",
  "suggested_alternative_da": ""
}`
        : `Analyze this Danish phrase: "${phrase}"

Return JSON with exactly this structure:
{
  "corrected_phrase": "...",
  "translation_en": "...",
  "short_explanation_da": "...",
  "example_da": "...",
  "example_en": "...",
  "extra_info": "...",
  "meaning_match_status": "matched",
  "suggested_alternative_da": ""
}`;

    const response = await client.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content: `You help a Danish learner save useful Danish words and phrases.

Your job:
1. Correct only clear Danish spelling mistakes and missing Danish letters (æ, ø, å).
2. Return the corrected natural Danish phrase.
3. Give the translation in English.
4. Give a short explanation in Danish.
5. Give one natural Danish example sentence.
6. Give the English translation of that example.
7. Give short useful grammar info in Danish.
8. Decide whether the learner's intended meaning fits the Danish phrase.

Important principles:
- If the input already looks good, keep it unchanged.
- Do not rewrite the phrase into a different phrase just because it sounds slightly more common.
- Do not replace the phrase with a synonym.
- Do not make the phrase longer unless this is necessary for natural Danish.
- Keep explanations short, practical, and learner-friendly.
- The explanation must be in Danish.
- The explanation should not simply repeat the word itself.
- The translation must be in English.
- The Danish example should be natural, short, and useful for a learner.
- The Danish example should show the target phrase clearly.
- Do not use overly literary, formal, or rare examples unless the phrase itself requires it.
- Do not comment on spelling unless the correction changes the meaning of the phrase.
- Return ONLY valid JSON.

${meaningInstruction}

Rules for corrected_phrase:
- Preserve the learner's phrase as much as possible.
- Correct obvious typos.
- Restore missing æ, ø, å where clearly needed.
- Keep leading "at" for infinitive verb phrases if the learner included it.
- Do not add leading "at" unless the phrase is clearly meant as an infinitive verb phrase.
- For fixed expressions, keep the fixed expression.
- If the context clearly shows that the learner typed a slightly wrong form of the SAME Danish phrase, correct it to the natural Danish form.
- Do NOT replace corrected_phrase with a different Danish word just because that different word matches the learner's intended English meaning.
- If the learner's intended meaning requires a different Danish word, keep corrected_phrase close to the original phrase and put the better word in suggested_alternative_da.

Rules for short_explanation_da:
- Write in simple Danish.
- Prefer one short sentence or sentence fragment.
- Do not start the explanation with "Det betyder...".
- NEVER repeat the target phrase.
- Avoid using words with the same root as the target phrase when possible.
- If the learner's intended meaning does not fit, explain a real meaning of the original Danish phrase.

Rules for example_da:
- Include the corrected phrase or a natural inflected form of it.
- Make the example sound like everyday Danish.
- Keep it short.
- Avoid complicated subordinate clauses unless needed.
- Avoid examples about learning Danish unless the phrase naturally calls for it.
- If custom context was provided and fits, make the example fit that meaning.
- If the custom meaning does not fit, use a real meaning of the original Danish phrase instead.

Rules for extra_info:
- If meaning_match_status is "mismatch", begin with:
  "Mente du måske: ..."
- If the phrase is primarily a verb or verbal expression, give short conjugation info in Danish.
  Example format:
  "nutid: går · datid: gik · perfektum: er gået"
- If the phrase is a noun, give gender info:
  "en-ord" or "et-ord"
- If the phrase is another useful word type, give a short grammar label such as:
  "adverbium", "adjektiv", "fast udtryk", "pronomen"
- For adjectives, include a short useful form if relevant:
  "adjektiv · intetkøn: ... · flertal: ..."
- Keep extra_info short.
- If no useful extra info is available, return an empty string.
- For reflexive verbs or fixed verbal expressions, keep the info practical and natural for a learner.

Rules for meaning_match_status:
- Use "matched" when the intended meaning or context fits the Danish phrase.
- Use "mismatch" when the intended meaning probably belongs to another Danish phrase.
- Do not use "mismatch" just because the meaning is rare; if it is valid in context, use "matched".

Rules for suggested_alternative_da:
- If meaning_match_status is "matched", return "".
- If meaning_match_status is "mismatch" and there is an obvious better Danish word, return that word or short phrase.
- If meaning_match_status is "mismatch" but no obvious better word exists, return "".`,
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "phrase_analysis_response",
          schema: {
            type: "object",
            properties: {
              corrected_phrase: { type: "string" },
              translation_en: { type: "string" },
              short_explanation_da: { type: "string" },
              example_da: { type: "string" },
              example_en: { type: "string" },
              extra_info: { type: "string" },
              meaning_match_status: {
                type: "string",
                enum: ["matched", "mismatch"],
              },
              suggested_alternative_da: { type: "string" },
            },
            required: [
              "corrected_phrase",
              "translation_en",
              "short_explanation_da",
              "example_da",
              "example_en",
              "extra_info",
              "meaning_match_status",
              "suggested_alternative_da",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const text = response.output_text ?? "";

    let parsed = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return Response.json({ result: text });
    }

    return Response.json({
      ...parsed,
      result: JSON.stringify(parsed),
    });
  } catch (error: any) {
    console.error("ANALYZE PHRASE ERROR:", error);

    return Response.json(
      {
        error: "Failed",
        message: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
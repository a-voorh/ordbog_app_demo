import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { variant_id, variant_da } = await req.json();

    if (!variant_id || !variant_da) {
      return NextResponse.json(
        { error: "Missing variant_id or variant_da" },
        { status: 400 }
      );
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Translate the Danish sentence into natural English. Return only the English translation, no quotes, no explanation.",
        },
        {
          role: "user",
          content: variant_da,
        },
      ],
    });

    const variant_en = response.output_text.trim();

    if (!variant_en) {
      return NextResponse.json(
        { error: "No translation generated" },
        { status: 500 }
      );
    }

    const { error } = await supabaseAdmin
      .from("phrase_usage_variants_main")
      .update({ variant_en })
      .eq("id", variant_id);

    if (error) {
      console.error("Failed to save variant_en:", error);
      return NextResponse.json(
        { error: "Failed to save translation" },
        { status: 500 }
      );
    }

    return NextResponse.json({ variant_en });
  } catch (err) {
    console.error("translate-variant error:", err);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
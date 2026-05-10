import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { evaluateAndApplySpontaneousUsage } from "../../practice/spontaneous";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type CurrentTargetPhrase = {
  id: string;
  phrase: string;
  translation_en?: string | null;
  short_explanation?: string | null;
};

export async function POST(req: Request) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await req.json();

    const userMessage =
      typeof body.userMessage === "string" ? body.userMessage : "";

    const previousAssistantMessage =
      typeof body.previousAssistantMessage === "string"
        ? body.previousAssistantMessage
        : "";

    const history: ChatMessage[] = Array.isArray(body.history)
      ? body.history
      : [];

    const currentTargetPhrases: CurrentTargetPhrase[] = Array.isArray(
      body.currentTargetPhrases
    )
      ? body.currentTargetPhrases.filter(
          (item: any) =>
            item &&
            typeof item.id === "string" &&
            typeof item.phrase === "string"
        )
      : [];

    console.log("[spontaneous route] received request", {
      userMessage,
      previousAssistantMessage,
      historyLength: history.length,
      currentTargetPhraseCount: currentTargetPhrases.length,
    });

    if (!userMessage.trim()) {
      console.log("[spontaneous route] skipped: empty user message");
      return Response.json({ ok: true, skipped: "empty user message" });
    }

    const isFirstTurn =
      !previousAssistantMessage.trim() &&
      history.filter((msg) => msg.role === "user").length <= 1;

    console.log("[spontaneous route] running spontaneous helper", {
      isFirstTurn,
    });

    await evaluateAndApplySpontaneousUsage({
      openai,
      supabase,
      userMessage,
      previousAssistantMessage,
      currentTargetPhrases: currentTargetPhrases.map((item) => ({
        id: item.id,
        phrase: item.phrase,
        translation_en: item.translation_en ?? "",
        short_explanation: item.short_explanation ?? "",
      })),
      isFirstTurn,
      skipSpontaneousDetection: false,
    });

    console.log("[spontaneous route] spontaneous helper finished");

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("ANALYZE SPONTANEOUS USAGE ERROR:", error);

    return Response.json(
      {
        ok: false,
        error: "Failed",
        message: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
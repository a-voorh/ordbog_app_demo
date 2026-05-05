const appMode = process.env.NEXT_PUBLIC_APP_MODE;

const isDemo = appMode === "demo";

export const TABLES = {
  phrases: isDemo ? "phrases_demo" : "phrases",
  drafts: isDemo ? "phrase_drafts_demo" : "phrase_drafts",
  variants: isDemo ? "phrase_usage_variants" : "phrase_usage_variants_main",
};
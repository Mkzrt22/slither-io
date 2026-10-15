/**
 * Row types of the tables used by the app (mirror of supabase/migrations).
 * To regenerate full types from the live schema:
 *   npx supabase gen types typescript --project-id <id> > src/lib/db/database.types.ts
 */
import type { CatalogMetrics, TrackTextAnalysis } from "@/lib/text/analyze";
import type { DnaOutput } from "@/lib/ai/schemas";

export type PlanId = "free" | "artist" | "pro" | "label";

export interface PlanLimits {
  tracks_max: number;
  lyrics_generations: number;
  retouches: number;
  assists: number;
  dna_analyses: number;
  pdf_exports: number;
  prod_credits_monthly: number;
  prod_generations: number;
  artist_profiles_max: number;
  pdf_export: boolean;
  prod_ai: boolean;
  stems: boolean;
  history_days: number;
  priority: boolean;
}

export interface PlanRow {
  id: PlanId;
  name: string;
  price_monthly_cents: number;
  price_yearly_cents: number | null;
  currency: string;
  limits: PlanLimits;
  sort_order: number;
  is_active: boolean;
}

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "user" | "admin";
  plan: PlanId;
  locale: "fr" | "en";
  stripe_customer_id: string | null;
  onboarding_step: number;
  training_optin: boolean;
  marketing_optin: boolean;
  created_at: string;
}

export interface ArtistProfileRow {
  id: string;
  owner_id: string;
  stage_name: string;
  genres: string[];
  languages: string[];
  bio: string | null;
  explicit_default: boolean;
  verification_status: "none" | "pending" | "verified" | "rejected";
  verification_code: string | null;
  created_at: string;
}

export type Platform = "spotify" | "deezer" | "youtube" | "apple_music" | "soundcloud" | "instagram" | "tiktok" | "other";

export interface PlatformLinkRow {
  id: string;
  artist_id: string;
  platform: Platform;
  url: string;
}

export interface TrackRow {
  id: string;
  owner_id: string;
  artist_id: string;
  title: string;
  release_date: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  links: Partial<Record<Platform, string>>;
  lyrics: string | null;
  lyrics_source: "paste" | "file" | "transcription" | "manual";
  language: string | null;
  is_explicit: boolean;
  bpm_manual: number | null;
  rights_attested_at: string;
  analysis_status: "pending" | "analyzing" | "done" | "error";
  created_at: string;
  updated_at: string;
}

export interface TrackAnalysisRow {
  id: string;
  track_id: string;
  owner_id: string;
  bpm: number | null;
  musical_key: string | null;
  structure_json: TrackTextAnalysis["structure"] | null;
  rhymes_json: TrackTextAnalysis["rhymes"] | null;
  syllables_json: TrackTextAnalysis["syllables"] | null;
  stats_json: Pick<TrackTextAnalysis, "words" | "adlibs" | "language" | "englishShare" | "sections" | "lineCount" | "wordCount"> | null;
  themes_json: unknown;
  analyzer_version: string;
}

export interface StoredDna {
  llm: DnaOutput;
  metrics: CatalogMetrics;
  excerpts: Array<{ title: string; lines: string[] }>;
}

export interface ArtistDnaRow {
  id: string;
  owner_id: string;
  artist_id: string;
  version: number;
  status: "pending" | "processing" | "ready" | "error";
  dna_json: StoredDna | null;
  summary: string | null;
  reliability_score: number | null;
  track_count: number;
  model: string | null;
  job_id: string | null;
  error: string | null;
  created_at: string;
}

export type ProjectStatus = "idea" | "writing" | "ready" | "released";

export interface ProjectRow {
  id: string;
  owner_id: string;
  artist_id: string;
  title: string;
  status: ProjectStatus;
  theme: string | null;
  mood: string | null;
  notes: string | null;
  bpm: number | null;
  musical_key: string | null;
  beat_id: string | null;
  current_version_id: string | null;
  share_token: string | null;
  shared_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LyricSection {
  type: "intro" | "couplet" | "pre_refrain" | "refrain" | "pont" | "outro";
  label: string;
  bars: number;
  flow?: { pace: "lent" | "moyen" | "rapide" | "variable"; notes: string };
  lines: string[];
}

export interface LyricContent {
  sections: LyricSection[];
  angle?: string;
}

export interface LyricVersionRow {
  id: string;
  owner_id: string;
  project_id: string;
  generation_id: string | null;
  parent_version_id: string | null;
  variant: "A" | "B" | "C" | "edit";
  label: string | null;
  title: string | null;
  content_json: LyricContent;
  content_text: string;
  why_json: string[] | null;
  is_ai_generated: boolean;
  human_edit_ratio: number;
  recycling_report: unknown;
  created_at: string;
}

export interface GenerationRow {
  id: string;
  owner_id: string;
  artist_id: string | null;
  project_id: string | null;
  type: "lyrics" | "retouch" | "assist" | "dna" | "prod";
  status: "pending" | "streaming" | "done" | "error" | "refused" | "blocked";
  params_json: Record<string, unknown>;
  output_json: unknown;
  model: string | null;
  effort: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number;
  stop_reason: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string | null;
  plan: PlanId;
  billing_interval: "month" | "year" | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
}

export interface JobRow {
  id: string;
  user_id: string;
  type: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type UsageFeature = "lyrics_generation" | "retouch" | "assist" | "dna_analysis" | "export_pdf" | "prod_generation";

export interface QuotaResult {
  allowed: boolean;
  feature: UsageFeature;
  used: number;
  limit: number;
  remaining: number;
  event_id?: string;
}

export interface MyUsage {
  plan: PlanId;
  limits: PlanLimits;
  period_start: string;
  features: Record<UsageFeature, { used: number; limit: number }>;
  tracks: number;
  artist_profiles: number;
  credits: number;
}

export interface ModerationFlagRow {
  id: string;
  user_id: string;
  generation_id: string | null;
  lyric_version_id: string | null;
  source: "model" | "refusal" | "user_report" | "automatic";
  category: string | null;
  reason: string | null;
  excerpt: string | null;
  status: "open" | "dismissed" | "actioned";
  created_at: string;
}

-- =============================================================================
-- Flowrima — 002 : tables
-- Convention : chaque table « utilisateur » porte owner_id (= auth.uid()) pour
-- des politiques RLS simples et rapides (index sur owner_id partout).
-- La table « users » du cahier des charges est public.profiles (extension 1-1 de
-- auth.users, gérée par Supabase Auth).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Plans & quotas (référentiel, éditable depuis l'admin)
-- limits : {
--   "tracks_max": 3, "lyrics_generations": 3, "retouches": 20, "assists": 30,
--   "prod_credits_monthly": 0, "artist_profiles_max": 1, "pdf_export": false,
--   "prod_ai": false, "stems": false, "history_days": 30, "priority": false,
--   "dna_analyses": 5
-- }  (-1 = illimité)
-- ---------------------------------------------------------------------------
create table public.plans (
  id                    public.plan_id primary key,
  name                  text not null,
  price_monthly_cents   integer not null default 0,
  price_yearly_cents    integer,           -- prix annuel total (ex. 9,99 € x 12)
  currency              text not null default 'eur',
  limits                jsonb not null,
  sort_order            integer not null default 0,
  is_active             boolean not null default true,
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profils (users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text,
  display_name          text check (char_length(display_name) <= 80),
  role                  public.app_role not null default 'user',
  plan                  public.plan_id not null default 'free',
  locale                text not null default 'fr' check (locale in ('fr', 'en')),
  stripe_customer_id    text unique,
  onboarding_step       smallint not null default 0 check (onboarding_step between 0 and 3),
  -- Opt-in explicite (par défaut NON) pour l'entraînement de modèles.
  training_optin        boolean not null default false,
  marketing_optin       boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profils artistes (1 pour Découverte/Artiste/Pro, 5 pour Label)
-- ---------------------------------------------------------------------------
create table public.artist_profiles (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  stage_name            text not null check (char_length(stage_name) between 1 and 80),
  genres                text[] not null default '{}',
  languages             text[] not null default '{fr}',
  bio                   text check (char_length(bio) <= 1000),
  explicit_default      boolean not null default false,
  verification_status   public.verification_status not null default 'none',
  verification_code     text,              -- code à placer en bio Instagram
  verified_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.artist_profiles (owner_id);

create table public.platform_links (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  artist_id             uuid not null references public.artist_profiles (id) on delete cascade,
  platform              public.platform not null,
  url                   text not null check (url ~* '^https://'),
  created_at            timestamptz not null default now(),
  unique (artist_id, platform, url)
);
create index on public.platform_links (owner_id);

-- ---------------------------------------------------------------------------
-- Titres importés
-- ---------------------------------------------------------------------------
create table public.tracks (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  artist_id             uuid not null references public.artist_profiles (id) on delete cascade,
  title                 text not null check (char_length(title) between 1 and 200),
  release_date          date,
  duration_seconds      integer check (duration_seconds is null or duration_seconds between 1 and 7200),
  cover_url             text,
  links                 jsonb not null default '{}'::jsonb,      -- {"spotify": "https://…", …}
  audio_path            text,                                    -- phase 2 (bucket privé "audio")
  lyrics                text check (char_length(lyrics) <= 20000),
  lyrics_source         public.lyrics_source not null default 'paste',
  language              text,
  is_explicit           boolean not null default false,
  bpm_manual            numeric(5,1) check (bpm_manual is null or bpm_manual between 40 and 250),
  -- Attestation de droits obligatoire (horodatée). Le détail est dans consents.
  rights_attested_at    timestamptz not null,
  analysis_status       public.analysis_status not null default 'pending',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.tracks (owner_id);
create index on public.tracks (artist_id, release_date);

create table public.track_analyses (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  track_id              uuid not null unique references public.tracks (id) on delete cascade,
  -- Audio (phase 2, service Python)
  bpm                   numeric(5,1),
  musical_key           text,
  mode                  text check (mode is null or mode in ('major', 'minor')),
  energy                numeric(4,3),
  embedding             extensions.vector(512),     -- CLAP
  -- Texte (calculé par le code)
  structure_json        jsonb,
  rhymes_json           jsonb,
  syllables_json        jsonb,
  stats_json            jsonb,
  -- Texte (LLM, optionnel par titre — rempli par l'analyse batch)
  themes_json           jsonb,
  analyzer_version      text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.track_analyses (owner_id);

-- ---------------------------------------------------------------------------
-- ADN artistique (versionné)
-- ---------------------------------------------------------------------------
create table public.artist_dna (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  artist_id             uuid not null references public.artist_profiles (id) on delete cascade,
  version               integer not null,
  status                public.dna_status not null default 'pending',
  dna_json              jsonb,
  summary               text,
  reliability_score     smallint check (reliability_score between 0 and 100),
  track_count           integer not null default 0,
  model                 text,
  job_id                uuid,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (artist_id, version)
);
create index on public.artist_dna (owner_id);
create index on public.artist_dna (artist_id, version desc);

-- ---------------------------------------------------------------------------
-- Prods (marketplace — phase 2) : déclarées dès maintenant pour figer le modèle
-- ---------------------------------------------------------------------------
create table public.producers (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null unique default auth.uid() references public.profiles (id) on delete cascade,
  display_name          text not null check (char_length(display_name) between 1 and 80),
  stripe_account_id     text unique,
  kyc_status            text not null default 'not_started',
  commission_rate       numeric(4,3) not null default 0.250 check (commission_rate between 0.2 and 0.3),
  status                public.producer_status not null default 'pending',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.beats (
  id                    uuid primary key default gen_random_uuid(),
  producer_id           uuid not null references public.producers (id) on delete cascade,
  title                 text not null check (char_length(title) between 1 and 120),
  file_path             text not null,        -- bucket privé "beats" (fichier complet)
  preview_path          text,                 -- extrait tatoué
  stems_path            text,
  bpm                   numeric(5,1),
  musical_key           text,
  mode                  text check (mode is null or mode in ('major', 'minor')),
  genre                 text,
  mood                  text,
  tags                  text[] not null default '{}',
  embedding             extensions.vector(512),
  price_basic_cents     integer check (price_basic_cents is null or price_basic_cents >= 0),
  price_exclusive_cents integer check (price_exclusive_cents is null or price_exclusive_cents >= 0),
  currency              text not null default 'eur',
  status                public.beat_status not null default 'draft',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.beats (producer_id);
create index on public.beats (status, bpm);

-- ---------------------------------------------------------------------------
-- Projets (un projet = un morceau)
-- ---------------------------------------------------------------------------
create table public.projects (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  artist_id             uuid not null references public.artist_profiles (id) on delete cascade,
  title                 text not null default 'Sans titre' check (char_length(title) between 1 and 200),
  status                public.project_status not null default 'idea',
  theme                 text check (char_length(theme) <= 500),
  mood                  text,
  notes                 text check (char_length(notes) <= 10000),
  bpm                   numeric(5,1) check (bpm is null or bpm between 40 and 250),
  musical_key           text,
  beat_id               uuid references public.beats (id) on delete set null,
  current_version_id    uuid,      -- FK ajoutée après lyric_versions
  share_token           text unique,
  shared_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.projects (owner_id, updated_at desc);
create index on public.projects (artist_id);

-- ---------------------------------------------------------------------------
-- Générations IA (journal complet : paramètres, sortie, tokens, coût)
-- ---------------------------------------------------------------------------
create table public.generations (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  artist_id             uuid references public.artist_profiles (id) on delete set null,
  project_id            uuid references public.projects (id) on delete set null,
  type                  public.generation_type not null,
  status                public.generation_status not null default 'pending',
  params_json           jsonb not null default '{}'::jsonb,
  output_json           jsonb,
  model                 text,
  effort                text,
  input_tokens          integer not null default 0,
  output_tokens         integer not null default 0,
  cache_read_tokens     integer not null default 0,
  cache_write_tokens    integer not null default 0,
  cost                  numeric(12,6) not null default 0,   -- en USD
  stop_reason           text,
  error                 text,
  duration_ms           integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.generations (owner_id, created_at desc);
create index on public.generations (type, created_at desc);

create table public.lyric_versions (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  project_id            uuid not null references public.projects (id) on delete cascade,
  generation_id         uuid references public.generations (id) on delete set null,
  parent_version_id     uuid references public.lyric_versions (id) on delete set null,
  variant               text not null default 'edit' check (variant in ('A', 'B', 'C', 'edit')),
  label                 text,
  title                 text check (char_length(title) <= 200),
  content_json          jsonb not null,         -- { sections: [{ type, label, bars, flow, lines: [...] }] }
  content_text          text not null check (char_length(content_text) <= 30000),
  why_json              jsonb,                  -- « Pourquoi ça te ressemble »
  is_ai_generated       boolean not null default true,
  human_edit_ratio      numeric(4,3) not null default 0,   -- part de lignes réécrites par l'artiste
  recycling_report      jsonb,
  created_at            timestamptz not null default now()
);
create index on public.lyric_versions (project_id, created_at desc);
create index on public.lyric_versions (owner_id);

alter table public.projects
  add constraint projects_current_version_fk
  foreign key (current_version_id) references public.lyric_versions (id) on delete set null;

create table public.beat_licenses (
  id                        uuid primary key default gen_random_uuid(),
  beat_id                   uuid not null references public.beats (id) on delete restrict,
  buyer_id                  uuid not null references public.profiles (id) on delete cascade,
  artist_id                 uuid references public.artist_profiles (id) on delete set null,
  project_id                uuid references public.projects (id) on delete set null,
  license_type              public.license_type not null,
  price_cents               integer not null,
  platform_fee_cents        integer not null,
  currency                  text not null default 'eur',
  stripe_payment_intent_id  text unique,
  contract_path             text,
  created_at                timestamptz not null default now()
);
create index on public.beat_licenses (buyer_id);

-- ---------------------------------------------------------------------------
-- Facturation
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id      text not null,
  stripe_subscription_id  text not null unique,
  stripe_price_id         text,
  plan                    public.plan_id not null,
  billing_interval        text check (billing_interval in ('month', 'year')),
  status                  text not null,     -- statut Stripe : trialing, active, past_due, canceled…
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  trial_end               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index on public.subscriptions (user_id);

-- Événements Stripe déjà traités (idempotence des webhooks)
create table public.stripe_events (
  id            text primary key,
  type          text not null,
  processed_at  timestamptz not null default now()
);

-- Ledger des crédits prod : solde = somme des delta. Jamais d'UPDATE.
create table public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  delta         integer not null check (delta <> 0),
  reason        public.credit_reason not null,
  reference     text,          -- id facture Stripe, id génération…
  note          text,
  created_at    timestamptz not null default now()
);
create index on public.credit_ledger (user_id, created_at desc);
-- Idempotence : un même événement ne crédite/débite qu'une fois.
create unique index credit_ledger_idempotency
  on public.credit_ledger (user_id, reason, reference) where reference is not null;

create table public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  feature       public.usage_feature not null,
  quantity      integer not null default 1 check (quantity > 0),
  reference     text,          -- id génération / projet
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on public.usage_events (user_id, feature, created_at desc);

-- ---------------------------------------------------------------------------
-- Conformité
-- ---------------------------------------------------------------------------
create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind          public.consent_kind not null,
  granted       boolean not null,
  version       text not null,                 -- version du texte accepté (ex. "cgu-2026-10")
  subject_type  text,                          -- ex. 'track'
  subject_ids   uuid[] not null default '{}',  -- ex. titres concernés par l'attestation
  text_snapshot text,                          -- libellé exact affiché
  ip_hash       text,
  user_agent    text check (char_length(user_agent) <= 400),
  created_at    timestamptz not null default now()
);
create index on public.consents (user_id, kind, created_at desc);

create table public.moderation_flags (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  generation_id     uuid references public.generations (id) on delete set null,
  lyric_version_id  uuid references public.lyric_versions (id) on delete set null,
  source            text not null check (source in ('model', 'refusal', 'user_report', 'automatic')),
  category          text,
  reason            text check (char_length(reason) <= 2000),
  excerpt           text check (char_length(excerpt) <= 2000),
  status            public.moderation_status not null default 'open',
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index on public.moderation_flags (status, created_at desc);

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  metadata      jsonb not null default '{}'::jsonb,
  ip_hash       text,
  created_at    timestamptz not null default now()
);
create index on public.audit_logs (created_at desc);
create index on public.audit_logs (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Technique
-- ---------------------------------------------------------------------------
-- Jobs longs (statut temps réel dans l'UI via Supabase Realtime)
create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  type          text not null,          -- dna_analysis, dna_batch, transcription…
  status        public.job_status not null default 'queued',
  progress      smallint not null default 0 check (progress between 0 and 100),
  message       text,
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.jobs (user_id, created_at desc);

-- Rate limiting par fenêtre fixe (clé = "user:<id>:<route>" ou "ip:<hash>:<route>")
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (key, window_start)
);

-- Liste d'attente (phase 0)
create table public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  artist_name   text check (char_length(artist_name) <= 80),
  genre         text check (char_length(genre) <= 40),
  wants_interview boolean not null default false,
  source        text,
  created_at    timestamptz not null default now()
);

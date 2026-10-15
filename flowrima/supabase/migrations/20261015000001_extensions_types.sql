-- =============================================================================
-- Flowrima — 001 : extensions et types énumérés
-- Hébergement : projet Supabase en région UE (eu-west-3 Paris ou eu-central-1).
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;  -- gen_random_bytes, digest
create extension if not exists vector   with schema extensions;  -- pgvector (embeddings audio / texte)

-- Rôle applicatif d'un compte
create type public.app_role as enum ('user', 'admin');

-- Plans commerciaux (doivent correspondre aux lignes de public.plans)
create type public.plan_id as enum ('free', 'artist', 'pro', 'label');

create type public.platform as enum (
  'spotify', 'deezer', 'youtube', 'apple_music', 'soundcloud',
  'instagram', 'tiktok', 'other'
);

create type public.lyrics_source as enum ('paste', 'file', 'transcription', 'manual');

create type public.analysis_status as enum ('pending', 'analyzing', 'done', 'error');

create type public.dna_status as enum ('pending', 'processing', 'ready', 'error');

create type public.verification_status as enum ('none', 'pending', 'verified', 'rejected');

create type public.project_status as enum ('idea', 'writing', 'ready', 'released');

create type public.generation_type as enum ('lyrics', 'retouch', 'assist', 'dna', 'prod');

create type public.generation_status as enum (
  'pending', 'streaming', 'done', 'error', 'refused', 'blocked'
);

-- Fonctionnalités soumises à quota (une ligne de usage_events = une consommation)
create type public.usage_feature as enum (
  'lyrics_generation',   -- génération complète (3 propositions)
  'retouch',             -- régénération ligne/partie, boutons « plus punchy »…
  'assist',              -- dictionnaire de rimes / synonymes contextuels
  'dna_analysis',        -- analyse ADN du catalogue
  'export_pdf',
  'prod_generation'      -- phase 3 (consomme aussi des crédits prod)
);

create type public.credit_reason as enum (
  'monthly_grant', 'pack_purchase', 'prod_generation', 'refund',
  'admin_adjust', 'expiry'
);

create type public.consent_kind as enum (
  'rights_attestation',   -- « Je suis l'auteur ou l'ayant droit de ces titres »
  'terms',                -- CGU
  'sales_terms',          -- CGV
  'privacy',              -- politique de confidentialité
  'marketing_optin',      -- e-mails marketing
  'cookies_analytics',    -- cookies de mesure d'audience
  'training_optin',       -- entraînement de modèles sur ses données (désactivé par défaut)
  'withdrawal_waiver'     -- renonciation au droit de rétractation (contenu numérique)
);

create type public.moderation_status as enum ('open', 'dismissed', 'actioned');

create type public.job_status as enum ('queued', 'running', 'done', 'error');

create type public.beat_status as enum (
  'draft', 'pending_review', 'published', 'rejected', 'sold_exclusive'
);

create type public.license_type as enum ('basic', 'exclusive');

create type public.producer_status as enum ('pending', 'approved', 'rejected', 'suspended');

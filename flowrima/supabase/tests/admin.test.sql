-- Tests pgTAP : agrégats admin réservés au serveur
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(5);

-- Mesures avant insertion : le test reste valable sur une base déjà utilisée.
create temp table m0 as select public.admin_metrics(30) as m;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'carla@test.dev');
insert into public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, billing_interval, status)
values ('00000000-0000-0000-0000-0000000000c1', 'cus_1', 'sub_1', 'artist', 'month', 'active');
insert into public.generations (owner_id, type, status, cost, input_tokens, output_tokens)
values ('00000000-0000-0000-0000-0000000000c1', 'lyrics', 'done', 0.15, 6000, 7000);

select is(
  (public.admin_metrics(30) ->> 'mrr_cents')::int - (select (m ->> 'mrr_cents')::int from m0),
  1299, 'MRR : +12,99 € pour un abonnement Artiste mensuel');
select is(
  coalesce((public.admin_metrics(30) -> 'ai_cost_by_type' -> 'lyrics' ->> 'cost_usd')::numeric, 0)
    - coalesce((select (m -> 'ai_cost_by_type' -> 'lyrics' ->> 'cost_usd')::numeric from m0), 0),
  0.15, 'coût IA des générations : +0,15 $');

set local role service_role;
select lives_ok($$ select public.admin_metrics(30) $$, 'le serveur (service_role) lit les métriques');
reset role;

set local role authenticated;
select throws_ok($$ select public.admin_metrics(30) $$, '42501', null, 'un utilisateur ne peut pas lire les métriques admin');
reset role;
set local role anon;
select throws_ok($$ select public.admin_metrics(30) $$, '42501', null, 'un visiteur ne peut pas lire les métriques admin');
reset role;

select * from finish();
rollback;

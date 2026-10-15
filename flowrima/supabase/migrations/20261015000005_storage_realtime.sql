-- =============================================================================
-- Flowrima — 005 : stockage privé (URL signées) et temps réel
-- Ces blocs sont conditionnels : ils ne s'exécutent que si les schémas Supabase
-- correspondants existent (permet de tester les migrations sur un Postgres nu).
-- =============================================================================

do $$
begin
  if to_regclass('storage.buckets') is not null then
    -- Tous les buckets sont PRIVÉS : accès uniquement via URL signées courtes.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('audio',   'audio',   false, 52428800,  array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a']),
      ('avatars', 'avatars', false, 2097152,   array['image/jpeg', 'image/png', 'image/webp']),
      ('exports', 'exports', false, 10485760,  array['application/pdf', 'text/plain']),
      ('beats',   'beats',   false, 209715200, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'application/zip'])
    on conflict (id) do nothing;

    -- Chaque utilisateur ne voit que son dossier : <bucket>/<user_id>/...
    execute $p$
      create policy "own folder read" on storage.objects for select to authenticated
      using (bucket_id in ('audio', 'avatars')
             and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "own folder insert" on storage.objects for insert to authenticated
      with check (bucket_id in ('audio', 'avatars')
                  and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "own folder update" on storage.objects for update to authenticated
      using (bucket_id in ('audio', 'avatars')
             and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "own folder delete" on storage.objects for delete to authenticated
      using (bucket_id in ('audio', 'avatars')
             and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    -- 'exports' et 'beats' : serveur uniquement (service_role), aucune politique.
  end if;
end $$;

-- Temps réel : statut des jobs et de l'ADN poussé à l'interface (RLS appliquée).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs, public.artist_dna;
  end if;
end $$;

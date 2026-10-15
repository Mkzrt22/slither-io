import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { PlanRow } from "@/lib/db/types";
import { PLAN_CATALOG, planFeatures, type PlanCatalogEntry } from "./plans";

/**
 * Public plan catalogue for the pricing page: limits from the database
 * (editable in the admin), cached for an hour; static defaults when the
 * database is unreachable (e.g. at build time).
 */
export async function getPublicPlans(): Promise<PlanCatalogEntry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("plans");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return PLAN_CATALOG;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase.from("plans").select("*").order("sort_order");
    if (error || !data?.length) return PLAN_CATALOG;
    const rows = data as PlanRow[];
    return PLAN_CATALOG.map((p) => {
      const row = rows.find((r) => r.id === p.id);
      if (!row) return p;
      const limits = { ...p.limits, ...row.limits };
      return { ...p, priceMonthlyCents: row.price_monthly_cents, limits, features: planFeatures(p.id, limits) };
    });
  } catch {
    return PLAN_CATALOG;
  }
}

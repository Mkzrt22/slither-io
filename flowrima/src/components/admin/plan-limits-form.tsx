"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { updatePlanLimits } from "@/lib/actions/admin";

export function PlanLimitsForm({ id, limits }: { id: string; limits: unknown }) {
  const [state, action, pending] = useActionState(updatePlanLimits, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Textarea name="limits" rows={10} className="font-mono text-xs" defaultValue={JSON.stringify(limits, null, 2)} aria-label={`Quotas ${id}`} />
      {state && <p role="status" className={state.ok ? "text-sm text-success" : "text-sm text-danger"}>{state.message}</p>}
      <Button type="submit" size="sm" disabled={pending}>Enregistrer</Button>
    </form>
  );
}

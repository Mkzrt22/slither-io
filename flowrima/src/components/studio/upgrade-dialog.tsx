"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { m } from "@/i18n";

export function UpgradeDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (o: boolean) => void; detail?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={m.quota.blockedTitle} description={detail}>
        <p className="mb-5 text-sm">{m.quota.blockedText}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild className="flex-1">
            <Link href="/app/compte#abonnement">{m.common.upgrade} — 7 jours offerts</Link>
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            {m.common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

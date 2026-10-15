import { Progress } from "@/components/ui/card";
import type { MyUsage, UsageFeature } from "@/lib/db/types";
import { m } from "@/i18n";

export function UsageMeter({ usage, features }: { usage: MyUsage; features: UsageFeature[] }) {
  return (
    <ul className="space-y-3">
      {features.map((f) => {
        const { used, limit } = usage.features[f];
        const unlimited = limit === -1;
        return (
          <li key={f} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{m.quota[f]}</span>
              <span className="tabular-nums text-muted">
                {used} / {unlimited ? m.quota.unlimited : limit}
              </span>
            </div>
            {!unlimited && limit > 0 && <Progress value={(used / limit) * 100} label={m.quota[f]} />}
          </li>
        );
      })}
    </ul>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { m } from "@/i18n";

type Choice = "dark" | "light" | "system";
const ORDER: Choice[] = ["dark", "light", "system"];

function apply(choice: Choice) {
  const theme = choice === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("dark");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme") as Choice | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored && ORDER.includes(stored)) setChoice(stored);
    } catch {
      /* ignore */
    }
  }, []);
  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
  const label = { dark: m.common.themeDark, light: m.common.themeLight, system: m.common.themeSystem }[choice];
  const Icon = { dark: Moon, light: Sun, system: Monitor }[choice];
  return (
    <button
      type="button"
      onClick={() => {
        setChoice(next);
        try {
          localStorage.setItem("theme", next);
        } catch {
          /* ignore */
        }
        apply(next);
      }}
      className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
      aria-label={`${m.common.theme} : ${label}`}
      title={`${m.common.theme} : ${label}`}
    >
      <Icon className="size-4" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}

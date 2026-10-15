"use client";
import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function Slider({ className, label, ...props }: React.ComponentProps<typeof SliderPrimitive.Root> & { label: string }) {
  return (
    <SliderPrimitive.Root className={cn("relative flex h-8 w-full touch-none select-none items-center", className)} {...props}>
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-surface-2">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        className="block size-6 rounded-full border-2 border-accent bg-surface shadow focus-visible:outline-2 focus-visible:outline-ring"
      />
    </SliderPrimitive.Root>
  );
}

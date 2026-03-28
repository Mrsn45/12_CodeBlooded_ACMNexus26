"use client";

import { cn } from "@/lib/utils";

interface BrandMarkProps {
  compact?: boolean;
  className?: string;
}

export function BrandMark({ compact = false, className }: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", compact && "gap-2", className)}>
      <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-border/70 bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.24),_transparent_58%),linear-gradient(135deg,rgba(14,116,144,0.12),rgba(245,158,11,0.16))] shadow-[0_14px_34px_rgba(15,23,42,0.14)]">
        <div className="absolute h-6 w-6 rounded-full border-2 border-primary/85" />
        <div className="absolute h-3 w-3 rounded-full bg-accent" />
        <div className="absolute -right-0.5 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
      </div>

      <div className={cn("min-w-0", compact && "hidden sm:block")}>
        <p className="text-lg font-semibold tracking-[0.18em] text-foreground uppercase">RouteGuard</p>
        <p className="text-xs tracking-[0.28em] text-muted-foreground uppercase">Trip Intelligence</p>
      </div>
    </div>
  );
}

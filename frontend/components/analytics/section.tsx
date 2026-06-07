"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden break-inside-avoid",
        className
      )}
    >
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm break-inside-avoid">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export const CHART_COLORS = {
  primary: "hsl(var(--primary))",
  muted: "hsl(var(--muted-foreground))",
  destructive: "hsl(var(--destructive))",
};

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return `${(v * 100).toFixed(1)}%`;
}

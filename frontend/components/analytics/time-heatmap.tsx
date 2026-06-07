"use client";

import * as React from "react";
import type { AnalyticsTimeseries } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SectionCard } from "./section";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hour-of-day × day-of-week activity heatmap, rendered as a CSS grid. */
export function TimeHeatmap({ data }: { data: AnalyticsTimeseries }) {
  const counts = new Map<string, number>();
  let max = 0;
  for (const cell of data.heatmap) {
    counts.set(`${cell.dow}-${cell.hour}`, cell.queries);
    if (cell.queries > max) max = cell.queries;
  }

  return (
    <SectionCard title="When are users active?" hint="IST · darker = busier">
      {max === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[560px] gap-[3px]"
            style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}
          >
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center text-[9px] text-muted-foreground">
                {h % 3 === 0 ? h : ""}
              </div>
            ))}
            {DAYS.map((label, dow) => (
              <React.Fragment key={dow}>
                <div className="pr-2 text-right text-[10px] leading-4 text-muted-foreground">
                  {label}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const n = counts.get(`${dow}-${h}`) ?? 0;
                  // Alpha on the background (not `opacity`) so the print-only
                  // count below stays fully readable.
                  const alpha = n === 0 ? 0.06 : 0.15 + 0.85 * (n / max);
                  return (
                    <div
                      key={`${dow}-${h}`}
                      title={`${label} ${h}:00 — ${n} queries`}
                      className="relative h-4 rounded-[3px]"
                      style={{ backgroundColor: `hsl(var(--primary) / ${alpha})` }}
                    >
                      {n > 0 && (
                        <span
                          className={cn(
                            "absolute inset-0 hidden items-center justify-center text-[7px] leading-none print:flex",
                            alpha > 0.55 ? "text-primary-foreground" : "text-foreground"
                          )}
                        >
                          {n}
                        </span>
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

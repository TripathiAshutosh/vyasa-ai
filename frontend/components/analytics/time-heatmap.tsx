"use client";

import * as React from "react";
import type { AnalyticsTimeseries } from "@/lib/api";
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
                  return (
                    <div
                      key={`${dow}-${h}`}
                      title={`${label} ${h}:00 — ${n} queries`}
                      className="h-4 rounded-[3px] bg-primary"
                      style={{ opacity: n === 0 ? 0.06 : 0.15 + 0.85 * (n / max) }}
                    />
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

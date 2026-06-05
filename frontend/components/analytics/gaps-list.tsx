"use client";

import type { AnalyticsGaps } from "@/lib/api";
import { SectionCard } from "./section";

/** Refused / low-confidence questions — content gaps in the source documents. */
export function GapsList({ data }: { data: AnalyticsGaps }) {
  return (
    <SectionCard
      title="Unanswered & low-confidence questions"
      hint={`${data.total} total — candidates for new content`}
    >
      {data.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing here — every question matched the documents well. 🎉
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="pb-2 pr-2 font-medium">Question</th>
                <th className="pb-2 pr-2 font-medium">Score</th>
                <th className="pb-2 pr-2 font-medium">Status</th>
                <th className="pb-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.items.map((g) => (
                <tr key={g.id}>
                  <td className="max-w-0 truncate py-1.5 pr-2" title={g.question}>
                    {g.question}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">
                    {g.top_score !== null ? g.top_score.toFixed(2) : "–"}
                  </td>
                  <td className="py-1.5 pr-2">
                    {g.refused ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                        refused
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                        low confidence
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-xs text-muted-foreground">
                    {new Date(g.ts).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

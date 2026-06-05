"use client";

import type { AnalyticsFeedback } from "@/lib/api";
import { SectionCard, pct } from "./section";

export function FeedbackPanel({ data }: { data: AnalyticsFeedback }) {
  return (
    <SectionCard
      title="Answer feedback"
      hint={
        data.satisfaction_rate !== null
          ? `${pct(data.satisfaction_rate)} satisfaction · ${data.up} 👍 / ${data.down} 👎`
          : "no ratings yet"
      }
    >
      {data.negatives.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No 👎-rated answers in this period.
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="pb-2 pr-2 font-medium">Question (👎 answer)</th>
                <th className="pb-2 pr-2 font-medium">Topic</th>
                <th className="pb-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.negatives.map((n, i) => (
                <tr key={i}>
                  <td className="max-w-0 truncate py-1.5 pr-2" title={n.question}>
                    {n.question}
                    {n.comment && (
                      <span className="ml-1 text-xs text-muted-foreground" title={n.comment}>
                        💬
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-xs text-muted-foreground">
                    {n.topic ?? "–"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-xs text-muted-foreground">
                    {new Date(n.ts).toLocaleString()}
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

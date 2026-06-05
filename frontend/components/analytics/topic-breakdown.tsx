"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsTopics } from "@/lib/api";
import { CHART_COLORS, SectionCard, pct } from "./section";

export function TopicBreakdown({ data }: { data: AnalyticsTopics }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Queries by topic" hint="auto-classified">
        {data.by_topic.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.by_topic}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 24, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="topic"
                  tick={{ fontSize: 11 }}
                  width={88}
                />
                <Tooltip />
                <Bar dataKey="queries" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Top questions by intent"
        hint="similar questions grouped together"
      >
        {data.intents.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-2 font-medium">Question</th>
                  <th className="pb-2 pr-2 font-medium">Topic</th>
                  <th className="pb-2 text-right font-medium">Asked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.intents.map((it) => (
                  <tr key={it.id}>
                    <td
                      className="max-w-0 truncate py-1.5 pr-2"
                      title={it.canonical_question ?? it.example_question}
                    >
                      {it.canonical_question ?? it.example_question}
                      {it.refusal_rate > 0.5 && (
                        <span
                          className="ml-1 text-destructive"
                          title={`refused ${pct(it.refusal_rate)} of the time`}
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-xs text-muted-foreground">
                      {it.topic ?? "…"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{it.queries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

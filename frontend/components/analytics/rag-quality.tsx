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
import type { AnalyticsRag } from "@/lib/api";
import { CHART_COLORS, SectionCard } from "./section";

export function RagQuality({ data }: { data: AnalyticsRag }) {
  const dist = data.score_distribution.map((d) => ({
    range: `${(d.bucket / 10).toFixed(1)}–${((d.bucket + 1) / 10).toFixed(1)}`,
    queries: d.queries,
  }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Relevance score distribution" hint="top retrieved chunk">
        {dist.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="queries" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Most-cited document pages" hint="what answers draw on">
        {data.most_cited_pages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-2 font-medium">Document</th>
                  <th className="pb-2 pr-2 font-medium">Page</th>
                  <th className="pb-2 text-right font-medium">Citations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.most_cited_pages.map((r, i) => (
                  <tr key={i}>
                    <td className="max-w-0 truncate py-1.5 pr-2" title={r.source}>
                      {r.source}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{r.page}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.citations}</td>
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

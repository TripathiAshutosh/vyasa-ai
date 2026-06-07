"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsRag } from "@/lib/api";
import { DataTable } from "./data-table";
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
                <Bar dataKey="queries" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]}>
                  {/* hover tooltips don't exist on paper — print value labels instead */}
                  <LabelList
                    dataKey="queries"
                    position="top"
                    className="chart-print-label"
                    fill={CHART_COLORS.muted}
                    fontSize={10}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Most-cited document pages" hint="what answers draw on">
        {data.most_cited_pages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <DataTable
            rows={data.most_cited_pages}
            rowKey={(r) => `${r.source}-${r.page}`}
            maxHeightClassName="max-h-56"
            searchPlaceholder="Search documents…"
            initialSort={{ key: "citations", dir: "desc" }}
            columns={[
              {
                key: "source",
                label: "Document",
                className: "max-w-0 truncate",
                title: (r) => r.source,
                searchValue: (r) => r.source,
                sortValue: (r) => r.source,
                render: (r) => r.source,
              },
              {
                key: "page",
                label: "Page",
                className: "tabular-nums",
                sortValue: (r) => r.page,
                render: (r) => r.page,
              },
              {
                key: "citations",
                label: "Citations",
                align: "right",
                className: "tabular-nums",
                sortValue: (r) => r.citations,
                defaultDir: "desc",
                render: (r) => r.citations,
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}

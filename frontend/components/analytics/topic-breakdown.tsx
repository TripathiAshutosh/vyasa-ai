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
import type { AnalyticsTopics } from "@/lib/api";
import { DataTable } from "./data-table";
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
                <Bar dataKey="queries" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]}>
                  {/* hover tooltips don't exist on paper — print value labels instead */}
                  <LabelList
                    dataKey="queries"
                    position="right"
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

      <SectionCard
        title="Top questions by intent"
        hint="similar questions grouped together"
      >
        {data.intents.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <DataTable
            rows={data.intents}
            rowKey={(it) => it.id}
            maxHeightClassName="max-h-64"
            searchPlaceholder="Search questions…"
            initialSort={{ key: "queries", dir: "desc" }}
            columns={[
              {
                key: "question",
                label: "Question",
                className: "max-w-0 truncate",
                title: (it) => it.canonical_question ?? it.example_question,
                searchValue: (it) =>
                  `${it.canonical_question ?? ""} ${it.example_question}`,
                sortValue: (it) => it.canonical_question ?? it.example_question,
                render: (it) => (
                  <>
                    {it.canonical_question ?? it.example_question}
                    {it.refusal_rate > 0.5 && (
                      <span
                        className="ml-1 text-destructive"
                        title={`refused ${pct(it.refusal_rate)} of the time`}
                      >
                        ⚠
                      </span>
                    )}
                  </>
                ),
              },
              {
                key: "topic",
                label: "Topic",
                className: "whitespace-nowrap text-xs text-muted-foreground",
                sortValue: (it) => it.topic,
                searchValue: (it) => it.topic,
                render: (it) => it.topic ?? "…",
              },
              {
                key: "queries",
                label: "Asked",
                align: "right",
                className: "tabular-nums",
                sortValue: (it) => it.queries,
                defaultDir: "desc",
                render: (it) => it.queries,
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}

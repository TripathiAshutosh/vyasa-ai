"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsTimeseries } from "@/lib/api";
import { CHART_COLORS, SectionCard } from "./section";

export function UsageCharts({ data }: { data: AnalyticsTimeseries }) {
  return (
    <SectionCard title="Daily activity" hint="queries · unique visitors · refusal rate">
      {data.daily.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis
                yAxisId="rate"
                orientation="right"
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                tick={{ fontSize: 11 }}
                domain={[0, 1]}
                width={40}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === "refusal rate" && typeof value === "number"
                    ? `${(value * 100).toFixed(1)}%`
                    : value
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="queries"
                name="queries"
                stroke={CHART_COLORS.primary}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="visitors"
                name="visitors"
                stroke={CHART_COLORS.muted}
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="refusal_rate"
                name="refusal rate"
                stroke={CHART_COLORS.destructive}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}

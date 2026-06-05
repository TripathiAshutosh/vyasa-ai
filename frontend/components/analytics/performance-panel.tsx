"use client";

import type { AnalyticsPerformance } from "@/lib/api";
import { SectionCard, StatCard, pct } from "./section";

function ms(v: number | null): string {
  if (v === null) return "–";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
}

export function PerformancePanel({ data }: { data: AnalyticsPerformance }) {
  const lastDay = data.daily[data.daily.length - 1];
  return (
    <SectionCard title="Performance & cost" hint="token counts are estimates">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Time to first token"
          value={ms(data.latency_ttfb_ms.p50)}
          sub={`p90 ${ms(data.latency_ttfb_ms.p90)} · p99 ${ms(data.latency_ttfb_ms.p99)}`}
        />
        <StatCard
          label="Total response"
          value={ms(data.latency_total_ms.p50)}
          sub={`p90 ${ms(data.latency_total_ms.p90)} · p99 ${ms(data.latency_total_ms.p99)}`}
        />
        <StatCard
          label="Tokens in"
          value={data.tokens_in.toLocaleString()}
          sub="estimated"
        />
        <StatCard
          label="Tokens out"
          value={data.tokens_out.toLocaleString()}
          sub="estimated"
        />
        <StatCard
          label="Error rate"
          value={lastDay ? pct(lastDay.error_rate) : "–"}
          sub={lastDay ? `latest day (${lastDay.day})` : undefined}
        />
      </div>
    </SectionCard>
  );
}

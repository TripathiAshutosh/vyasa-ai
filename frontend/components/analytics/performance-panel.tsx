"use client";

import type { AnalyticsPerformance } from "@/lib/api";
import { DataTable } from "./data-table";
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

      {(data.by_model?.length ?? 0) > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Usage by provider tier
            <span className="ml-2 normal-case tracking-normal">
              L1 = primary, falls back to L2/L3 on rate limits
            </span>
          </h3>
          <DataTable
            rows={data.by_model}
            rowKey={(m) => m.model}
            maxHeightClassName="max-h-56"
            initialSort={{ key: "queries", dir: "desc" }}
            columns={[
              {
                key: "model",
                label: "Tier",
                sortValue: (m) => m.model,
                render: (m) => m.model,
              },
              {
                key: "queries",
                label: "Queries",
                align: "right",
                className: "tabular-nums",
                sortValue: (m) => m.queries,
                defaultDir: "desc",
                render: (m) => m.queries.toLocaleString(),
              },
              {
                key: "tokens",
                label: "Tokens (in / out)",
                align: "right",
                className: "tabular-nums text-xs text-muted-foreground",
                sortValue: (m) => m.tokens_in + m.tokens_out,
                defaultDir: "desc",
                render: (m) =>
                  `${m.tokens_in.toLocaleString()} / ${m.tokens_out.toLocaleString()}`,
              },
              {
                key: "error_rate",
                label: "Errors",
                align: "right",
                className: "tabular-nums",
                sortValue: (m) => m.error_rate,
                defaultDir: "desc",
                render: (m) => pct(m.error_rate),
              },
              {
                key: "cost",
                label: "Est. cost",
                align: "right",
                className: "tabular-nums",
                sortValue: (m) => m.est_cost_usd,
                defaultDir: "desc",
                render: (m) =>
                  m.est_cost_usd > 0 ? `$${m.est_cost_usd.toFixed(2)}` : "free",
              },
            ]}
          />
        </div>
      )}
    </SectionCard>
  );
}

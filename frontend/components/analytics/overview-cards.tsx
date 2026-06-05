"use client";

import type { AnalyticsOverview } from "@/lib/api";
import { StatCard, pct } from "./section";

export function OverviewCards({ data }: { data: AnalyticsOverview }) {
  const fb = data.feedback_up + data.feedback_down;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Queries" value={data.total_queries} />
      <StatCard
        label="Visitors"
        value={data.unique_visitors}
        sub={`${data.new_visitors} new · ${data.returning_visitors} returning`}
      />
      <StatCard
        label="Sessions"
        value={data.unique_sessions}
        sub={`${data.avg_queries_per_session} queries/session`}
      />
      <StatCard
        label="Refusal rate"
        value={pct(data.refusal_rate)}
        sub={
          data.avg_top_score !== null
            ? `avg relevance ${data.avg_top_score.toFixed(2)}`
            : undefined
        }
      />
      <StatCard
        label="Satisfaction"
        value={fb ? pct(data.feedback_up / fb) : "–"}
        sub={fb ? `${data.feedback_up} 👍 · ${data.feedback_down} 👎` : "no feedback yet"}
      />
      <StatCard
        label="Est. cost"
        value={`$${data.est_cost_usd.toFixed(2)}`}
        sub={`~$${data.est_cost_usd_per_day.toFixed(3)}/day · estimated`}
      />
    </div>
  );
}

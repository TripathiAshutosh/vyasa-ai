"use client";

import * as React from "react";
import { Sparkles, Cpu } from "lucide-react";
import type { HealthInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  health: HealthInfo | null;
}

export function ProviderBadge({ health }: Props) {
  if (!health) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
        connecting…
      </span>
    );
  }
  const isOpenAI = health.provider === "openai";
  const Icon = isOpenAI ? Sparkles : Cpu;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        isOpenAI
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          : "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300"
      )}
      title={`Embeddings: ${health.embed_model} · LLM: ${health.llm_model}${
        health.reranker ? ` · Reranker: ${health.reranker}` : ""
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {isOpenAI ? "OpenAI" : "Open Source (Groq + Jina)"}
    </span>
  );
}

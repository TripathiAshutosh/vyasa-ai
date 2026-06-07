export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface Source {
  source: string;
  page: number;
  text: string;
  score?: number | null;
}

export interface DocumentEntry {
  name: string;
  size_bytes: number;
  chunks: number;
  missing?: boolean;
}

export interface DocumentsList {
  files: DocumentEntry[];
  total_chunks: number;
}

export interface HealthInfo {
  status: string;
  provider: "openai" | "opensource";
  embed_model: string;
  llm_model: string;
  reranker: string | null;
  num_chunks: number;
}

// Empty string → use same-origin relative URLs (Caddy routes /api/* to backend in compose).
// Undefined  → fall back to the local dev server URL.
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function url(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

export async function fetchHealth(): Promise<HealthInfo> {
  const r = await fetch(url("/api/health"));
  if (!r.ok) throw new Error(`health: ${r.status}`);
  return r.json();
}

export async function fetchDocuments(): Promise<DocumentsList> {
  const r = await fetch(url("/api/documents"));
  if (!r.ok) throw new Error(`documents: ${r.status}`);
  return r.json();
}

export async function uploadDocument(
  file: File,
  token: string
): Promise<{ name: string; size_bytes: number; chunks_added: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(url("/api/documents/upload"), {
    method: "POST",
    headers: { "X-Admin-Token": token },
    body: fd,
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`upload: ${r.status} ${msg}`);
  }
  return r.json();
}

export async function refreshIndex(
  token: string
): Promise<{ files: Record<string, number>; total_chunks: number }> {
  const r = await fetch(url("/api/documents/refresh"), {
    method: "POST",
    headers: { "X-Admin-Token": token },
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`refresh: ${r.status} ${msg}`);
  }
  return r.json();
}

export async function deleteDocument(
  name: string,
  token: string
): Promise<{ name: string; chunks_removed: number; file_removed: boolean }> {
  const r = await fetch(url(`/api/documents/${encodeURIComponent(name)}`), {
    method: "DELETE",
    headers: { "X-Admin-Token": token },
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`delete: ${r.status} ${msg}`);
  }
  return r.json();
}

// --- Anonymous analytics identifiers (no PII, no cookies) ---
// visitor_id persists across visits (localStorage); session_id lasts one tab
// session (sessionStorage). Both are random UUIDs the backend never links to
// any personal data.

function getOrCreateId(storage: Storage, key: string): string {
  let id = storage.getItem(key);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    storage.setItem(key, id);
  }
  return id;
}

export function getVisitorId(): string | null {
  try {
    return getOrCreateId(window.localStorage, "phd_visitor_id");
  } catch {
    return null; // storage blocked (e.g. strict iframe settings) — IDs are optional
  }
}

export function getSessionId(): string | null {
  try {
    return getOrCreateId(window.sessionStorage, "phd_session_id");
  } catch {
    return null;
  }
}

export async function submitFeedback(
  eventId: number,
  rating: 1 | -1,
  comment?: string
): Promise<void> {
  const r = await fetch(url("/api/feedback"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: eventId,
      rating,
      visitor_id: getVisitorId(),
      comment: comment || null,
    }),
  });
  if (!r.ok) throw new Error(`feedback: ${r.status}`);
}

export interface StreamCallbacks {
  onSources?: (sources: Source[]) => void;
  onToken?: (token: string) => void;
  /** Fired after the answer with the analytics event id (used for 👍/👎). */
  onMeta?: (meta: { event_id: number }) => void;
  onDone?: () => void;
  onError?: (err: string) => void;
}

/** Streams the chat response, parsing the SSE event/data protocol. */
export async function streamChat(
  messages: ChatMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const visitorId = getVisitorId();
  const sessionId = getSessionId();
  if (visitorId) headers["X-Visitor-Id"] = visitorId;
  if (sessionId) headers["X-Session-Id"] = sessionId;
  const r = await fetch(url("/api/chat"), {
    method: "POST",
    headers,
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!r.ok || !r.body) {
    cb.onError?.(`chat: ${r.status}`);
    return;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | null = null;
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0 && event === null) return;
    const data = dataLines.join("\n");
    try {
      if (event === "sources") {
        cb.onSources?.(JSON.parse(data) as Source[]);
      } else if (event === "meta") {
        cb.onMeta?.(JSON.parse(data) as { event_id: number });
      } else if (event === "done") {
        cb.onDone?.();
      } else if (event === "error") {
        const obj = JSON.parse(data);
        cb.onError?.(obj.message || "stream error");
      } else {
        // default message event
        const obj = JSON.parse(data);
        if (typeof obj.token === "string") cb.onToken?.(obj.token);
      }
    } catch {
      /* ignore parse errors on partial lines */
    }
    event = null;
    dataLines = [];
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    // SSE messages are separated by blank lines (\n\n).
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const raw of chunk.split("\n")) {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith(":")) continue; // comment
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      flush();
    }
  }
  // final flush in case stream ended without trailing blank line
  if (dataLines.length > 0) flush();
  cb.onDone?.();
}

// --- Admin analytics ---

export interface AnalyticsOverview {
  from: number;
  to: number;
  total_queries: number;
  unique_visitors: number;
  unique_sessions: number;
  avg_queries_per_session: number;
  new_visitors: number;
  returning_visitors: number;
  refusal_rate: number;
  avg_top_score: number | null;
  error_rate: number;
  aborted: number;
  est_cost_usd: number;
  est_cost_usd_per_day: number;
  feedback_up: number;
  feedback_down: number;
}

export interface AnalyticsTimeseries {
  daily: { day: string; queries: number; visitors: number; refusal_rate: number }[];
  heatmap: { dow: number; hour: number; queries: number }[];
  tz_offset_minutes: number;
}

export interface AnalyticsTopics {
  by_topic: { topic: string; queries: number }[];
  intents: {
    id: number;
    canonical_question: string | null;
    topic: string | null;
    label_status: string;
    queries: number;
    example_question: string;
    refusal_rate: number;
  }[];
}

export interface AnalyticsGaps {
  total: number;
  items: {
    id: number;
    ts: string;
    question: string;
    top_score: number | null;
    refused: number;
    canonical_question: string | null;
    topic: string | null;
  }[];
}

export interface AnalyticsRag {
  most_cited_pages: { source: string; page: number; citations: number }[];
  by_document: { source: string; citations: number }[];
  score_distribution: { bucket: number; queries: number }[];
}

export interface AnalyticsPerformance {
  latency_ttfb_ms: { p50: number | null; p90: number | null; p99: number | null };
  latency_total_ms: { p50: number | null; p90: number | null; p99: number | null };
  tokens_in: number;
  tokens_out: number;
  tokens_estimated: boolean;
  daily: { day: string; est_cost_usd: number; queries: number; error_rate: number }[];
  by_model: {
    model: string;
    queries: number;
    tokens_in: number;
    tokens_out: number;
    error_rate: number;
    est_cost_usd: number;
  }[];
}

export interface AnalyticsFeedback {
  up: number;
  down: number;
  satisfaction_rate: number | null;
  negatives: {
    ts: string;
    comment: string | null;
    question: string;
    top_score: number | null;
    topic: string | null;
  }[];
}

async function fetchAnalytics<T>(
  path: string,
  token: string,
  range: { from: number; to: number }
): Promise<T> {
  const qs = new URLSearchParams({ from: String(range.from), to: String(range.to) });
  const r = await fetch(url(`/api/analytics/${path}?${qs}`), {
    headers: { "X-Admin-Token": token },
  });
  if (!r.ok) throw new Error(`analytics/${path}: ${r.status}`);
  return r.json();
}

export interface AnalyticsBundle {
  overview: AnalyticsOverview;
  timeseries: AnalyticsTimeseries;
  topics: AnalyticsTopics;
  gaps: AnalyticsGaps;
  rag: AnalyticsRag;
  performance: AnalyticsPerformance;
  feedback: AnalyticsFeedback;
}

export async function fetchAllAnalytics(
  token: string,
  range: { from: number; to: number }
): Promise<AnalyticsBundle> {
  const [overview, timeseries, topics, gaps, rag, performance, feedback] =
    await Promise.all([
      fetchAnalytics<AnalyticsOverview>("overview", token, range),
      fetchAnalytics<AnalyticsTimeseries>("timeseries", token, range),
      fetchAnalytics<AnalyticsTopics>("topics", token, range),
      fetchAnalytics<AnalyticsGaps>("gaps", token, range),
      fetchAnalytics<AnalyticsRag>("rag", token, range),
      fetchAnalytics<AnalyticsPerformance>("performance", token, range),
      fetchAnalytics<AnalyticsFeedback>("feedback", token, range),
    ]);
  return { overview, timeseries, topics, gaps, rag, performance, feedback };
}

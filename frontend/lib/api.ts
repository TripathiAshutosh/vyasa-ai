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

export interface StreamCallbacks {
  onSources?: (sources: Source[]) => void;
  onToken?: (token: string) => void;
  onDone?: () => void;
  onError?: (err: string) => void;
}

/** Streams the chat response, parsing the SSE event/data protocol. */
export async function streamChat(
  messages: ChatMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const r = await fetch(url("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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

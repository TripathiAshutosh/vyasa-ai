"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowUp, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble, type UIMessage } from "@/components/message";
import { streamChat, type ChatMessage } from "@/lib/api";

const SUGGESTIONS = [
  "What is the eligibility criteria for the PhD programme?",
  "How is the entrance examination structured?",
  "What documents do I need to submit with my application?",
  "What is the fee structure and refund policy?",
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Turns backend SSE error blobs (e.g. "Groq 429: {...}") into one short sentence. */
function humanizeError(raw: string): string {
  // Try to pull a JSON error body out of the message.
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const obj = JSON.parse(raw.slice(jsonStart));
      const inner = obj?.error?.message || obj?.message;
      const code = obj?.error?.code;
      if (code === "rate_limit_exceeded" && typeof inner === "string") {
        const wait = inner.match(/try again in ([\d.]+s)/i)?.[1];
        return wait
          ? `Rate limit reached. Please try again in ${wait}.`
          : "Rate limit reached. Please wait a few seconds and try again.";
      }
      if (typeof inner === "string") return inner;
    } catch {
      /* fall through */
    }
  }
  if (/^Groq 413/i.test(raw)) return "Request too large for the model. Lower CHUNK_SIZE or TOP_K.";
  if (/^Groq 401|invalid_api_key/i.test(raw)) return "Groq rejected the API key. Check models.config.json.";
  if (/^Groq 5\d\d/i.test(raw)) return "Groq service error. Please retry.";
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

export function ChatInterface() {
  const [messages, setMessages] = React.useState<UIMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;

    const userMsg: UIMessage = { id: uid(), role: "user", content };
    const assistantMsg: UIMessage = {
      id: uid(),
      role: "assistant",
      content: "",
      pending: true,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    const history: ChatMessage[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await streamChat(
        history,
        {
          onSources: (sources) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsg.id ? { ...m, sources } : m))
            ),
          onToken: (token) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + token, pending: false }
                  : m
              )
            ),
          onError: (err) => {
            const friendly = humanizeError(err);
            toast.error(friendly);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      content: m.content || `_${friendly}_`,
                      pending: false,
                    }
                  : m
              )
            );
          },
        },
        ctrl.signal
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error((e as Error).message);
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false } : m))
      );
      setStreaming(false);
      abortRef.current = null;
      taRef.current?.focus();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const reset = () => {
    if (streaming) stop();
    setMessages([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl pt-16 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Vyasa AI Assistant
            </h1>
            <p className="mt-1 text-sm uppercase tracking-[0.18em] text-primary/80">
              Your guide to PhD admissions
            </p>
            <p className="mt-4 text-muted-foreground">
              Ask anything about eligibility, entrance, application, fees, or
              important dates — every answer is drawn straight from the official
              admission documents.
            </p>
            <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-lg border bg-card px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-3xl p-4">
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about eligibility, deadlines, fees, entrance pattern…"
              rows={1}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 min-h-[44px] max-h-40"
            />
            {streaming ? (
              <Button
                onClick={stop}
                size="icon"
                variant="destructive"
                title="Stop generating"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={() => void send(input)}
                size="icon"
                disabled={!input.trim()}
                title="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Enter to send · Shift+Enter for newline</span>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              New chat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

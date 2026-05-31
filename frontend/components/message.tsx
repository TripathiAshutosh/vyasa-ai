"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, User, Bot } from "lucide-react";
import type { Source } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  pending?: boolean;
}

interface Props {
  msg: UIMessage;
}

export function MessageBubble({ msg }: Props) {
  const [openSource, setOpenSource] = React.useState<Source | null>(null);
  const isUser = msg.role === "user";

  return (
    <div className={cn("flex gap-3 animate-slide-up", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-1">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[78ch] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted/60 text-foreground rounded-bl-sm"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        ) : (
          <div className="markdown">
            {msg.content ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            ) : msg.pending ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-200ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-100ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" />
              </span>
            ) : null}
          </div>
        )}

        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
            {msg.sources.map((s, i) => (
              <button
                key={`${s.source}-${s.page}-${i}`}
                onClick={() => setOpenSource(s)}
                className="inline-flex items-center gap-1 rounded-full border bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                title="Click to view source excerpt"
              >
                <FileText className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{s.source}</span>
                <span className="text-foreground/70">· p.{s.page}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground mt-1">
          <User className="h-4 w-4" />
        </div>
      )}

      <Dialog open={!!openSource} onOpenChange={(o) => !o && setOpenSource(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{openSource?.source}</span>
              <span className="text-muted-foreground font-normal">
                · page {openSource?.page}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
            {openSource?.text}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

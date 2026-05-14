"use client";

import { useState, useRef } from "react";

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  model: string;
};

type PortfolioContext = {
  accountSize: number;
  maxRiskPct: number;
  dailyLossLimitPct: number;
  totalMarketValue: number | null;
  totalOpenPnl: number | null;
  holdings: {
    ticker: string;
    qty: number;
    avgCost: number;
    price: number | null;
    openPnl: number | null;
    marketValue: number | null;
  }[];
};

const PROMPT_CARDS = [
  {
    label: "Explain my open P&L",
    prompt: "Explain my current open P&L across all positions. Which position contributes most? What does this mean for my risk?",
  },
  {
    label: "Review my position sizing",
    prompt: "Review my position sizes relative to my account size and max risk per trade setting. Are any positions oversized?",
  },
  {
    label: "What could go wrong today?",
    prompt: "Looking at my open positions, what are the key risks I should be aware of? What could go wrong?",
  },
  {
    label: "Daily loss limit status",
    prompt: "How close am I to my daily loss limit? Explain the math and what it means for the rest of the trading day.",
  },
];

export function AiChat({ portfolioContext }: { portfolioContext: PortfolioContext }) {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<"idle" | "streaming" | "done" | "error" | "budget">("idle");
  const [text, setText] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showData, setShowData] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function submit(overridePrompt?: string) {
    const finalPrompt = overridePrompt ?? prompt.trim();
    if (!finalPrompt) return;

    setState("streaming");
    setText("");
    setUsage(null);
    setErrorMsg("");
    setShowData(false);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: finalPrompt, dataProvided: portfolioContext }),
      });

      if (res.status === 429) {
        setState("budget");
        return;
      }

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg((data as { error?: string }).error ?? `Error ${res.status}`);
        setState("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const markerIdx = buffer.indexOf("\n\n__USAGE__:");
        if (markerIdx !== -1) {
          const textPart = buffer.slice(0, markerIdx);
          const usagePart = buffer.slice(markerIdx + "\n\n__USAGE__:".length);
          setText(textPart);
          try {
            setUsage(JSON.parse(usagePart) as Usage);
          } catch {
            // show text even if usage parse fails
          }
          break;
        }

        setText(buffer);
      }

      setState("done");
    } catch (err) {
      setErrorMsg(String(err));
      setState("error");
    }
  }

  function reset() {
    setState("idle");
    setText("");
    setUsage(null);
    setErrorMsg("");
    setShowData(false);
  }

  return (
    <div className="space-y-4">
      {/* Prompt cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROMPT_CARDS.map((card) => (
          <button
            key={card.label}
            onClick={() => {
              setPrompt(card.prompt);
              submit(card.prompt);
            }}
            disabled={state === "streaming"}
            className="rounded-md border border-border bg-card/50 px-4 py-3 text-left text-sm hover:bg-card transition disabled:opacity-50"
          >
            <span className="font-medium">{card.label}</span>
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {card.prompt}
            </p>
          </button>
        ))}
      </div>

      {/* Free-text input */}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about my risk, my portfolio, my watchlist scores..."
          rows={2}
          maxLength={2000}
          disabled={state === "streaming"}
          className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
        />
        <button
          onClick={() => submit()}
          disabled={state === "streaming" || !prompt.trim()}
          className="h-fit self-end rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
        >
          {state === "streaming" ? "Thinking…" : "Ask"}
        </button>
      </div>

      {/* Response panel */}
      {state !== "idle" && (
        <div className="rounded-md border border-border/50 bg-card/50 p-4 space-y-3">
          {state === "budget" ? (
            <p className="text-sm text-destructive">
              Monthly token budget reached. Adjust your budget in Settings.
            </p>
          ) : state === "error" ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
                {text}
                {state === "streaming" && (
                  <span className="animate-pulse text-muted-foreground">▌</span>
                )}
              </p>

              {state === "done" && usage && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/30 pt-2">
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    ${usage.costUsd.toFixed(5)} · {usage.inputTokens + usage.outputTokens} tokens
                    {usage.cacheReadInputTokens > 0 && (
                      <span className="text-green-400/80">
                        {" "}· {usage.cacheReadInputTokens} cached
                      </span>
                    )}
                    {" · "}
                    {usage.model}
                  </span>
                  <button
                    onClick={() => setShowData((p) => !p)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition"
                  >
                    {showData ? "Hide" : "Show"} data provided
                  </button>
                  <button
                    onClick={reset}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition"
                  >
                    Ask another
                  </button>
                </div>
              )}

              {showData && (
                <pre className="text-[10px] text-muted-foreground/70 overflow-auto max-h-40 rounded border border-border/30 bg-background/50 p-2 leading-relaxed">
                  {JSON.stringify(portfolioContext, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  model: string;
};

type Assessment = {
  confidence: "low" | "medium" | "high";
  primary_catalyst: string;
  primary_risk: string;
  exit_triggers: string[];
  holding_period_days: number;
  reasoning: string;
};

type State = "idle" | "streaming" | "done" | "error" | "budget";
type Mode = "explain" | "assess";

export function ExplainButton({
  prompt,
  dataProvided,
  label = "Explain",
  mode = "explain",
}: {
  prompt: string;
  dataProvided: Record<string, unknown>;
  label?: string;
  mode?: Mode;
}) {
  const [state, setState] = useState<State>("idle");
  const [text, setText] = useState("");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showData, setShowData] = useState(false);

  async function run() {
    setState("streaming");
    setText("");
    setAssessment(null);
    setUsage(null);
    setErrorMsg("");
    setShowData(false);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, dataProvided, mode }),
      });

      if (res.status === 429) {
        setState("budget");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg((data as { error?: string }).error ?? `Error ${res.status}`);
        setState("error");
        return;
      }

      if (mode === "assess") {
        const data = (await res.json()) as {
          assessment: Assessment;
          usage: Usage;
        };
        setAssessment(data.assessment);
        setUsage(data.usage);
        setState("done");
        return;
      }

      if (!res.body) {
        setErrorMsg("No response body");
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
            // usage parse failed — still show text
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

  if (state === "idle") {
    return (
      <button
        onClick={run}
        className="text-[11px] text-muted-foreground hover:text-foreground transition underline-offset-2 hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border/50 bg-background/40 p-3 space-y-2 text-sm">
      {state === "budget" ? (
        <p className="text-xs text-destructive">
          Monthly token budget reached. Adjust your budget in Settings.
        </p>
      ) : (
        <>
          {mode === "assess" && state === "streaming" && (
            <p className="text-xs text-muted-foreground">
              Generating structured assessment…
            </p>
          )}

          {mode === "assess" && assessment && (
            <AssessmentCard assessment={assessment} />
          )}

          {mode === "explain" && (
            <p className="leading-relaxed whitespace-pre-wrap text-foreground/85">
              {text}
              {state === "streaming" && (
                <span className="animate-pulse text-muted-foreground">▌</span>
              )}
            </p>
          )}

          {state === "done" && usage && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/30 pt-2">
              <span className="text-[10px] text-muted-foreground tabular-nums">
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
                className="text-[10px] text-muted-foreground hover:text-foreground transition"
              >
                {showData ? "Hide" : "Show"} data provided
              </button>
              <button
                onClick={() => setState("idle")}
                className="text-[10px] text-muted-foreground hover:text-foreground transition"
              >
                Close
              </button>
            </div>
          )}

          {showData && (
            <pre className="text-[10px] text-muted-foreground/70 overflow-auto max-h-40 rounded border border-border/30 bg-background/50 p-2 leading-relaxed">
              {JSON.stringify(dataProvided, null, 2)}
            </pre>
          )}

          {state === "error" && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}

          <p className="text-[10px] text-muted-foreground/60 border-t border-border/20 pt-1">
            Educational and decision-support only. Not financial advice. Markets involve risk.
          </p>
        </>
      )}
    </div>
  );
}

function AssessmentCard({ assessment }: { assessment: Assessment }) {
  const confidenceColour =
    assessment.confidence === "high"
      ? "bg-green-500/15 text-green-300 border-green-500/30"
      : assessment.confidence === "medium"
        ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
        : "bg-red-500/15 text-red-300 border-red-500/30";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${confidenceColour}`}
        >
          {assessment.confidence} confidence
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          Hold ~{assessment.holding_period_days}d
        </span>
      </div>

      <Field label="Primary catalyst" value={assessment.primary_catalyst} />
      <Field label="Primary risk" value={assessment.primary_risk} />

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Exit triggers
        </p>
        <ul className="space-y-0.5 text-xs text-foreground/85">
          {assessment.exit_triggers.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground/60">·</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Reasoning
        </p>
        <p className="text-xs leading-relaxed text-foreground/80">
          {assessment.reasoning}
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-xs text-foreground/85">{value}</p>
    </div>
  );
}

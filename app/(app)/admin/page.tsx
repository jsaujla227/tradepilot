"use client";

import { useState } from "react";

type JobStatus = "idle" | "running" | "done" | "error";

interface JobResult {
  [key: string]: unknown;
}

function JobCard({
  title,
  description,
  endpoint,
}: {
  title: string;
  description: string;
  endpoint: string;
}) {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [result, setResult] = useState<JobResult | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function run() {
    setStatus("running");
    setResult(null);
    setElapsed(null);
    const t0 = Date.now();
    setStartedAt(t0);

    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      setElapsed(Date.now() - t0);
      if (!res.ok) {
        setStatus("error");
        setResult(data);
      } else {
        setStatus("done");
        setResult(data);
      }
    } catch (err) {
      setElapsed(Date.now() - (startedAt ?? Date.now()));
      setStatus("error");
      setResult({ error: String(err) });
    }
  }

  const statusColor =
    status === "done"
      ? "text-green-400"
      : status === "error"
        ? "text-red-400"
        : status === "running"
          ? "text-yellow-400"
          : "text-muted-foreground";

  const statusLabel =
    status === "idle"
      ? "Ready"
      : status === "running"
        ? "Running… (up to ~2 min)"
        : status === "done"
          ? `Done in ${((elapsed ?? 0) / 1000).toFixed(1)} s`
          : `Error after ${((elapsed ?? 0) / 1000).toFixed(1)} s`;

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-sm">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={run}
          disabled={status === "running"}
          className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {status === "running" ? "Running…" : "Run now"}
        </button>
        <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
      </div>

      {result && (
        <pre className="rounded bg-muted/40 p-3 text-xs overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Admin tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manually trigger background jobs. Run context refresh first, then scanner.
        </p>
      </div>

      <div className="space-y-4">
        <JobCard
          title="1. Context refresh"
          description="Warms the Upstash earnings cache for all 100 scan-universe tickers. Takes ~2 min due to Finnhub rate limits."
          endpoint="/api/admin/context-refresh"
        />
        <JobCard
          title="2. Scanner"
          description="Scores momentum + event risk for all tickers and writes today's suggestions. Run after context refresh."
          endpoint="/api/admin/scan"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        These jobs run automatically on weekdays (context refresh 09:00 UTC, scanner 13:35 UTC). Use this page to trigger them early or re-run after market open.
      </p>
    </div>
  );
}

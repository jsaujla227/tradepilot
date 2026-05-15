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
        ? "Running… (up to ~1 min)"
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

export function AdminJobs() {
  return (
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
      <JobCard
        title="3. Agent trade"
        description="Picks top scanner results and submits paper buy orders for users with agent enabled. Runs automatically at 14:05 UTC."
        endpoint="/api/admin/agent-trade"
      />
      <JobCard
        title="4. Position monitor"
        description="Checks open positions against stop prices from trade checklists and auto-closes any that have hit their stop. Runs at 19:30 UTC."
        endpoint="/api/admin/position-monitor"
      />
    </div>
  );
}

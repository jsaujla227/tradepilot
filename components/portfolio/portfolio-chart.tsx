"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

type Snapshot = {
  snapshot_date: string;
  total_value: number;
};

export function PortfolioChart({
  snapshots,
  accountSize,
}: {
  snapshots: Snapshot[];
  accountSize: number;
}) {
  if (snapshots.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-lg border border-border bg-card/50 text-sm text-muted-foreground">
        No snapshot history yet. Snapshots are recorded daily at 23:00 UTC.
      </div>
    );
  }

  const data = snapshots.map((s) => ({
    date: s.snapshot_date,
    value: Number(s.total_value),
  }));

  const values = data.map((d) => d.value);
  const minValue = Math.min(...values, accountSize) * 0.97;
  const maxValue = Math.max(...values, accountSize) * 1.03;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Portfolio value over time
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => {
              const d = new Date(v + "T00:00:00");
              return d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
            }}
            tick={{ fontSize: 10, fill: "#71717a" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minValue, maxValue]}
            tickFormatter={(v: number) =>
              v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
            }
            tick={{ fontSize: 10, fill: "#71717a" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "6px",
              fontSize: "12px",
              color: "#e4e4e7",
            }}
            labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
            labelFormatter={(label) => {
              const str = String(label);
              const d = new Date(str + "T00:00:00");
              return d.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
            }}
            formatter={(value) => [
              new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
              }).format(Number(value)),
              "Portfolio value",
            ]}
          />
          <ReferenceLine
            y={accountSize}
            stroke="#3f3f46"
            strokeDasharray="4 4"
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#a1a1aa"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#e4e4e7", strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1.5 text-[10px] text-muted-foreground/60">
        Dashed line = initial account size ({new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(accountSize)})
      </p>
    </div>
  );
}

"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatMoney } from "@/lib/format";

type SnapshotPoint = {
  snapshot_date: string;
  total_value: number;
};

type Props = {
  snapshots: SnapshotPoint[];
  initialAccountSize: number;
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground mb-0.5">{label ? formatDate(label) : ""}</p>
      <p className="font-medium tabular-nums">{formatMoney(payload[0]!.value)}</p>
    </div>
  );
}

export function EquityCurve({ snapshots, initialAccountSize }: Props) {
  if (snapshots.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        Equity curve appears after the first two daily snapshots are recorded.
      </div>
    );
  }

  const latest = snapshots[snapshots.length - 1]!.total_value;
  const isUp = latest >= initialAccountSize;
  const strokeColor = isUp ? "#4ade80" : "#f87171";
  const fillId = isUp ? "fillGreen" : "fillRed";
  const fillColor = isUp ? "#4ade80" : "#f87171";

  const minVal = Math.min(...snapshots.map((s) => s.total_value));
  const maxVal = Math.max(...snapshots.map((s) => s.total_value));
  const padding = (maxVal - minVal) * 0.1 || 500;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={snapshots} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={fillColor} stopOpacity={0.15} />
            <stop offset="95%" stopColor={fillColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="snapshot_date"
          tickFormatter={formatDate}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          width={48}
          domain={[minVal - padding, maxVal + padding]}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="total_value"
          stroke={strokeColor}
          strokeWidth={1.5}
          fill={`url(#${fillId})`}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: strokeColor }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

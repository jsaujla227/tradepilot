"use client";

import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/format";

type Point = { snapshot_date: string; total_value: number };

function SparkTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number; payload: Point }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!;
  const d = new Date(p.payload.snapshot_date + "T00:00:00");
  return (
    <div className="rounded border border-border bg-card px-2 py-1 text-[11px] shadow">
      <span className="text-muted-foreground mr-1.5">
        {d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
      </span>
      <span className="font-medium tabular-nums">{formatMoney(p.value)}</span>
    </div>
  );
}

export function Sparkline({
  data,
  isUp,
}: {
  data: Point[];
  isUp: boolean;
}) {
  const color = isUp ? "#4ade80" : "#f87171";
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="total_value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 2, strokeWidth: 0, fill: color }}
        />
        <Tooltip content={<SparkTooltip />} />
      </LineChart>
    </ResponsiveContainer>
  );
}

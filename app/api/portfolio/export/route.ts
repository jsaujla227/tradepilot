import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// RFC 4180-ish CSV escaping: quote any cell containing comma, quote, CR, or LF.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: unknown[][]): string {
  // Lead with UTF-8 BOM so Excel reads non-ASCII characters correctly.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return new NextResponse("Supabase not configured", { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: txns, error } = await supabase
    .from("transactions")
    .select(
      "executed_at, ticker, side, qty, price, fees, source, order_id, note, created_at",
    )
    .order("executed_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return new NextResponse(`Query failed: ${error.message}`, { status: 500 });
  }

  const header = [
    "executed_at",
    "ticker",
    "side",
    "qty",
    "price",
    "fees",
    "source",
    "order_id",
    "note",
    "created_at",
  ];
  const rows: unknown[][] = [
    header,
    ...(txns ?? []).map((t) => [
      t.executed_at,
      t.ticker,
      t.side,
      t.qty,
      t.price,
      t.fees,
      t.source,
      t.order_id ?? "",
      t.note ?? "",
      t.created_at,
    ]),
  ];

  const csv = toCsv(rows);
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tradepilot-transactions-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

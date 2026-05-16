"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

export type ChartBar = {
  /** Unix milliseconds (open of the bar). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Props = {
  bars: ChartBar[];
  ticker: string;
};

// Zinc-950 cockpit palette — colours pulled from Tailwind theme tokens so the
// chart matches the rest of the app.
const PALETTE = {
  background: "rgba(0, 0, 0, 0)",
  text: "rgba(244, 244, 245, 0.6)",
  grid: "rgba(63, 63, 70, 0.25)",
  border: "rgba(82, 82, 91, 0.4)",
  up: "#22c55e",
  down: "#ef4444",
  volumeUp: "rgba(34, 197, 94, 0.45)",
  volumeDown: "rgba(239, 68, 68, 0.45)",
};

export function OhlcChart({ bars, ticker }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: PALETTE.background },
        textColor: PALETTE.text,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: PALETTE.grid },
        horzLines: { color: PALETTE.grid },
      },
      rightPriceScale: { borderColor: PALETTE.border },
      timeScale: { borderColor: PALETTE.border, timeVisible: false },
      crosshair: { mode: 1 },
      autoSize: false,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: PALETTE.up,
      downColor: PALETTE.down,
      borderUpColor: PALETTE.up,
      borderDownColor: PALETTE.down,
      wickUpColor: PALETTE.up,
      wickDownColor: PALETTE.down,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    candleSeries.setData(
      bars.map((b) => ({
        time: Math.floor(b.time / 1000) as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    volumeSeries.setData(
      bars.map((b) => ({
        time: Math.floor(b.time / 1000) as UTCTimestamp,
        value: b.volume,
        color: b.close >= b.open ? PALETTE.volumeUp : PALETTE.volumeDown,
      })),
    );

    chart.timeScale().fitContent();

    const resize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars]);

  if (bars.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-md border border-dashed border-border/50 text-xs text-muted-foreground">
        No bar data available for {ticker}. Massive.com credentials may be
        missing or the symbol is not covered.
      </div>
    );
  }

  return <div ref={containerRef} className="h-[400px] w-full" />;
}

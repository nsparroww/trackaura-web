"use client";

import { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { PricePoint } from "@/types";

/* ---------------------------------------------------------------------
   PriceChart

   Single-line price chart for a LEAF entity (a GPU board, a CPU). The
   chip band chart is a separate component (ChipPriceChart).

   2026-05-18 (time-proportional X-axis):
     - The X-axis was categorical (dataKey="date") - every observation
       evenly spaced regardless of the real time between them. With
       sparse data that LIES: one March observation and three May ones
       rendered as four evenly-spaced points, and the stepAfter line
       drew a flat plateau across the 7-week gap as if the price had
       genuinely held. A reader could not tell "price was stable for
       7 weeks" from "we have no data for 7 weeks".
     - Now the X-axis is numeric epoch-days (type="number"), so the gap
       between two observations is drawn to true scale. A long flat
       segment now visibly corresponds to a long empty stretch, and a
       dense cluster reads as dense. The line is still stepAfter (a
       price holds until the next observation), but the geometry no
       longer fabricates duration.
   --------------------------------------------------------------------- */

interface PriceChartProps {
  data: PricePoint[];
  currentPrice: number;
  minPrice: number;
  maxPrice: number;
  /** Optional MSRP reference line, already converted to the chart's
      display currency (CAD). null = no line drawn. */
  msrp?: number | null;
  /** Label for the MSRP reference line, e.g.
      "MSRP USD $1,999 (~CAD $2,759)". */
  msrpLabel?: string;
}

type Timeframe = "7d" | "30d" | "90d" | "all";

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "7d": "1W",
  "30d": "1M",
  "90d": "3M",
  "all": "All",
};

const MS_PER_DAY = 86_400_000;

/** Epoch-day integer for an ISO date/timestamp string (UTC-stable). */
function epochDay(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / MS_PER_DAY);
}

type DayPoint = { t: number; price: number; count: number };

/**
 * Aggregate raw price points into daily means, keyed by epoch-day.
 * Groups by UTC day and averages all prices for that day.
 */
function aggregateDailyMean(data: PricePoint[]): DayPoint[] {
  const byDay: Record<number, number[]> = {};
  for (const point of data) {
    const t = epochDay(point.date);
    if (Number.isNaN(t)) continue;
    if (!byDay[t]) byDay[t] = [];
    byDay[t].push(point.price);
  }
  return Object.entries(byDay)
    .map(([t, prices]) => ({
      t: Number(t),
      price: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
      count: prices.length,
    }))
    .sort((a, b) => a.t - b.t);
}

/** Filter daily points to a timeframe (by epoch-day cutoff). */
function filterByTimeframe(data: DayPoint[], timeframe: Timeframe): DayPoint[] {
  if (timeframe === "all") return data;
  const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
  const cutoff = Math.floor(Date.now() / MS_PER_DAY) - days;
  return data.filter((d) => d.t >= cutoff);
}

/** Format an epoch-day integer to a short axis label. */
function formatDay(t: number): string {
  const d = new Date(t * MS_PER_DAY);
  return d.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDayLong(t: number): string {
  const d = new Date(t * MS_PER_DAY);
  return d.toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point: DayPoint = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "0.625rem 0.875rem",
        fontSize: "0.8125rem",
      }}
    >
      <p style={{ color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
        {formatDayLong(point.t)}
      </p>
      <p className="price-tag" style={{ fontSize: "1rem" }}>
        ${point.price.toFixed(2)}
      </p>
      {point.count > 1 && (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.6875rem", marginTop: "0.25rem" }}>
          {"Avg of " + point.count + " price checks"}
        </p>
      )}
    </div>
  );
}

export default function PriceChart({ data, minPrice, maxPrice, msrp, msrpLabel }: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("all");

  // Mount gate prevents Recharts measuring dimensions during SSR
  // (width(-1) height(-1) warning + first-paint glitch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dailyData = useMemo(() => aggregateDailyMean(data), [data]);

  const filteredData = useMemo(
    () => filterByTimeframe(dailyData, timeframe),
    [dailyData, timeframe]
  );

  // Which timeframes have data (by real day-span).
  const availableTimeframes = useMemo(() => {
    if (dailyData.length === 0) return [];
    const available: Timeframe[] = [];
    const nowDay = Math.floor(Date.now() / MS_PER_DAY);
    const daySpan = nowDay - dailyData[0].t;
    available.push("all");
    if (daySpan >= 7) available.unshift("90d");
    if (daySpan >= 3) available.unshift("30d");
    if (daySpan >= 2) available.unshift("7d");
    return available;
  }, [dailyData]);

  if (!data.length) {
    return (
      <div
        style={{
          padding: "3rem",
          textAlign: "center",
          color: "var(--text-secondary)",
          fontSize: "0.875rem",
        }}
      >
        No price history available yet.
      </div>
    );
  }

  // Y domain padded; extended to include the MSRP line so it's not clipped.
  const prices = filteredData.map((d) => d.price);
  const domainLo = msrp != null ? Math.min(Math.min(...prices), msrp) : Math.min(...prices);
  const domainHi = msrp != null ? Math.max(Math.max(...prices), msrp) : Math.max(...prices);
  const yMin = Math.floor(domainLo * 0.95);
  const yMax = Math.ceil(domainHi * 1.05);

  // X domain: true epoch-day range so gaps render to scale. A single
  // point gets a +/- 1 day pad so it isn't drawn on the axis edge.
  const xLo = filteredData.length ? filteredData[0].t : 0;
  const xHi = filteredData.length ? filteredData[filteredData.length - 1].t : 0;
  const xMin = xLo === xHi ? xLo - 1 : xLo;
  const xMax = xLo === xHi ? xHi + 1 : xHi;

  const isSparse = data.length < 7;

  // Price change across the filtered window.
  const priceChange = filteredData.length >= 2
    ? filteredData[filteredData.length - 1].price - filteredData[0].price
    : 0;
  const priceChangePercent = filteredData.length >= 2 && filteredData[0].price > 0
    ? (priceChange / filteredData[0].price) * 100
    : 0;

  return (
    <div>
      {/* Timeframe toggles + price change */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {availableTimeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              style={{
                padding: "0.3rem 0.75rem",
                borderRadius: 6,
                border: "1px solid " + (timeframe === tf ? "var(--accent)" : "var(--border)"),
                background: timeframe === tf ? "var(--accent-glow)" : "transparent",
                color: timeframe === tf ? "var(--accent)" : "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.15s",
              }}
            >
              {TIMEFRAME_LABELS[tf]}
            </button>
          ))}
        </div>
        {filteredData.length >= 2 && priceChange !== 0 && (
          <span style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: priceChange < 0 ? "var(--accent)" : "var(--danger)",
          }}>
            {(priceChange < 0 ? "\u2193 " : "\u2191 ") +
              "$" + Math.abs(priceChange).toFixed(2) +
              " (" + (priceChange < 0 ? "" : "+") + priceChangePercent.toFixed(1) + "%)"}
          </span>
        )}
      </div>

      {/* Chart */}
      {mounted ? (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={filteredData} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
            <XAxis
              dataKey="t"
              type="number"
              scale="linear"
              domain={[xMin, xMax]}
              tickFormatter={formatDay}
              stroke="var(--text-secondary)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={(v: number) => `$${v}`}
              stroke="var(--text-secondary)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />
            {minPrice < maxPrice && (
              <ReferenceLine
                y={minPrice}
                stroke="var(--accent)"
                strokeDasharray="4 4"
                opacity={0.5}
                label={{
                  value: `Low: $${minPrice.toFixed(2)}`,
                  fill: "var(--accent)",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            )}
            {msrp != null && (
              <ReferenceLine
                y={msrp}
                stroke="var(--text-secondary)"
                strokeDasharray="5 4"
                opacity={0.75}
                label={{
                  value: msrpLabel ?? `MSRP $${msrp.toFixed(0)}`,
                  fill: "var(--text-secondary)",
                  fontSize: 10,
                  position: "insideBottomRight",
                }}
              />
            )}
            <Line
              type="stepAfter"
              dataKey="price"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={filteredData.length <= 30 ? { r: 3, fill: "var(--accent)", strokeWidth: 0 } : false}
              activeDot={{ r: 5, fill: "var(--accent)", stroke: "var(--bg-primary)", strokeWidth: 2 }}
              animationDuration={300}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ width: "100%", height: 320 }} />
      )}

      {/* Sparse data message */}
      {isSparse && (
        <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.5rem", fontStyle: "italic" }}>
          {"Building price history \u2014 prices are checked daily. A flat line between two far-apart points means no data in between, not a held price."}
        </p>
      )}
    </div>
  );
}

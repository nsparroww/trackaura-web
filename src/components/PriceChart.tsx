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

interface PriceChartProps {
  data: PricePoint[];
  currentPrice: number;
  minPrice: number;
  maxPrice: number;
}

type Timeframe = "7d" | "30d" | "90d" | "all";

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "7d": "1W",
  "30d": "1M",
  "90d": "3M",
  "all": "All",
};

/**
 * Aggregate raw price points into daily mean prices.
 * Groups by YYYY-MM-DD and averages all prices for that day.
 */
function aggregateDailyMean(data: PricePoint[]): { date: string; price: number; count: number }[] {
  const byDay: Record<string, number[]> = {};

  for (const point of data) {
    // Extract just the date portion (YYYY-MM-DD)
    const day = point.date.slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(point.price);
  }

  return Object.entries(byDay)
    .map(([day, prices]) => ({
      date: day,
      price: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
      count: prices.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Filter data to a specific timeframe.
 */
function filterByTimeframe(data: { date: string; price: number; count: number }[], timeframe: Timeframe) {
  if (timeframe === "all") return data;

  const now = new Date();
  const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return data.filter((d) => d.date >= cutoffStr);
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
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
        {new Date(point.date + "T00:00:00").toLocaleDateString("en-CA", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
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

export default function PriceChart({ data, currentPrice, minPrice, maxPrice }: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("all");

  // Mount gate prevents Recharts from measuring dimensions during SSR
  // (would otherwise emit `width(-1) height(-1)` warning at build time
  // and produce a first-paint glitch at runtime). Placeholder div below
  // holds the same height to prevent layout shift on hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Aggregate to daily means
  const dailyData = useMemo(() => aggregateDailyMean(data), [data]);

  // Filter by selected timeframe
  const filteredData = useMemo(
    () => filterByTimeframe(dailyData, timeframe),
    [dailyData, timeframe]
  );

  // Determine which timeframes have data
  const availableTimeframes = useMemo(() => {
    if (dailyData.length === 0) return [];
    const available: Timeframe[] = [];
    const now = new Date();
    const earliest = new Date(dailyData[0].date + "T00:00:00");
    const daySpan = Math.ceil((now.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000));

    // Always show All
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

  // Calculate Y axis domain with padding
  const prices = filteredData.map((d) => d.price);
  const yMin = Math.floor(Math.min(...prices) * 0.95);
  const yMax = Math.ceil(Math.max(...prices) * 1.05);

  const isSparse = data.length < 7;

  // Calculate price change for the selected timeframe
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
          <LineChart data={filteredData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
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
          {"Building price history \u2014 prices are checked every 4 hours. Set a price alert to get notified of drops."}
        </p>
      )}
    </div>
  );
}

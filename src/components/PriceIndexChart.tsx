"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface DataPoint {
  date: string;
  avg: number;
  median?: number;
  count: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function formatPrice(price: number): string {
  return "$" + price.toFixed(2);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        fontSize: "0.8125rem",
      }}
    >
      <p style={{ color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
        {formatDate(data.date)}
      </p>
      <p style={{ color: "var(--accent)", fontWeight: 700, fontSize: "1rem" }}>
        {formatPrice(data.avg)}
      </p>
      {data.median && (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
          {"Median: " + formatPrice(data.median)}
        </p>
      )}
      <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "0.125rem" }}>
        {data.count.toLocaleString() + " price points"}
      </p>
    </div>
  );
}

interface PriceIndexChartProps {
  data: DataPoint[];
  chartId?: string;
  color?: string;
  height?: number;
}

export default function PriceIndexChart({
  data,
  chartId = "overall",
  color = "#6c5ce7",
  height = 300,
}: PriceIndexChartProps) {
  // Unique gradient ID so multiple charts on one page don't conflict
  const gradientId = useMemo(() => "gradient-" + chartId, [chartId]);

  // Mount gate prevents Recharts from measuring dimensions during SSR
  // (would otherwise emit `width(-1) height(-1)` warning at build time
  // and produce a first-paint glitch at runtime). Parent div retains
  // the height prop so layout doesn't shift on hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!data || data.length < 2) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
        Not enough data yet — check back in a few days as price history accumulates.
      </div>
    );
  }

  const prices = data.map((d) => d.avg);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = (maxPrice - minPrice) * 0.1 || 10;

  return (
    <div style={{ width: "100%", height }}>
      {mounted ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[minPrice - padding, maxPrice + padding]}
              tickFormatter={(v: number) => "$" + v.toFixed(0)}
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="avg"
              stroke={color}
              strokeWidth={2.5}
              fill={"url(#" + gradientId + ")"}
              dot={false}
              activeDot={{ r: 5, fill: color, stroke: "#fff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}

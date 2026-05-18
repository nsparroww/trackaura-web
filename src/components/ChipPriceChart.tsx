"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { PriceBandPoint } from "@/types";

/* ---------------------------------------------------------------------
   ChipPriceChart

   Price chart for a BRANCH entity (a GPU chip). Distinct from
   <PriceChart>, which draws a single line for leaf entities.

   A chip has dozens of boards at different prices. Plotting one median
   line makes it look wildly volatile, because the median jumps with
   whichever boards were scraped that day. So this chart draws a BAND:

     - shaded area between the daily MIN and MAX board price (the real
       spread of what the chip costs across its boards)
     - a solid MEDIAN line through the band (the honest central trend,
       Bible Sec 6 - median, never min)

   MSRP marker (2026-05-18, revised):
     - The chip launched (e.g.) Jan 2025; board observations only start
       ~Mar 2026. An earlier revision extended the X-axis back to the
       launch date so an MSRP dot could sit at its true time position -
       but that compressed 70 days of real data into the right ~15% of
       the chart with 11 empty months beside it. Honest, but unreadable.
     - This revision keeps the X-axis TIGHT on the actual data, and
       shows MSRP two ways: a faint horizontal reference line at the
       MSRP value (its true price level), plus a small labelled marker
       pinned to the LEFT EDGE of the plot frame. The left-edge marker
       is a frame annotation, not a time-accurate point - it is
       explicitly labelled with the launch date so it cannot be misread
       as "MSRP on the first chart date".
   --------------------------------------------------------------------- */

interface ChipPriceChartProps {
  /** Daily price band, oldest-first. */
  band: PriceBandPoint[];
  /** MSRP already converted to the chart's display currency (CAD). */
  msrp?: number | null;
  /** Label for the MSRP reference, e.g. "MSRP USD $1,999 (~CAD $2,759)". */
  msrpLabel?: string;
  /** Chip release date (YYYY-MM-DD). Currently unused — kept on the
      interface because EntityPage passes it and a future revision may
      want it (e.g. a launch annotation). */
  releaseDate?: string | null;
}

const MS_PER_DAY = 86_400_000;

function epochDay(dateStr: string): number {
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / MS_PER_DAY);
}

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

type Row = {
  t: number;
  min: number;
  max: number;
  median: number;
  count: number;
  bandBase: number;
  bandSpan: number;
};

function ChipTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row: Row = payload[0].payload;
  if (row.min == null) return null;
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
      <p style={{ color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
        {formatDayLong(row.t)}
      </p>
      <p className="price-tag" style={{ fontSize: "1rem" }}>
        ${row.median.toFixed(2)}
        <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", fontWeight: 400 }}>
          {" median"}
        </span>
      </p>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.6875rem", marginTop: "0.25rem" }}>
        {"Range $" + row.min.toFixed(0) + " - $" + row.max.toFixed(0) +
          " across " + row.count + " board price" + (row.count === 1 ? "" : "s")}
      </p>
    </div>
  );
}

export default function ChipPriceChart({ band, msrp, msrpLabel }: ChipPriceChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rows = useMemo<Row[]>(
    () =>
      band.map((p) => ({
        t: epochDay(p.date),
        min: p.min,
        max: p.max,
        median: p.median,
        count: p.count,
        bandBase: p.min,
        bandSpan: p.max - p.min,
      })),
    [band],
  );

  if (!band.length) {
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

  /* X domain: tight on the actual data. No launch-date extension - the
     MSRP marker is a left-edge frame annotation instead. */
  const xMin = rows[0].t;
  const xMax = rows[rows.length - 1].t;

  /* Y domain: floored just below the DATA minimum, never toward $0 and
     never dragged toward $0. A price chart that starts at $0 wastes
     half its height.

     MSRP handling: if MSRP sits at or above the data floor, OR within
     ~20% below it, the Y floor is lowered to include MSRP so it draws
     as a normal in-chart horizontal reference line. Only when MSRP is
     far below the current range (an old card trading at a big multiple
     of launch price) does it stay off-chart, noted in the caption. */
  const allMin = Math.min(...rows.map((r) => r.min));
  const allMax = Math.max(...rows.map((r) => r.max));
  const dataFloor = allMin * 0.92;

  /* Pull the floor down to MSRP when MSRP is close (within 20% below
     the data minimum). Beyond that, MSRP is genuinely off-chart. */
  const msrpNear = msrp != null && msrp >= allMin * 0.80;
  const yMin = Math.floor(
    msrpNear ? Math.min(dataFloor, msrp as number) : dataFloor,
  );
  const yMax = Math.ceil(Math.max(allMax * 1.08, msrp ?? 0));
  const msrpOnChart = msrp != null && msrp >= yMin && msrp <= yMax;
  const msrpBelowChart = msrp != null && !msrpOnChart;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {mounted ? (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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
              <Tooltip content={<ChipTooltip />} />

              {/* Invisible base up to min, then the visible span to max.
                  linear, not monotone: a monotone spline draws smooth
                  curves through the points and invents motion between
                  them (a false price hump). linear connects the daily
                  aggregates with straight segments - no invented curves,
                  and less crude than stepAfter for an aggregated band
                  whose median genuinely drifts day to day. The leaf
                  PriceChart keeps stepAfter (one board's price IS a
                  discrete step); this aggregate is not. */}
              <Area
                type="linear"
                dataKey="bandBase"
                stackId="band"
                stroke="none"
                fill="none"
                isAnimationActive={false}
              />
              <Area
                type="linear"
                dataKey="bandSpan"
                stackId="band"
                stroke="none"
                fill="var(--accent)"
                fillOpacity={0.14}
                isAnimationActive={false}
              />

              {/* Median trend line through the band. */}
              <Line
                type="linear"
                dataKey="median"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: "var(--accent)", stroke: "var(--bg-primary)", strokeWidth: 2 }}
                isAnimationActive={false}
              />

              {/* MSRP horizontal reference line, labelled. Drawn when
                  MSRP falls within the Y domain (the floor is pulled
                  down to admit a near MSRP). When MSRP is far below the
                  range, the line is omitted and the footer notes it. */}
              {msrpOnChart && (
                <ReferenceLine
                  y={msrp as number}
                  stroke="var(--text-secondary)"
                  strokeDasharray="5 4"
                  opacity={0.75}
                  label={{
                    value: msrpLabel ?? `MSRP $${(msrp as number).toFixed(0)}`,
                    fill: "var(--text-secondary)",
                    fontSize: 10,
                    position: "insideBottomLeft",
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ width: "100%", height: 340 }} />
        )}
      </div>

      <p style={{ textAlign: "center", fontSize: "0.6875rem", color: "var(--text-secondary)", marginTop: "0.5rem", fontStyle: "italic" }}>
        {"Shaded band = price range across all boards \u00b7 line = median \u00b7 dashed = launch MSRP" +
          (msrpBelowChart
            ? ` (${msrpLabel ?? "MSRP"}, below the current price range)`
            : "")}
      </p>
    </div>
  );
}

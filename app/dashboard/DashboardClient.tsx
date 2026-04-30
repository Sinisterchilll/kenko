"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HUBS, WINDOWS, DAYS, aggregate, type AggResult, type DayRecord, type WindowData, type HubEntry } from "@/lib/data";

// ─── Icons ───────────────────────────────────────────────────────────────────

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect x="1" y="2" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1 5h11M4 1v2M9 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const HubIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3 3l1.5 1.5M11 3l-1.5 1.5M3 11l1.5-1.5M11 11l-1.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const Check = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2.5 6.5L5 9L9.5 3.5" stroke="#D4FF3A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ─── Metric Tiles ─────────────────────────────────────────────────────────────

interface TileData {
  label: string;
  dot: string;
  big: string;
  small: string | null;
  sub: string;
  delta: { up: boolean; text: string } | null;
}

function MetricTile({ tile }: { tile: TileData }) {
  return (
    <div style={{
      background: "var(--bg-1)", padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 6,
      border: "1px solid var(--line)", borderRadius: 14,
    }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 10,
        letterSpacing: "0.14em", textTransform: "uppercase",
        color: "var(--text-mute)", display: "inline-flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 6, background: tile.dot }} />
        {tile.label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 700,
          letterSpacing: "-0.02em", lineHeight: 1, color: "var(--text)",
        }}>
          {tile.big}
        </div>
        {tile.small && (
          <div style={{ fontSize: 13, color: "var(--text-mute)", fontWeight: 400 }}>{tile.small}</div>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-mute)" }}>{tile.sub}</div>
      {tile.delta && (
        <div style={{
          fontSize: 11, fontFamily: "var(--font-mono)",
          color: tile.delta.up ? "#7A8A82" : "var(--accent)",
        }}>
          {tile.delta.up ? "↑" : "↓"} {tile.delta.text}
        </div>
      )}
    </div>
  );
}

function MetricTiles({ totals, prevTotals, showTransit, cols }: {
  totals: AggResult["totals"];
  prevTotals: AggResult["totals"] | null;
  showTransit: boolean;
  cols: number;
}) {
  const pct = (a: number, b: number) => b ? ((a / b) * 100).toFixed(1) + "%" : "0.0%";
  const num = (n: number) => n.toLocaleString("en-IN");

  function delta(cur: number, prev: number | undefined): { up: boolean; text: string } | null {
    if (!prev) return null;
    const d = ((cur - prev) / prev) * 100;
    return { up: d >= 0, text: (d >= 0 ? "+" : "") + d.toFixed(1) + "% vs prev" };
  }

  const tiles: TileData[] = [
    {
      label: "INFLOW",
      dot: "#5C6960",
      big: num(totals.inflow),
      small: null,
      sub: "Boxes received at hubs",
      delta: delta(totals.inflow, prevTotals?.inflow),
    },
    ...(showTransit ? [{
      label: "IN TRANSIT",
      dot: "#7A8A82",
      big: pct(totals.inTransit, totals.inflow),
      small: num(totals.inTransit) + " orders",
      sub: "Currently out for delivery",
      delta: null,
    }] : []),
    {
      label: "DELIVERED",
      dot: "#fff",
      big: pct(totals.delivered, totals.inflow),
      small: num(totals.delivered) + " orders",
      sub: "Successfully delivered",
      delta: delta(totals.delivered, prevTotals?.delivered),
    },
    {
      label: "COULD NOT DELIVER",
      dot: "#D4FF3A",
      big: pct(totals.failed, totals.inflow),
      small: num(totals.failed) + " orders",
      sub: "Returned or undelivered",
      delta: delta(totals.failed, prevTotals?.failed),
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
      {tiles.map((t, i) => <MetricTile key={i} tile={t} />)}
    </div>
  );
}

// ─── Slot Chart ───────────────────────────────────────────────────────────────

interface SlotTooltip {
  slot: number;
  b: { delivered: number; inTransit: number; failed: number; total: number };
  x: number;
}

function SlotChart({ win, winData, globalMax, showTransit }: {
  win: typeof WINDOWS[number];
  winData: WindowData;
  globalMax: number;
  showTransit: boolean;
}) {
  const [tooltip, setTooltip] = useState<SlotTooltip | null>(null);

  const delRate = winData.total ? winData.delivered / winData.total : 0.9;
  const trRate = winData.total ? winData.inTransit / winData.total : 0.05;

  const buckets = winData.buckets.map((b, i) => ({
    slot: i + 1,
    total: b.count,
    delivered: Math.round(b.count * delRate),
    inTransit: Math.round(b.count * trRate),
    failed: Math.max(0, b.count - Math.round(b.count * delRate) - Math.round(b.count * trRate)),
  }));

  const max = Math.max(globalMax, 1);
  const W = 420, H = 180, pL = 28, pR = 8, pT = 10, pB = 28;
  const iW = W - pL - pR, iH = H - pT - pB;
  const barW = iW / Math.max(buckets.length, 1);
  const ticks = [0, Math.round(max / 2), max];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11,
        color: "#fff", letterSpacing: "0.14em", textTransform: "uppercase",
        marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>{win.label}</span>
        <span style={{ color: "#3A4540", fontSize: 10 }}>{win.start} – {win.end}</span>
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
          {ticks.map((v, i) => {
            const y = pT + iH - (v / max) * iH;
            return (
              <g key={i}>
                <line x1={pL} x2={W - pR} y1={y} y2={y} stroke="#1E2420" strokeDasharray={i === 0 ? "0" : "3 5"} />
                <text x={pL - 6} y={y + 3} fontSize="8" textAnchor="end" fill="#3A4540" fontFamily="var(--font-mono)">{v}</text>
              </g>
            );
          })}
          {buckets.map((b, i) => {
            const x = pL + i * barW;
            const totalH = (b.total / max) * iH;
            const delH = (b.delivered / max) * iH;
            const trH = showTransit ? (b.inTransit / max) * iH : 0;
            const failH = Math.max(0, totalH - delH - trH);
            const base = pT + iH;
            const isHov = tooltip?.slot === b.slot;
            return (
              <g key={i}
                onMouseEnter={() => setTooltip({ slot: b.slot, b, x: x + barW / 2 })}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: "default" }}
              >
                {delH > 0 && <rect x={x + 2} y={base - delH} width={barW - 4} height={delH} fill={isHov ? "#E8FF50" : "#D4FF3A"} />}
                {showTransit && trH > 0 && <rect x={x + 2} y={base - delH - trH} width={barW - 4} height={trH} fill={isHov ? "#546860" : "#3A4540"} />}
                {failH > 0 && <rect x={x + 2} y={base - delH - trH - failH} width={barW - 4} height={failH} fill={isHov ? "#FF6666" : "#FF4444"} />}
                {b.total > 0 && (
                  <rect x={x + 2} y={base - totalH} width={barW - 4} height={3}
                    fill={failH > 0 ? "#FF4444" : showTransit && trH > 0 ? "#3A4540" : "#D4FF3A"} rx="2" />
                )}
                <text x={x + barW / 2} y={pT + iH + 14} fontSize="9" textAnchor="middle"
                  fill={isHov ? "#fff" : "#3A4540"} fontFamily="var(--font-mono)">{b.slot}</text>
              </g>
            );
          })}
        </svg>
        {tooltip && (
          <div style={{
            position: "absolute",
            left: `calc(${(tooltip.x / W) * 100}% + 8px)`,
            top: 0,
            background: "#141414", border: "1px solid #2A332E",
            borderRadius: 8, padding: "10px 12px", zIndex: 10,
            pointerEvents: "none", minWidth: 140,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 1, background: "#D4FF3A", display: "inline-block" }} />
                  <span style={{ color: "#888" }}>Delivered</span>
                </span>
                <span style={{ fontWeight: 600 }}>{tooltip.b.delivered}</span>
              </div>
              {showTransit && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 1, background: "#3A4540", display: "inline-block" }} />
                    <span style={{ color: "#888" }}>In Transit</span>
                  </span>
                  <span style={{ fontWeight: 600 }}>{tooltip.b.inTransit}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 1, background: "#FF4444", display: "inline-block" }} />
                  <span style={{ color: "#888" }}>Failed</span>
                </span>
                <span style={{ fontWeight: 600, color: "#FF4444" }}>{tooltip.b.failed}</span>
              </div>
              <div style={{
                borderTop: "1px solid #1E2420", marginTop: 4, paddingTop: 6,
                display: "flex", justifyContent: "space-between", fontSize: 12,
              }}>
                <span style={{ color: "#888" }}>Total</span>
                <span style={{ fontWeight: 700 }}>{tooltip.b.total}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BucketChart({ windows, showTransit }: { windows: AggResult["windows"]; showTransit: boolean }) {
  const globalMax = Math.max(1, ...WINDOWS.flatMap(w => windows[w.id].buckets.map(b => b.count)));
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {(
          [["#D4FF3A", "Delivered"], ["#3A4540", "In Transit"], ["#FF4444", "Failed"]] as [string, string][]
        )
          .filter(([, l]) => showTransit || l !== "In Transit")
          .map(([c, l]) => (
            <span key={l} style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 11,
              fontFamily: "var(--font-mono)", color: "#5C6960",
              letterSpacing: "0.1em", textTransform: "uppercase", marginRight: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />
              {l}
            </span>
          ))}
        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", color: "#3A4540", letterSpacing: "0.08em" }}>
          Hover for breakdown
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {WINDOWS.map(w => (
          <SlotChart key={w.id} win={w} winData={windows[w.id]} globalMax={globalMax} showTransit={showTransit} />
        ))}
      </div>
    </div>
  );
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────

type TrendPoint = { date: Date; inflow: number; delivered: number; failed: number };

function TrendChart({ rangeDays, hub, hubs }: { rangeDays: DayRecord[]; hub: string; hubs: HubEntry[] }) {
  const [tooltip, setTooltip] = useState<{ i: number; p: TrendPoint } | null>(null);

  const points: TrendPoint[] = rangeDays.map(day => {
    let inflow = 0, delivered = 0, failed = 0;
    hubs.forEach(h => {
      if (hub !== "all" && hub !== h.id) return;
      if (!day.hubs[h.id]) return;
      inflow    += day.hubs[h.id].inflow;
      delivered += day.hubs[h.id].delivered;
      failed    += day.hubs[h.id].failed;
    });
    return { date: day.date, inflow, delivered, failed };
  });

  const max = Math.max(1, ...points.map(p => p.inflow));
  const W = 840, H = 200, pL = 32, pR = 12, pT = 12, pB = 36;
  const iW = W - pL - pR, iH = H - pT - pB;
  const n = points.length;
  const xFor = (i: number) => pL + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW);
  const yFor = (v: number) => pT + iH - (v / max) * iH;
  const mkLine = (key: keyof TrendPoint) =>
    points.map((p, i) => (i === 0 ? "M" : "L") + xFor(i) + " " + yFor(p[key] as number)).join(" ");
  const mkArea = (key: keyof TrendPoint) =>
    mkLine(key) + " L" + xFor(n - 1) + " " + (pT + iH) + " L" + xFor(0) + " " + (pT + iH) + " Z";

  const ticks = [0, Math.round(max / 2), max];
  const series = [
    { key: "inflow" as keyof TrendPoint, color: "#5C6960", label: "Inflow", dash: "4 4", w: 1.2 },
    { key: "delivered" as keyof TrendPoint, color: "#D4FF3A", label: "Delivered", dash: "0", w: 2 },
    { key: "failed" as keyof TrendPoint, color: "#FF4444", label: "Failed", dash: "0", w: 1.8 },
  ];
  const fmtDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  return (
    <div>
      <div style={{ display: "flex", gap: 20, marginBottom: 14, alignItems: "center" }}>
        {series.map(s => (
          <span key={s.key as string} style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 11,
            fontFamily: "var(--font-mono)", color: "#5C6960",
            letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            <span style={{ width: 16, height: 2, background: s.color, display: "inline-block" }} />
            {s.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", color: "#3A4540", letterSpacing: "0.08em" }}>
          {n} day{n !== 1 ? "s" : ""} · hover for details
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
          {ticks.map((v, i) => {
            const y = yFor(v);
            return (
              <g key={i}>
                <line x1={pL} x2={W - pR} y1={y} y2={y} stroke="#1E2420" strokeDasharray={i === 0 ? "0" : "3 5"} />
                <text x={pL - 8} y={y + 3} fontSize="9" textAnchor="end" fill="#3A4540" fontFamily="var(--font-mono)">{v}</text>
              </g>
            );
          })}
          <path d={mkArea("delivered")} fill="#D4FF3A" fillOpacity="0.05" />
          {series.map(s => (
            <path key={s.key as string} d={mkLine(s.key)} fill="none"
              stroke={s.color} strokeWidth={s.w}
              strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray={s.dash} />
          ))}
          {points.map((p, i) => {
            const isHov = tooltip?.i === i;
            return (
              <g key={i}
                onMouseEnter={() => setTooltip({ i, p })}
                onMouseLeave={() => setTooltip(null)}
              >
                <circle cx={xFor(i)} cy={yFor(p.delivered)} r={isHov ? 4 : 2.5} fill="#D4FF3A" />
                <circle cx={xFor(i)} cy={yFor(p.failed)} r={isHov ? 3.5 : 2} fill="#FF4444" />
                <circle cx={xFor(i)} cy={yFor(p.inflow)} r={isHov ? 3 : 1.5} fill="#5C6960" />
                <rect x={xFor(i) - 14} y={pT} width={28} height={iH} fill="transparent" />
                {(n <= 7 || i % Math.ceil(n / 7) === 0) && (
                  <text x={xFor(i)} y={pT + iH + 20} fontSize="9" textAnchor="middle"
                    fill={isHov ? "#fff" : "#3A4540"} fontFamily="var(--font-mono)">
                    {fmtDate(p.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {tooltip && (() => {
          const leftPct = (xFor(tooltip.i) / W) * 100;
          return (
            <div style={{
              position: "absolute", left: `calc(${leftPct}% + 10px)`, top: 0,
              background: "#141414", border: "1px solid #2A332E",
              borderRadius: 8, padding: "10px 12px", zIndex: 10,
              pointerEvents: "none", minWidth: 150,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 10, color: "#5C6960",
                letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8,
              }}>
                {fmtDate(tooltip.p.date)}
              </div>
              {series.map(s => (
                <div key={s.key as string} style={{
                  display: "flex", justifyContent: "space-between",
                  gap: 16, fontSize: 12, marginBottom: 4,
                }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 1, background: s.color, display: "inline-block" }} />
                    <span style={{ color: "#888" }}>{s.label}</span>
                  </span>
                  <span style={{
                    fontWeight: 600,
                    color: s.key === "failed" ? "#FF4444" : s.key === "delivered" ? "#D4FF3A" : "inherit",
                  }}>
                    {tooltip.p[s.key] as number}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Delivery Timing Chart ────────────────────────────────────────────────────

function DeliveryTimingChart({ windows }: { windows: AggResult["windows"] }) {
  const bandColors = ["#D4FF3A", "#7A8A82", "#3A4540"];

  const slotData = WINDOWS.map(w => {
    const wd = windows[w.id];
    const delRate = wd.total ? wd.delivered / wd.total : 0.9;
    const buckets = wd.buckets.map(b => ({
      total: b.count,
      delivered: Math.round(b.count * delRate),
    }));
    const totalOrders = buckets.reduce((a, b) => a + b.total, 0) || 1;
    const h1Del = buckets.slice(0, 2).reduce((a, b) => a + b.delivered, 0);
    const h2Del = buckets.slice(0, 4).reduce((a, b) => a + b.delivered, 0);
    const h3Del = buckets.reduce((a, b) => a + b.delivered, 0);
    return {
      win: w,
      totalOrders,
      cumulative: [
        { label: "< 1 hr", pct: (h1Del / totalOrders) * 100, count: h1Del },
        { label: "< 2 hr", pct: (h2Del / totalOrders) * 100, count: h2Del },
        { label: "< 3 hr", pct: (h3Del / totalOrders) * 100, count: h3Del },
      ],
    };
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
      {slotData.map(sd => (
        <div key={sd.win.id}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16,
          }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#fff", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              {sd.win.label}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#3A4540", letterSpacing: "0.08em" }}>
              {sd.win.start} – {sd.win.end}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ height: 10, borderRadius: 4, background: "#1E2420", overflow: "hidden", display: "flex" }}>
              <div style={{ width: sd.cumulative[0].pct + "%", background: "#D4FF3A", transition: "width 600ms" }} />
              <div style={{ width: (sd.cumulative[1].pct - sd.cumulative[0].pct) + "%", background: "#7A8A82", transition: "width 600ms" }} />
              <div style={{ width: (sd.cumulative[2].pct - sd.cumulative[1].pct) + "%", background: "#3A4540", transition: "width 600ms" }} />
            </div>
          </div>

          {sd.cumulative.map((band, bi) => (
            <div key={bi} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 0", borderBottom: "1px solid #1A1A1A",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: bandColors[bi], display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#ccc" }}>{band.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#5C6960" }}>
                  {band.count} orders
                </span>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em",
                  color: bi === 0 ? "#D4FF3A" : bi === 1 ? "#7A8A82" : "#5C6960",
                }}>
                  {band.pct.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", marginTop: 4 }}>
            <span style={{ fontSize: 12, color: "#5C6960", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Total orders
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
              {sd.totalOrders}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Dropdown ────────────────────────────────────────────────────────────────

function Dropdown({ label, icon, children, open, onToggle }: {
  label: string; icon?: React.ReactNode; children: React.ReactNode; open: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onToggle}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "8px 12px", border: "1px solid var(--line)",
          borderRadius: 8, fontSize: 13, color: open ? "var(--text)" : "#ccc",
          background: open ? "var(--bg-2)" : "var(--bg-1)",
        }}
      >
        {icon} {label} <Chevron />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30,
          minWidth: 210, padding: 4, background: "var(--bg-2)",
          border: "1px solid var(--line)", borderRadius: 8,
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function DropItem({ label, sub, active, onClick }: { label: string; sub?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "9px 12px", fontSize: 13,
        color: "var(--text)", background: active ? "rgba(255,255,255,0.05)" : "transparent",
        border: "none", borderRadius: 6, fontFamily: "inherit", textAlign: "left", cursor: "pointer",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {sub && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", width: 32 }}>{sub}</span>}
        {label}
      </span>
      {active && <Check />}
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "mtd", label: "Month to date" },
];

export default function DashboardClient({ user }: { user: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"summary" | "daily">("summary");
  const [hub, setHub] = useState("all");
  const [dateRange, setDateRange] = useState("14d");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [useRealData, setUseRealData] = useState(true);

  // ── Real data ──────────────────────────────────────────────────────────────
  const [days, setDays] = useState<DayRecord[]>(DAYS);
  const [hubs, setHubs] = useState<HubEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/orders');
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        const parsed: DayRecord[] = data.days.map((d: DayRecord & { date: string }) => ({
          ...d,
          date: new Date(d.date),
        }));
        if (parsed.length > 0) {
          setDays(parsed);
          setHubs(data.hubs);
        }
      } catch (e) {
        console.error('Failed to load order data', e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!avatarOpen) return;
    const fn = () => setAvatarOpen(false);
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [avatarOpen]);

  const rangeDays = useMemo<DayRecord[]>(() => {
    const src = useRealData && days !== DAYS ? days : DAYS;
    const now = new Date();
    if (dateRange === "today") return src.slice(-1);
    if (dateRange === "7d")    return src.slice(-7);
    if (dateRange === "mtd")   return src.filter(d => d.date.getMonth() === now.getMonth() && d.date.getFullYear() === now.getFullYear());
    return src;
  }, [dateRange, days, useRealData]);

  const prevDays = useMemo<DayRecord[]>(() => {
    const src = useRealData && days !== DAYS ? days : DAYS;
    if (dateRange === "today") return src.slice(-2, -1);
    if (dateRange === "7d")    return src.slice(-14, -7);
    return [];
  }, [dateRange, days, useRealData]);

  const activeDays = useRealData && days !== DAYS ? days : DAYS;
  const activeHubs = useRealData && hubs.length > 0 ? hubs : HUBS;

  const activeDay  = activeDays[activeDays.length - 1] ?? DAYS[DAYS.length - 1];
  const summaryAgg = useMemo(() => aggregate(rangeDays, hub, activeHubs.length ? activeHubs : undefined), [rangeDays, hub, activeHubs]);
  const prevAgg    = useMemo(() => aggregate(prevDays,  hub, activeHubs.length ? activeHubs : undefined), [prevDays,  hub, activeHubs]);
  const dailyAgg   = useMemo(() => aggregate([activeDay], hub, activeHubs.length ? activeHubs : undefined), [activeDay, hub, activeHubs]);

  const agg: AggResult = tab === "summary" ? summaryAgg : dailyAgg;
  const prev: AggResult | null = tab === "summary" && prevDays.length ? prevAgg : null;
  const activeRange = RANGES.find(r => r.id === dateRange) ?? RANGES[2];

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", display: "flex", flexDirection: "column" }}>

      {/* Topbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 64,
        borderBottom: "1px solid var(--line)",
        position: "sticky", top: 0, zIndex: 20, background: "var(--bg-1)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700,
            letterSpacing: "-0.01em", color: "#fff", lineHeight: 1, textTransform: "uppercase",
          }}>kenko</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#3A4540", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            powered by{" "}
            <span style={{ color: "#FF2D2D", animation: "bpulse 2.4s ease-in-out infinite" }}>bounce</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={() => setUseRealData(v => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "5px 10px", borderRadius: 20,
              border: `1px solid ${useRealData ? "var(--accent)" : "var(--line)"}`,
              background: useRealData ? "rgba(212,255,58,0.08)" : "var(--bg-1)",
              cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: useRealData ? "var(--accent)" : "var(--text-mute)",
              transition: "all 150ms",
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: 6,
              background: useRealData ? "var(--accent)" : "#444",
              transition: "background 150ms",
            }} />
            {useRealData ? "Live data" : "Demo data"}
          </button>

          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-mute)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: "var(--accent)", animation: "pulse 2.4s ease-in-out infinite" }} />
            {new Date().toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })} IST
          </span>
          <div style={{ position: "relative" }}>
            <div
              onClick={e => { e.stopPropagation(); setAvatarOpen(v => !v); }}
              style={{
                width: 32, height: 32, borderRadius: 32,
                background: "var(--accent)", color: "var(--accent-ink)",
                display: "grid", placeItems: "center",
                fontWeight: 700, fontFamily: "var(--font-display)", fontSize: 13,
                cursor: "pointer",
              }}
            >K</div>
            {avatarOpen && (
              <div
                onMouseDown={e => e.stopPropagation()}
                style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  background: "#141414", border: "1px solid #1E2420",
                  borderRadius: 8, padding: 4, minWidth: 160, zIndex: 40,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                }}
              >
                <div style={{
                  padding: "8px 12px", fontSize: 12, color: "#5C6960",
                  fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
                  borderBottom: "1px solid #1E2420", marginBottom: 4,
                }}>
                  {user}
                </div>
                <button onClick={handleLogout} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "9px 12px", fontSize: 13,
                  color: "#FF4444", background: "transparent", border: "none",
                  borderRadius: 6, fontFamily: "inherit", cursor: "pointer", textAlign: "left",
                }}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "0 24px", borderBottom: "1px solid var(--line)",
      }}>
        <div style={{ display: "flex" }}>
          {(["summary", "daily"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "14px 18px", fontSize: 13, fontWeight: 500,
                color: tab === t ? "var(--text)" : "var(--text-mute)",
                borderTop: "none", borderLeft: "none", borderRight: "none",
                borderBottomStyle: "solid", borderBottomWidth: 2,
                borderBottomColor: tab === t ? "var(--accent)" : "transparent",
                background: "transparent", cursor: "pointer", fontFamily: "inherit",
                transition: "color 120ms",
              }}
            >
              {t === "summary" ? "Summary" : "Today"}
            </button>
          ))}
        </div>
        <span style={{
          marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--line-2)", letterSpacing: "0.08em", padding: "14px 0",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {loading && <span style={{ width: 6, height: 6, borderRadius: 6, background: "#f0c040", display: "inline-block", animation: "pulse 1s ease-in-out infinite" }} />}
          {loading ? "Loading..." : "Refreshes every 60s"}
        </span>
      </div>

      {/* Filters */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 24px", borderBottom: "1px solid var(--line)" }}
        onClick={() => { setHubOpen(false); setRangeOpen(false); }}
      >
        <div onClick={e => e.stopPropagation()}>
          <Dropdown
            label={hub === "all" ? `All ${activeHubs.length || "—"} hubs` : (activeHubs.find(h => h.id === hub)?.name ?? "Hub")}
            icon={<HubIcon />}
            open={hubOpen}
            onToggle={() => { setHubOpen(v => !v); setRangeOpen(false); }}
          >
            <DropItem label={`All ${activeHubs.length || "—"} hubs`} sub="—" active={hub === "all"} onClick={() => { setHub("all"); setHubOpen(false); }} />
            {activeHubs.map(h => (
              <DropItem key={h.id} label={h.name} sub={h.code} active={hub === h.id} onClick={() => { setHub(h.id); setHubOpen(false); }} />
            ))}
          </Dropdown>
        </div>

        {tab === "summary" && (
          <div onClick={e => e.stopPropagation()}>
            <Dropdown
              label={activeRange.label}
              icon={<CalIcon />}
              open={rangeOpen}
              onToggle={() => { setRangeOpen(v => !v); setHubOpen(false); }}
            >
              {RANGES.map(r => (
                <DropItem key={r.id} label={r.label} active={dateRange === r.id} onClick={() => { setDateRange(r.id); setRangeOpen(false); }} />
              ))}
            </Dropdown>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-mute)", letterSpacing: "0.08em" }}>
          Auto-refresh <span style={{ color: "var(--accent)" }}>●</span> ON
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px 40px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Metric Tiles */}
        <MetricTiles
          totals={agg.totals}
          prevTotals={prev?.totals ?? null}
          showTransit={tab === "daily"}
          cols={tab === "daily" ? 4 : 3}
        />

        {/* Bucket Chart */}
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 14, padding: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
              Orders — 30-minute slots
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>
              Slot 1 · Slot 2
            </div>
          </div>
          <BucketChart windows={agg.windows} showTransit={tab === "daily"} />
        </div>

        {/* Trend (Summary) / Delivery Timing (Today) */}
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 14, padding: 20 }}>
          {tab === "summary" ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Daily trend</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>
                  Inflow · Delivered · Failed
                </div>
              </div>
              <TrendChart rangeDays={rangeDays} hub={hub} hubs={activeHubs} />
            </>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Delivery timing</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>
                  Cumulative % delivered within each hour of slot
                </div>
              </div>
              <DeliveryTimingChart windows={agg.windows} />
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontFamily: "var(--font-mono)", fontSize: 10, color: "#333",
          letterSpacing: "0.1em", textTransform: "uppercase",
          borderTop: "1px solid var(--line)", paddingTop: 16,
        }}>
          <span style={{ whiteSpace: "nowrap" }}>Bounce × Kenko · Hub Ops</span>
          <span style={{ whiteSpace: "nowrap" }}>Signed in as {user}</span>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes bpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

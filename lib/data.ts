export type HubEntry = { id: string; name: string; code: string; capacity?: number };

export const HUBS: HubEntry[] = [
  { id: "kor", name: "Koramangala", code: "KOR", capacity: 35 },
  { id: "ind", name: "Indiranagar", code: "IND", capacity: 28 },
  { id: "hsr", name: "HSR Layout", code: "HSR", capacity: 22 },
  { id: "whf", name: "Whitefield", code: "WHF", capacity: 18 },
  { id: "jpn", name: "Jayanagar", code: "JPN", capacity: 20 },
];

export const WINDOWS = [
  { id: "slot1", label: "Slot 1", start: "07:00", end: "10:00" },
  { id: "slot2", label: "Slot 2", start: "12:00", end: "15:00" },
] as const;

export type HubId = (typeof HUBS)[number]["id"];
export type WindowId = (typeof WINDOWS)[number]["id"];

export interface BucketData {
  time: string;
  count: number;
}

export interface WindowData {
  buckets: BucketData[];
  total: number;
  delivered: number;
  failed: number;
  inTransit: number;
}

export interface HubDayData {
  windows: Record<string, WindowData>;
  inflow: number;
  delivered: number;
  failed: number;
  inTransit: number;
}

export interface DayRecord {
  date: Date;
  hubs: Record<string, HubDayData>;
  totals: { inflow: number; inTransit: number; delivered: number; failed: number };
}

function bucketsFor(win: { start: string; end: string }): string[] {
  const out: string[] = [];
  const [sh, sm] = win.start.split(":").map(Number);
  const [eh, em] = win.end.split(":").map(Number);
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  while (cur < end) {
    const h = Math.floor(cur / 60);
    const m = cur % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    cur += 30;
  }
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function daysBack(n: number): Date[] {
  const arr: Date[] = [];
  const today = new Date("2026-04-24T00:00:00+05:30");
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    arr.push(d);
  }
  return arr;
}

function genDay(date: Date, seedBase: number): DayRecord {
  const dayRecord: DayRecord = {
    date,
    hubs: {},
    totals: { inflow: 0, inTransit: 0, delivered: 0, failed: 0 },
  };
  const gTot = { inflow: 0, inTransit: 0, delivered: 0, failed: 0 };

  HUBS.forEach((hub, hi) => {
    const rh = rng(seedBase + hi * 97 + 13);
    const base = (hub.capacity ?? 25) + Math.round(rh() * 6 - 3);
    const windows: Record<string, WindowData> = {};

    WINDOWS.forEach((w, wi) => {
      const share = wi === 1 ? 0.58 : 0.42;
      const target = Math.max(2, Math.round(base * share));
      const times = bucketsFor(w);
      const buckets: BucketData[] = times.map((t, bi) => {
        const noise = rh() * 0.7 + 0.3;
        const peak = Math.exp(-Math.pow((bi - (times.length / 2 - 0.5)) / 1.8, 2));
        return { time: t, count: Math.max(0, Math.round(target * peak * noise * 0.6)) };
      });
      const sum = buckets.reduce((a, b) => a + b.count, 0) || 1;
      const scale = target / sum;
      buckets.forEach((b) => (b.count = Math.round(b.count * scale)));

      const total = buckets.reduce((a, b) => a + b.count, 0);
      const delRate = 0.88 + rh() * 0.08;
      const delivered = Math.round(total * delRate);
      const failed = Math.round(total * (0.02 + rh() * 0.04));
      const inTransit = Math.max(0, total - delivered - failed);

      windows[w.id] = { buckets, total, delivered, failed, inTransit };
    });

    const inflow = WINDOWS.reduce((a, w) => a + windows[w.id].total, 0);
    const delivered = WINDOWS.reduce((a, w) => a + windows[w.id].delivered, 0);
    const failed = WINDOWS.reduce((a, w) => a + windows[w.id].failed, 0);
    const inTransit = WINDOWS.reduce((a, w) => a + windows[w.id].inTransit, 0);

    dayRecord.hubs[hub.id] = { windows, inflow, delivered, failed, inTransit };
    gTot.inflow += inflow;
    gTot.delivered += delivered;
    gTot.failed += failed;
    gTot.inTransit += inTransit;
  });

  dayRecord.totals = gTot;
  return dayRecord;
}

export const DAYS: DayRecord[] = daysBack(14).map((d, i) => genDay(d, 9000 + i));

export function bucketsForWindow(win: { start: string; end: string }): string[] {
  return bucketsFor(win);
}

export interface AggResult {
  totals: { inflow: number; inTransit: number; delivered: number; failed: number };
  hubsData: Record<string, { inflow: number; inTransit: number; delivered: number; failed: number }>;
  windows: Record<string, WindowData>;
}

export function aggregate(days: DayRecord[], hubFilter: string, hubs: HubEntry[] = HUBS): AggResult {
  const zero = () => ({ inflow: 0, inTransit: 0, delivered: 0, failed: 0 });
  const totals = zero();
  const hubsData: Record<string, ReturnType<typeof zero>> = {};
  hubs.forEach((h) => (hubsData[h.id] = zero()));

  const windows: Record<string, WindowData> = {};
  WINDOWS.forEach((w) => {
    windows[w.id] = {
      buckets: bucketsFor(w).map((t) => ({ time: t, count: 0 })),
      total: 0,
      delivered: 0,
      failed: 0,
      inTransit: 0,
    };
  });

  days.forEach((day) => {
    Object.entries(day.hubs).forEach(([hubId, h]) => {
      if (hubFilter !== "all" && hubFilter !== hubId) return;
      if (!hubsData[hubId]) hubsData[hubId] = zero();
      (["inflow", "inTransit", "delivered", "failed"] as const).forEach((k) => {
        totals[k] += h[k];
        hubsData[hubId][k] += h[k];
      });
      WINDOWS.forEach((w) => {
        const wd = h.windows[w.id];
        windows[w.id].total += wd.total;
        windows[w.id].delivered += wd.delivered;
        windows[w.id].failed += wd.failed;
        windows[w.id].inTransit += wd.inTransit;
        wd.buckets.forEach((b, bi) => {
          windows[w.id].buckets[bi].count += b.count;
        });
      });
    });
  });

  return { totals, hubsData, windows };
}

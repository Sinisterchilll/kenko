import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WINDOWS } from '@/lib/data';
import type { DayRecord, HubDayData, WindowData, HubEntry } from '@/lib/data';

function bucketsFor(win: { start: string; end: string }): string[] {
  const out: string[] = [];
  const [sh, sm] = win.start.split(':').map(Number);
  const [eh, em] = win.end.split(':').map(Number);
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  while (cur < end) {
    out.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
    cur += 30;
  }
  return out;
}

type Row = {
  day: Date;
  hub: string;
  event_type: string;
  bucket_time: string;
  cnt: number;
};

export async function GET() {
  try {
    const pool = getPool();

    const { rows } = await pool.query<Row>(`
      SELECT
        DATE(event_timestamp AT TIME ZONE 'Asia/Kolkata')                                        AS day,
        COALESCE(NULLIF(TRIM(hub_name), ''), NULLIF(TRIM(hub_id), ''), 'Unknown')               AS hub,
        event_type,
        TO_CHAR(DATE_TRUNC('30 minutes', event_timestamp AT TIME ZONE 'Asia/Kolkata'), 'HH24:MI') AS bucket_time,
        COUNT(*)::int                                                                              AS cnt
      FROM order_events
      WHERE event_timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3, 4
    `);

    // ── Build lookup: day → hub → event_type → bucket_time → count ──────────
    const hubSet = new Set<string>();
    type BucketMap = Map<string, number>;
    type EventMap = Map<string, BucketMap>;
    type HubMap   = Map<string, EventMap>;
    type DayMap   = Map<string, HubMap>;

    const dayMap: DayMap = new Map();

    for (const row of rows) {
      const day = row.day.toISOString().slice(0, 10);
      const hub = row.hub;
      hubSet.add(hub);

      if (!dayMap.has(day))         dayMap.set(day, new Map());
      const hm = dayMap.get(day)!;
      if (!hm.has(hub))             hm.set(hub, new Map());
      const em = hm.get(hub)!;
      if (!em.has(row.event_type))  em.set(row.event_type, new Map());
      const bm = em.get(row.event_type)!;
      bm.set(row.bucket_time, (bm.get(row.bucket_time) ?? 0) + row.cnt);
    }

    // ── Derive hub list from data ────────────────────────────────────────────
    const hubs: HubEntry[] = Array.from(hubSet).sort().map(name => ({
      id:   name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      name,
      code: name.slice(0, 3).toUpperCase(),
    }));

    const hubIdByName = new Map(hubs.map(h => [h.name, h.id]));

    // ── Build DayRecord[] ────────────────────────────────────────────────────
    const days: DayRecord[] = [];

    for (const [dayStr, hubMap] of Array.from(dayMap.entries()).sort()) {
      const totals = { inflow: 0, inTransit: 0, delivered: 0, failed: 0 };
      const hubsRecord: Record<string, HubDayData> = {};

      for (const hub of hubs) {
        const evMap = hubMap.get(hub.name) ?? new Map<string, BucketMap>();
        const windows: Record<string, WindowData> = {};

        for (const win of WINDOWS) {
          const bucketTimes = bucketsFor(win);
          const createdMap  = evMap.get('ORDER_CREATED')    ?? new Map<string, number>();
          const deliveredMap= evMap.get('DELIVERED')        ?? new Map<string, number>();
          const ofdMap      = evMap.get('OUT_FOR_DELIVERY') ?? new Map<string, number>();

          const buckets = bucketTimes.map(t => ({ time: t, count: createdMap.get(t) ?? 0 }));
          const total     = buckets.reduce((a, b) => a + b.count, 0);

          // delivered / inTransit within this window's time range
          let delivered = 0, inTransit = 0;
          for (const t of bucketTimes) {
            delivered  += deliveredMap.get(t) ?? 0;
            inTransit  += ofdMap.get(t) ?? 0;
          }
          const failed = Math.max(0, total - delivered - inTransit);

          windows[win.id] = { buckets, total, delivered, failed, inTransit };
        }

        const inflow    = WINDOWS.reduce((a, w) => a + windows[w.id].total,     0);
        const delivered = WINDOWS.reduce((a, w) => a + windows[w.id].delivered, 0);
        const failed    = WINDOWS.reduce((a, w) => a + windows[w.id].failed,    0);
        const inTransit = WINDOWS.reduce((a, w) => a + windows[w.id].inTransit, 0);

        hubsRecord[hub.id] = { windows, inflow, delivered, failed, inTransit };
        totals.inflow    += inflow;
        totals.delivered += delivered;
        totals.failed    += failed;
        totals.inTransit += inTransit;
      }

      days.push({
        date: new Date(dayStr + 'T00:00:00+05:30'),
        hubs: hubsRecord,
        totals,
      });
    }

    return NextResponse.json({ days, hubs });
  } catch (err) {
    console.error('/api/orders error:', err);
    return NextResponse.json({ error: 'Failed to fetch order data' }, { status: 500 });
  }
}

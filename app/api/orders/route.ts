import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WINDOWS } from '@/lib/data';
import type { DayRecord, HubDayData, WindowData, HubEntry } from '@/lib/data';

// Only show orders for this hub
const KENKO_HUB_NAME = 'Kenko HSR | Kenko HSR';
const KENKO_HUB: HubEntry = { id: 'hsr', name: 'HSR Layout', code: 'HSR', dbName: KENKO_HUB_NAME };

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
  event_type: string;
  bucket_time: string;
  cnt: number;
};

export async function GET() {
  try {
    const pool = getPool();

    // Query only Kenko HSR orders for the last 30 days.
    // OUT_FOR_DELIVERY = inflow (box dispatched from hub)
    // DELIVERED        = delivered
    // in-transit       = out_for_delivery - delivered (derived in JS)
    const { rows } = await pool.query<Row>(`
      SELECT
        (event_timestamp + INTERVAL '5 hours 30 minutes')::date AS day,
        event_type,
        TO_CHAR(
          DATE_TRUNC('hour', event_timestamp + INTERVAL '5 hours 30 minutes') +
          FLOOR(EXTRACT(MINUTE FROM event_timestamp + INTERVAL '5 hours 30 minutes') / 30)::int
            * INTERVAL '30 minutes',
          'HH24:MI'
        ) AS bucket_time,
        COUNT(*)::int AS cnt
      FROM order_events
      WHERE hub_name = $1
        AND event_timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `, [KENKO_HUB_NAME]);

    // ── Build lookup: day → event_type → bucket_time → count ─────────────────
    type BucketMap = Map<string, number>;
    type EventMap  = Map<string, BucketMap>;
    type DayMap    = Map<string, EventMap>;

    const dayMap: DayMap = new Map();

    for (const row of rows) {
      const day = row.day.toISOString().slice(0, 10);
      if (!dayMap.has(day))            dayMap.set(day, new Map());
      const em = dayMap.get(day)!;
      if (!em.has(row.event_type))     em.set(row.event_type, new Map());
      const bm = em.get(row.event_type)!;
      bm.set(row.bucket_time, (bm.get(row.bucket_time) ?? 0) + row.cnt);
    }

    // ── Build DayRecord[] ─────────────────────────────────────────────────────
    const days: DayRecord[] = [];

    for (const [dayStr, evMap] of Array.from(dayMap.entries()).sort()) {
      const ofdMap  = evMap.get('OUT_FOR_DELIVERY') ?? new Map<string, number>();
      const delMap  = evMap.get('DELIVERED')        ?? new Map<string, number>();

      const windows: Record<string, WindowData> = {};

      for (const win of WINDOWS) {
        const bucketTimes = bucketsFor(win);
        const buckets = bucketTimes.map(t => ({
          time: t,
          count: ofdMap.get(t) ?? 0,  // inflow per bucket = OFD events
        }));
        const total     = buckets.reduce((a, b) => a + b.count, 0);
        let delivered = 0, inTransit = 0;
        for (const t of bucketTimes) {
          delivered  += delMap.get(t) ?? 0;
          inTransit  += ofdMap.get(t) ?? 0;
        }
        inTransit = Math.max(0, inTransit - delivered);
        const failed = 0; // no failed event type yet

        windows[win.id] = { buckets, total, delivered, inTransit, failed };
      }

      // Day-level totals for this hub
      const sumMap = (m: Map<string, number>) =>
        Array.from(m.values()).reduce((a, b) => a + b, 0);

      const inflow    = sumMap(ofdMap);
      const delivered = sumMap(delMap);
      const inTransit = Math.max(0, inflow - delivered);
      const failed    = 0;

      const hubsRecord: Record<string, HubDayData> = {
        [KENKO_HUB.id]: { windows, inflow, delivered, inTransit, failed },
      };

      const totals = { inflow, delivered, inTransit, failed };

      days.push({
        date: new Date(dayStr + 'T00:00:00+05:30'),
        hubs: hubsRecord,
        totals,
      });
    }

    return NextResponse.json({ days, hubs: [KENKO_HUB] });
  } catch (err) {
    console.error('/api/orders error:', err);
    return NextResponse.json({ error: 'Failed to fetch order data' }, { status: 500 });
  }
}

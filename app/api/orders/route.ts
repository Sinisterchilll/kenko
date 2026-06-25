import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WINDOWS } from '@/lib/data';
import type { DayRecord, HubDayData, WindowData, HubEntry } from '@/lib/data';

const KENKO_HUB_NAME = 'Kenko HSR%'; // matches both 'Kenko HSR' and 'Kenko HSR | Kenko HSR'
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
  bucket_time: string | null;
  cnt: number;
};

export async function GET() {
  try {
    const pool = getPool();

    // Inflow   = ORDER_CREATED events per day (no bucket — day-level total only).
    //
    // Chart bars = OUT_FOR_DELIVERY events bucketed into 30-min slots.
    //              These happen ~4:26 PM IST, inside the 16:00–19:00 window.
    //
    // In Transit = distinct orders whose LATEST event is OUT_FOR_DELIVERY.
    //
    // Delivered  = distinct orders whose LATEST event is DELIVERED.

    const { rows } = await pool.query<Row>(`
      WITH base AS (
        SELECT
          order_id,
          event_type,
          event_timestamp,
          (event_timestamp + INTERVAL '5 hours 30 minutes')::date AS day_ist,
          TO_CHAR(
            DATE_TRUNC('hour', event_timestamp + INTERVAL '5 hours 30 minutes') +
            FLOOR(EXTRACT(MINUTE FROM event_timestamp + INTERVAL '5 hours 30 minutes') / 30)::int
              * INTERVAL '30 minutes',
            'HH24:MI'
          ) AS bucket_ist,
          ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY event_timestamp DESC) AS rn
        FROM order_events
        WHERE hub_name LIKE $1
          AND order_id ~ '^Bounce_.*[0-9]{8}$'
          AND event_timestamp >= NOW() - INTERVAL '30 days'
      ),
      latest AS (
        SELECT order_id, event_type, day_ist
        FROM base WHERE rn = 1 AND event_type IN ('OUT_FOR_DELIVERY', 'DELIVERED')
      )

      -- Part 1: ORDER_CREATED distinct orders per day (inflow, no bucket)
      -- Use COUNT(DISTINCT order_id) because the source system sends duplicate ORDER_CREATED events
      SELECT day_ist AS day, 'ORDER_CREATED' AS event_type, NULL::text AS bucket_time, COUNT(DISTINCT order_id)::int AS cnt
      FROM base WHERE event_type = 'ORDER_CREATED'
      GROUP BY 1, 2

      UNION ALL

      -- Part 2: OUT_FOR_DELIVERY bucketed (chart bars, has bucket_time)
      SELECT day_ist AS day, 'OUT_FOR_DELIVERY' AS event_type, bucket_ist AS bucket_time, COUNT(*)::int AS cnt
      FROM base WHERE event_type = 'OUT_FOR_DELIVERY'
      GROUP BY 1, 2, 3

      UNION ALL

      -- Part 3: latest status per order (in-transit / delivered counts, no bucket)
      SELECT day_ist AS day, event_type, NULL::text AS bucket_time, COUNT(*)::int AS cnt
      FROM latest
      GROUP BY 1, 2

      ORDER BY 1, 2, 3
    `, [KENKO_HUB_NAME]);

    // ── Split rows by type ─────────────────────────────────────────────────────
    const inflowMap     = new Map<string, number>();              // ORDER_CREATED day total
    const ofdBucketMap  = new Map<string, Map<string, number>>(); // OFD bucketed for chart
    const inTransitMap  = new Map<string, number>();              // latest status OFD
    const deliveredMap  = new Map<string, number>();              // latest status DELIVERED

    for (const row of rows) {
      const day = row.day.toISOString().slice(0, 10);

      if (row.event_type === 'ORDER_CREATED') {
        // Part 1: inflow total
        inflowMap.set(day, (inflowMap.get(day) ?? 0) + row.cnt);
      } else if (row.event_type === 'OUT_FOR_DELIVERY' && row.bucket_time !== null) {
        // Part 2: OFD bucketed for chart bars
        if (!ofdBucketMap.has(day)) ofdBucketMap.set(day, new Map());
        const bm = ofdBucketMap.get(day)!;
        bm.set(row.bucket_time, (bm.get(row.bucket_time) ?? 0) + row.cnt);
      } else if (row.event_type === 'OUT_FOR_DELIVERY' && row.bucket_time === null) {
        // Part 3: in-transit count from latest status
        inTransitMap.set(day, (inTransitMap.get(day) ?? 0) + row.cnt);
      } else if (row.event_type === 'DELIVERED' && row.bucket_time === null) {
        // Part 3: delivered count from latest status
        deliveredMap.set(day, (deliveredMap.get(day) ?? 0) + row.cnt);
      }
    }

    // ── Build DayRecord[] ─────────────────────────────────────────────────────
    const allDays = new Set([
      ...inflowMap.keys(),
      ...ofdBucketMap.keys(),
      ...inTransitMap.keys(),
      ...deliveredMap.keys(),
    ]);
    const days: DayRecord[] = [];

    for (const dayStr of Array.from(allDays).sort()) {
      const ofdMap    = ofdBucketMap.get(dayStr) ?? new Map<string, number>();
      const inflow    = inflowMap.get(dayStr)    ?? 0;
      const inTransit = inTransitMap.get(dayStr) ?? 0;
      const delivered = deliveredMap.get(dayStr) ?? 0;
      const failed    = 0;

      const windows: Record<string, WindowData> = {};

      for (const win of WINDOWS) {
        const bucketTimes = bucketsFor(win);
        const buckets = bucketTimes.map(t => ({
          time: t,
          count: ofdMap.get(t) ?? 0,  // chart bars = OUT_FOR_DELIVERY per 30-min bucket
        }));
        const winTotal = buckets.reduce((a, b) => a + b.count, 0);
        windows[win.id] = { buckets, total: winTotal, delivered, inTransit, failed };
      }

      const hubsRecord: Record<string, HubDayData> = {
        [KENKO_HUB.id]: { windows, inflow, delivered, inTransit, failed },
      };

      days.push({
        date: new Date(dayStr + 'T00:00:00+05:30'),
        hubs: hubsRecord,
        totals: { inflow, delivered, inTransit, failed },
      });
    }

    return NextResponse.json({ days, hubs: [KENKO_HUB] });
  } catch (err) {
    console.error('/api/orders error:', err);
    return NextResponse.json({ error: 'Failed to fetch order data' }, { status: 500 });
  }
}

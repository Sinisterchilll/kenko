import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WINDOWS } from '@/lib/data';
import type { DayRecord, HubDayData, WindowData, HubEntry } from '@/lib/data';

// TODO: Update TGF_HUB_NAME once the hub name is confirmed
const TGF_HUB_NAME = 'TGF%';
const TGF_HUB: HubEntry = { id: 'tgf', name: 'The Gift Studio', code: 'TGF', dbName: TGF_HUB_NAME };

// TODO: Update TGF_ORDER_PATTERN once the order ID pattern is confirmed
// const TGF_ORDER_PATTERN = '^TGF_.*[0-9]{8}$';

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
          AND event_timestamp >= NOW() - INTERVAL '30 days'
      ),
      latest AS (
        SELECT order_id, event_type, day_ist
        FROM base WHERE rn = 1 AND event_type IN ('OUT_FOR_DELIVERY', 'DELIVERED')
      )

      SELECT day_ist AS day, 'ORDER_CREATED' AS event_type, NULL::text AS bucket_time, COUNT(DISTINCT order_id)::int AS cnt
      FROM base WHERE event_type = 'ORDER_CREATED'
      GROUP BY 1, 2

      UNION ALL

      SELECT day_ist AS day, 'OUT_FOR_DELIVERY' AS event_type, bucket_ist AS bucket_time, COUNT(*)::int AS cnt
      FROM base WHERE event_type = 'OUT_FOR_DELIVERY'
      GROUP BY 1, 2, 3

      UNION ALL

      SELECT day_ist AS day, event_type, NULL::text AS bucket_time, COUNT(*)::int AS cnt
      FROM latest
      GROUP BY 1, 2

      ORDER BY 1, 2, 3
    `, [TGF_HUB_NAME]);

    const inflowMap     = new Map<string, number>();
    const ofdBucketMap  = new Map<string, Map<string, number>>();
    const inTransitMap  = new Map<string, number>();
    const deliveredMap  = new Map<string, number>();

    for (const row of rows) {
      const day = row.day.toISOString().slice(0, 10);
      if (row.event_type === 'ORDER_CREATED') {
        inflowMap.set(day, (inflowMap.get(day) ?? 0) + row.cnt);
      } else if (row.event_type === 'OUT_FOR_DELIVERY' && row.bucket_time !== null) {
        if (!ofdBucketMap.has(day)) ofdBucketMap.set(day, new Map());
        const bm = ofdBucketMap.get(day)!;
        bm.set(row.bucket_time, (bm.get(row.bucket_time) ?? 0) + row.cnt);
      } else if (row.event_type === 'OUT_FOR_DELIVERY' && row.bucket_time === null) {
        inTransitMap.set(day, (inTransitMap.get(day) ?? 0) + row.cnt);
      } else if (row.event_type === 'DELIVERED' && row.bucket_time === null) {
        deliveredMap.set(day, (deliveredMap.get(day) ?? 0) + row.cnt);
      }
    }

    const allDays = new Set([...inflowMap.keys(), ...ofdBucketMap.keys(), ...inTransitMap.keys(), ...deliveredMap.keys()]);
    const days: DayRecord[] = [];

    for (const dayStr of Array.from(allDays).sort()) {
      const ofdMap    = ofdBucketMap.get(dayStr) ?? new Map<string, number>();
      const inflow    = inflowMap.get(dayStr)    ?? 0;
      const inTransit = inTransitMap.get(dayStr) ?? 0;
      const delivered = deliveredMap.get(dayStr) ?? 0;

      const windows: Record<string, WindowData> = {};
      for (const win of WINDOWS) {
        const buckets = bucketsFor(win).map(t => ({ time: t, count: ofdMap.get(t) ?? 0 }));
        const winTotal = buckets.reduce((a, b) => a + b.count, 0);
        windows[win.id] = { buckets, total: winTotal, delivered, inTransit, failed: 0 };
      }

      const hubsRecord: Record<string, HubDayData> = {
        [TGF_HUB.id]: { windows, inflow, delivered, inTransit, failed: 0 },
      };

      days.push({
        date: new Date(dayStr + 'T00:00:00+05:30'),
        hubs: hubsRecord,
        totals: { inflow, delivered, inTransit, failed: 0 },
      });
    }

    return NextResponse.json({ days, hubs: [TGF_HUB] });
  } catch (err) {
    console.error('/api/tgs/orders error:', err);
    return NextResponse.json({ error: 'Failed to fetch order data' }, { status: 500 });
  }
}

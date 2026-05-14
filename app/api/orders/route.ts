import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WINDOWS } from '@/lib/data';
import type { DayRecord, HubDayData, WindowData, HubEntry } from '@/lib/data';

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
  bucket_time: string | null;  // null = status-count row; non-null = ORDER_CREATED bucket row
  cnt: number;
};

export async function GET() {
  try {
    const pool = getPool();

    // Two parts combined:
    //
    // Part 1 – ORDER_CREATED events bucketed into 30-min slots (inflow + chart bars).
    //
    // Part 2 – For every order take the LATEST event in the window.
    //           event_type = OUT_FOR_DELIVERY → order is currently in transit
    //           event_type = DELIVERED        → order has been delivered
    //           bucket_time is NULL so JS can tell them apart from Part 1 rows.
    //
    // This means:
    //   • Inflow   = sum of ORDER_CREATED events (fixed, never moves)
    //   • In Transit = orders whose latest event is OUT_FOR_DELIVERY
    //   • Delivered  = orders whose latest event is DELIVERED
    //   When a delivered event fires, that order leaves In Transit and enters Delivered.

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
        WHERE hub_name = $1
          AND event_timestamp >= NOW() - INTERVAL '30 days'
      ),
      -- Part 2: latest event per order
      latest AS (
        SELECT order_id, event_type, event_timestamp, day_ist
        FROM base
        WHERE rn = 1
          AND event_type IN ('OUT_FOR_DELIVERY', 'DELIVERED')
      )

      -- Part 1: ORDER_CREATED bucketed (inflow chart)
      SELECT day_ist AS day, event_type, bucket_ist AS bucket_time, COUNT(*)::int AS cnt
      FROM base
      WHERE event_type = 'ORDER_CREATED'
      GROUP BY 1, 2, 3

      UNION ALL

      -- Part 2: current status counts per day (null bucket_time = status row)
      SELECT day_ist AS day, event_type, NULL::text AS bucket_time, COUNT(*)::int AS cnt
      FROM latest
      GROUP BY 1, 2

      ORDER BY 1, 2, 3
    `, [KENKO_HUB_NAME]);

    // ── Separate bucket rows (ORDER_CREATED) from status rows ─────────────────
    const dayCreatedBuckets = new Map<string, Map<string, number>>();
    const dayStatus         = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const day = row.day.toISOString().slice(0, 10);

      if (row.bucket_time !== null) {
        // ORDER_CREATED bucket row
        if (!dayCreatedBuckets.has(day)) dayCreatedBuckets.set(day, new Map());
        const bm = dayCreatedBuckets.get(day)!;
        bm.set(row.bucket_time, (bm.get(row.bucket_time) ?? 0) + row.cnt);
      } else {
        // Latest-event status row
        if (!dayStatus.has(day)) dayStatus.set(day, new Map());
        const sm = dayStatus.get(day)!;
        sm.set(row.event_type, (sm.get(row.event_type) ?? 0) + row.cnt);
      }
    }

    // ── Build DayRecord[] ─────────────────────────────────────────────────────
    const allDays = new Set([...dayCreatedBuckets.keys(), ...dayStatus.keys()]);
    const days: DayRecord[] = [];

    for (const dayStr of Array.from(allDays).sort()) {
      const createdMap = dayCreatedBuckets.get(dayStr) ?? new Map<string, number>();
      const statusMap  = dayStatus.get(dayStr)         ?? new Map<string, number>();

      // Day-level metrics
      const inflow    = Array.from(createdMap.values()).reduce((a, b) => a + b, 0);
      const inTransit = statusMap.get('OUT_FOR_DELIVERY') ?? 0;
      const delivered = statusMap.get('DELIVERED')        ?? 0;
      const failed    = 0; // no failure event type yet

      const windows: Record<string, WindowData> = {};

      for (const win of WINDOWS) {
        const bucketTimes = bucketsFor(win);
        const buckets = bucketTimes.map(t => ({
          time: t,
          count: createdMap.get(t) ?? 0,  // chart bars = ORDER_CREATED per 30-min bucket
        }));
        const winTotal = buckets.reduce((a, b) => a + b.count, 0);

        // Delivered / inTransit for the window = day totals
        // (only 1 slot so this equals the day total)
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

import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WINDOWS } from '@/lib/data';
import type { DayRecord, HubDayData, WindowData, HubEntry } from '@/lib/data';

const TGF_HUB_PATTERN = 'Bounce-TGF%';

function slugify(hubName: string): string {
  // "Bounce-TGF-Sakinaka" → "sakinaka"
  return hubName.replace(/^Bounce-TGF-/i, '').toLowerCase().replace(/\s+/g, '-');
}

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
  hub_name: string;
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
          hub_name,
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
          ROW_NUMBER() OVER (PARTITION BY hub_name, order_id ORDER BY event_timestamp DESC) AS rn
        FROM order_events
        WHERE hub_name LIKE $1
          AND event_timestamp >= NOW() - INTERVAL '30 days'
      ),
      latest AS (
        SELECT hub_name, order_id, event_type, day_ist
        FROM base WHERE rn = 1 AND event_type IN ('OUT_FOR_DELIVERY', 'DELIVERED')
      )

      SELECT hub_name, day_ist AS day, 'ORDER_CREATED' AS event_type, NULL::text AS bucket_time, COUNT(DISTINCT order_id)::int AS cnt
      FROM base WHERE event_type = 'ORDER_CREATED'
      GROUP BY 1, 2, 3

      UNION ALL

      SELECT hub_name, day_ist AS day, 'OUT_FOR_DELIVERY' AS event_type, bucket_ist AS bucket_time, COUNT(*)::int AS cnt
      FROM base WHERE event_type = 'OUT_FOR_DELIVERY'
      GROUP BY 1, 2, 3, 4

      UNION ALL

      SELECT hub_name, day_ist AS day, event_type, NULL::text AS bucket_time, COUNT(*)::int AS cnt
      FROM latest
      GROUP BY 1, 2, 3

      ORDER BY 1, 2, 3, 4
    `, [TGF_HUB_PATTERN]);

    // ── Discover hubs dynamically ─────────────────────────────────────────────
    const hubNames = [...new Set(rows.map(r => r.hub_name))];
    const hubs: HubEntry[] = hubNames.map(h => ({
      id:     slugify(h),
      name:   h.replace(/^Bounce-TGF-/i, ''),   // "Sakinaka"
      code:   slugify(h).slice(0, 3).toUpperCase(),
      dbName: h,
    }));
    const hubById = Object.fromEntries(hubs.map(h => [h.id, h]));

    // ── Build per-hub, per-day maps ───────────────────────────────────────────
    type DayMaps = {
      inflow:    Map<string, number>;
      ofdBucket: Map<string, Map<string, number>>;
      inTransit: Map<string, number>;
      delivered: Map<string, number>;
    };
    const byHub = new Map<string, DayMaps>();

    function mapsFor(hubId: string): DayMaps {
      if (!byHub.has(hubId)) {
        byHub.set(hubId, {
          inflow:    new Map(),
          ofdBucket: new Map(),
          inTransit: new Map(),
          delivered: new Map(),
        });
      }
      return byHub.get(hubId)!;
    }

    const allDaySet = new Set<string>();

    for (const row of rows) {
      const hubId = slugify(row.hub_name);
      const day   = row.day.toISOString().slice(0, 10);
      allDaySet.add(day);
      const m = mapsFor(hubId);

      if (row.event_type === 'ORDER_CREATED') {
        m.inflow.set(day, (m.inflow.get(day) ?? 0) + row.cnt);
      } else if (row.event_type === 'OUT_FOR_DELIVERY' && row.bucket_time !== null) {
        if (!m.ofdBucket.has(day)) m.ofdBucket.set(day, new Map());
        const bm = m.ofdBucket.get(day)!;
        bm.set(row.bucket_time, (bm.get(row.bucket_time) ?? 0) + row.cnt);
      } else if (row.event_type === 'OUT_FOR_DELIVERY' && row.bucket_time === null) {
        m.inTransit.set(day, (m.inTransit.get(day) ?? 0) + row.cnt);
      } else if (row.event_type === 'DELIVERED' && row.bucket_time === null) {
        m.delivered.set(day, (m.delivered.get(day) ?? 0) + row.cnt);
      }
    }

    // ── Build DayRecord[] ─────────────────────────────────────────────────────
    const days: DayRecord[] = [];

    for (const dayStr of Array.from(allDaySet).sort()) {
      let totInflow = 0, totDelivered = 0, totInTransit = 0;
      const hubsRecord: Record<string, HubDayData> = {};

      for (const hub of hubs) {
        const m = byHub.get(hub.id);
        const inflow    = m?.inflow.get(dayStr)    ?? 0;
        const inTransit = m?.inTransit.get(dayStr) ?? 0;
        const delivered = m?.delivered.get(dayStr) ?? 0;
        const ofdMap    = m?.ofdBucket.get(dayStr) ?? new Map<string, number>();

        const windows: Record<string, WindowData> = {};
        for (const win of WINDOWS) {
          const buckets = bucketsFor(win).map(t => ({ time: t, count: ofdMap.get(t) ?? 0 }));
          const winTotal = buckets.reduce((a, b) => a + b.count, 0);
          windows[win.id] = { buckets, total: winTotal, delivered, inTransit, failed: 0 };
        }

        hubsRecord[hub.id] = { windows, inflow, delivered, inTransit, failed: 0 };
        totInflow    += inflow;
        totDelivered += delivered;
        totInTransit += inTransit;
      }

      days.push({
        date:   new Date(dayStr + 'T00:00:00+05:30'),
        hubs:   hubsRecord,
        totals: { inflow: totInflow, delivered: totDelivered, inTransit: totInTransit, failed: 0 },
      });
    }

    return NextResponse.json({ days, hubs });
  } catch (err) {
    console.error('/api/tgs/orders error:', err);
    return NextResponse.json({ error: 'Failed to fetch order data' }, { status: 500 });
  }
}

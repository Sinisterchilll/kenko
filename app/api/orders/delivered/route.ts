import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const KENKO_HUB_NAME = 'Kenko HSR | Kenko HSR';

export async function GET() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT
        order_id,
        proof_of_delivery_image AS pod,
        TO_CHAR(
          event_timestamp AT TIME ZONE 'Asia/Kolkata',
          'HH12:MI AM'
        ) AS delivered_time,
        event_timestamp AT TIME ZONE 'Asia/Kolkata' AS delivered_at
      FROM order_events
      WHERE hub_name = $1
        AND event_type = 'DELIVERED'
        AND DATE(event_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE(NOW() AT TIME ZONE 'Asia/Kolkata')
      ORDER BY event_timestamp DESC
    `, [KENKO_HUB_NAME]);

    return NextResponse.json({ orders: rows });
  } catch (err) {
    console.error('/api/orders/delivered error:', err);
    return NextResponse.json({ error: 'Failed to fetch delivered orders' }, { status: 500 });
  }
}

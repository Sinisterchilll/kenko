import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const HUB_NAME = 'Kenko HSR%'; // matches both 'Kenko HSR' and 'Kenko HSR | Kenko HSR'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get('order_id');
  if (!orderId) return NextResponse.json({ error: 'order_id required' }, { status: 400 });

  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT
      event_type,
      TO_CHAR(event_timestamp AT TIME ZONE 'Asia/Kolkata', 'DD Mon · HH12:MI:SS AM') AS time_ist,
      event_timestamp AT TIME ZONE 'Asia/Kolkata' AS ts,
      rider_phone_number
    FROM order_events
    WHERE hub_name LIKE $1 AND order_id = $2
    ORDER BY event_timestamp ASC
  `, [HUB_NAME, orderId]);

  return NextResponse.json({ order_id: orderId, events: rows });
}

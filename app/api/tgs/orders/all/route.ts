import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// TODO: Update TGF_HUB_NAME once confirmed
const HUB_NAME = 'TGF%';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const pool = getPool();
  const { rows } = await pool.query(`
    WITH all_events AS (
      SELECT
        order_id, event_type, event_timestamp,
        rider_id, rider_phone_number, proof_of_delivery_image,
        ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY event_timestamp DESC) AS rn,
        ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY event_timestamp ASC)  AS rn_asc
      FROM order_events
      WHERE hub_name LIKE $1
        AND DATE(event_timestamp AT TIME ZONE 'Asia/Kolkata') = $2::date
    ),
    latest AS (
      SELECT order_id, event_type AS current_stage, event_timestamp,
             rider_id, rider_phone_number, proof_of_delivery_image
      FROM all_events WHERE rn = 1
    ),
    created AS (
      SELECT order_id, event_timestamp AS created_at
      FROM all_events WHERE rn_asc = 1
    )
    SELECT
      l.order_id,
      l.current_stage,
      TO_CHAR(l.event_timestamp AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS last_update,
      l.rider_phone_number,
      l.proof_of_delivery_image AS pod,
      TO_CHAR(c.created_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS created_time
    FROM latest l
    LEFT JOIN created c ON c.order_id = l.order_id
    ORDER BY l.event_timestamp DESC
  `, [HUB_NAME, date]);

  return NextResponse.json({ orders: rows, date });
}

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getPool } from '@/lib/db';

const resend = new Resend(process.env.RESEND_API_KEY);

const HUB_NAME = 'Kenko HSR%'; // matches both 'Kenko HSR' and 'Kenko HSR | Kenko HSR'
const TO_EMAILS  = (process.env.ALERT_TO ?? '').split(',').map(e => e.trim()).filter(Boolean);
const FROM_EMAIL = process.env.ALERT_FROM!;

export async function GET(request: Request) {
  // Simple secret check so only the cron service can trigger this
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pool = getPool();

    // Inflow = ORDER_CREATED count today (IST)
    // In Transit = orders whose latest event today is OUT_FOR_DELIVERY
    // Delivered  = orders whose latest event today is DELIVERED
    const { rows } = await pool.query<{ type: string; cnt: number }>(`
      WITH today_events AS (
        SELECT
          order_id,
          event_type,
          event_timestamp,
          ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY event_timestamp DESC) AS rn
        FROM order_events
        WHERE hub_name LIKE $1
          AND DATE(event_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE(NOW() AT TIME ZONE 'Asia/Kolkata')
      )

      -- Inflow: distinct orders with ORDER_CREATED today (source sends duplicate events)
      SELECT 'inflow' AS type, COUNT(DISTINCT order_id)::int AS cnt
      FROM today_events
      WHERE event_type = 'ORDER_CREATED'

      UNION ALL

      -- In Transit: latest event = OUT_FOR_DELIVERY
      SELECT 'in_transit' AS type, COUNT(*)::int AS cnt
      FROM today_events
      WHERE rn = 1 AND event_type = 'OUT_FOR_DELIVERY'

      UNION ALL

      -- Delivered: latest event = DELIVERED
      SELECT 'delivered' AS type, COUNT(*)::int AS cnt
      FROM today_events
      WHERE rn = 1 AND event_type = 'DELIVERED'
    `, [HUB_NAME]);

    const get = (type: string) => rows.find(r => r.type === type)?.cnt ?? 0;
    const inflow    = get('inflow');
    const inTransit = get('in_transit');
    const delivered = get('delivered');

    const now = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit', minute: '2-digit', hour12: true,
      day: '2-digit', month: 'short',
    });

    const deliveryRate = inflow > 0 ? ((delivered / inflow) * 100).toFixed(1) : '—';

    const html = `
      <div style="font-family: monospace; background: #0B0D0C; color: #fff; padding: 32px; border-radius: 12px; max-width: 480px;">
        <div style="font-size: 11px; color: #5C6960; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 4px;">
          Kenko HSR · Hub Ops Alert
        </div>
        <div style="font-size: 22px; font-weight: 700; color: #D4FF3A; margin-bottom: 24px;">
          ${now} update
        </div>

        <table style="width: 100%; border-collapse: collapse;">
          <tr style="border-bottom: 1px solid #1E2420;">
            <td style="padding: 12px 0; color: #5C6960; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;">Orders Created</td>
            <td style="padding: 12px 0; font-size: 22px; font-weight: 700; text-align: right;">${inflow}</td>
          </tr>
          <tr style="border-bottom: 1px solid #1E2420;">
            <td style="padding: 12px 0; color: #5C6960; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;">In Transit</td>
            <td style="padding: 12px 0; font-size: 22px; font-weight: 700; text-align: right; color: #7A8A82;">${inTransit}</td>
          </tr>
          <tr style="border-bottom: 1px solid #1E2420;">
            <td style="padding: 12px 0; color: #5C6960; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;">Delivered</td>
            <td style="padding: 12px 0; font-size: 22px; font-weight: 700; text-align: right; color: #D4FF3A;">${delivered}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #5C6960; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;">Delivery Rate</td>
            <td style="padding: 12px 0; font-size: 22px; font-weight: 700; text-align: right;">${deliveryRate}%</td>
          </tr>
        </table>

        <div style="margin-top: 24px; font-size: 10px; color: #3A4540; letter-spacing: 0.1em; text-transform: uppercase;">
          Powered by Bounce · Auto-alert
        </div>
      </div>
    `;

    await resend.emails.send({
      from: FROM_EMAIL,
      to:   TO_EMAILS,
      subject: `Kenko HSR · ${now} — ${delivered}/${inflow} delivered`,
      html,
    });

    return NextResponse.json({ ok: true, inflow, inTransit, delivered });
  } catch (err) {
    console.error('/api/cron/alert error:', err);
    return NextResponse.json({ error: 'Alert failed' }, { status: 500 });
  }
}

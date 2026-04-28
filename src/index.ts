import { Env, MonthInfo } from './types';
import { fetchCharges } from './evcc';
import { generateExcel } from './excel';
import { buildHtmlEmail, buildEmptyHtmlEmail, sendEmail } from './email';
import { performBackup } from './backup';
import { round2, formatMonthDE } from './utils';

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      if (event.cron === '0 3 * * *') {
        if (!env.EVCC_BACKUP) {
          console.log('Backup übersprungen: kein EVCC_BACKUP R2-Binding konfiguriert');
          return;
        }
        console.log('evcc Backup wird gestartet...');
        const key = await performBackup(env);
        console.log(`Backup abgeschlossen: ${key}`);
      } else {
        console.log('Ladepunkt-Abrechnung wird gestartet...');
        await processCharges(env, getPreviousMonth());
      }
    } catch (error) {
      console.error(`Cron ${event.cron} fehlgeschlagen:`, error);
      throw error;
    }
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // POST /trigger?month=YYYY-MM – manuelle Ausführung (Default: Vormonat)
    if (url.pathname === '/trigger' && request.method === 'POST') {
      const monthParam = url.searchParams.get('month');
      let month: MonthInfo;
      try {
        month = monthParam ? parseMonth(monthParam) : getPreviousMonth();
      } catch (error) {
        return Response.json(
          { success: false, error: String(error) },
          { status: 400 },
        );
      }
      try {
        await processCharges(env, month);
        return Response.json({ success: true, month: month.key });
      } catch (error) {
        console.error('Trigger fehlgeschlagen:', error);
        return Response.json(
          { success: false, error: String(error) },
          { status: 500 },
        );
      }
    }

    // POST /backup – manuelles Backup
    if (url.pathname === '/backup' && request.method === 'POST') {
      if (!env.EVCC_BACKUP) {
        return Response.json(
          { success: false, error: 'Kein EVCC_BACKUP R2-Binding konfiguriert' },
          { status: 501 },
        );
      }
      try {
        const key = await performBackup(env);
        return Response.json({ success: true, key });
      } catch (error) {
        console.error('Backup fehlgeschlagen:', error);
        return Response.json(
          { success: false, error: String(error) },
          { status: 500 },
        );
      }
    }

    return Response.json({ service: 'evcc-ladepunkt' });
  },
};

async function processCharges(env: Env, month: MonthInfo): Promise<void> {
  console.log(`Verarbeite Monat: ${month.key}`);

  const charges = await fetchCharges(env, month);
  const periodLabel = formatMonthDE(month.key);
  const subject = `Ladevorgänge zuhause ID.BUZZ OA-FX25E vom ${periodLabel}`;
  const recipients = env.INVOICE_RECIPIENTS.split(',').map((s) => s.trim());
  const smtp = {
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT, 10),
    username: env.SMTP_USERNAME,
    password: env.SMTP_PASSWORD,
  };

  if (charges.length === 0) {
    console.log('Keine relevanten Ladevorgänge gefunden, sende Info-Mail.');
    const { html, text } = buildEmptyHtmlEmail(periodLabel);
    await sendEmail(smtp, env.SMTP_FROM, recipients, subject, html, text);
    console.log('Info-Mail wurde erfolgreich verschickt.');
    return;
  }

  let totalEnergy = 0;
  let totalPrice = 0;
  for (const charge of charges) {
    totalEnergy += round2(charge.chargedEnergy);
    totalPrice += round2(charge.price);
  }
  console.log(
    `${charges.length} relevante Ladevorgänge, Gesamtkosten: ${totalPrice.toFixed(2)} EUR`,
  );

  const xlsxData = await generateExcel(charges, month);
  const xlsxFilename = `charging_${month.key}.xlsx`;
  console.log('Excel erstellt');

  const { html, text } = buildHtmlEmail(
    charges,
    periodLabel,
    totalEnergy,
    totalPrice,
  );

  await sendEmail(
    smtp,
    env.SMTP_FROM,
    recipients,
    subject,
    html,
    text,
    { filename: xlsxFilename, content: xlsxData },
  );
  console.log('E-Mail wurde erfolgreich verschickt.');
}

function getPreviousMonth(): MonthInfo {
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIdx = now.getUTCMonth(); // 0-11
  const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1;
  const prevYear = monthIdx === 0 ? year - 1 : year;
  return {
    year: prevYear,
    month: prevMonthIdx + 1,
    key: `${prevYear}-${String(prevMonthIdx + 1).padStart(2, '0')}`,
  };
}

function parseMonth(s: string): MonthInfo {
  const match = s.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Ungültiges Monatsformat: "${s}" (erwartet: YYYY-MM)`);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) {
    throw new Error(`Ungültiger Monat: "${s}"`);
  }
  return { year, month, key: `${match[1]}-${match[2]}` };
}

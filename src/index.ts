import { Env, AppState, MonthInfo } from './types';
import { fetchCharges } from './evcc';
import { generateExcel } from './excel';
import { buildHtmlEmail, sendEmail } from './email';
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
        // Tägliches Backup (nur wenn R2-Binding konfiguriert)
        if (!env.EVCC_BACKUP) {
          console.log('Backup übersprungen: kein EVCC_BACKUP R2-Binding konfiguriert');
          return;
        }
        console.log('evcc Backup wird gestartet...');
        const key = await performBackup(env);
        console.log(`Backup abgeschlossen: ${key}`);
      } else {
        // Monatliche Abrechnung
        console.log('Ladepunkt-Abrechnung wird gestartet...');
        await processCharges(env);
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

    // POST /trigger – manuelle Ausführung
    if (url.pathname === '/trigger' && request.method === 'POST') {
      try {
        await processCharges(env);
        return Response.json({ success: true });
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

    // GET / – Statusseite
    const state = await loadState(env);
    return Response.json({
      service: 'evcc-ladepunkt',
      last_billed_month: state.last_billed_month,
    });
  },
};

async function processCharges(env: Env): Promise<void> {
  const state = await loadState(env);
  const months = getMonthsToProcess(state.last_billed_month);

  if (months.length === 0) {
    console.log('Keine neuen Monate zu verarbeiten');
    return;
  }

  console.log(
    `Verarbeite ${months.length} Monat(e): ${months[0].key} bis ${months[months.length - 1].key}`,
  );

  // Ladevorgänge abrufen
  const chargesByMonth = await fetchCharges(env, months);
  const monthKeys = months
    .map((m) => m.key)
    .filter((k) => chargesByMonth.has(k));

  // Gesamtkosten berechnen
  let totalEnergy = 0;
  let totalPrice = 0;
  let allChargeCount = 0;

  for (const charges of chargesByMonth.values()) {
    for (const charge of charges) {
      totalEnergy += round2(charge.chargedEnergy);
      totalPrice += round2(charge.price);
      allChargeCount++;
    }
  }

  console.log(
    `${allChargeCount} relevante Ladevorgänge, Gesamtkosten: ${totalPrice.toFixed(2)} EUR`,
  );

  // Zeitraum-Label
  const periodLabel =
    months.length === 1
      ? formatMonthDE(months[0].key)
      : `${formatMonthDE(months[0].key)} bis ${formatMonthDE(months[months.length - 1].key)}`;

  if (allChargeCount === 0) {
    console.log('Keine relevanten Ladevorgänge gefunden, sende Info-Mail.');

    const recipients = (env.SUMMARY_RECIPIENTS || env.INVOICE_RECIPIENTS)
      .split(',')
      .map((s) => s.trim());

    const subject = `Ladevorgänge zuhause ID.BUZZ OA-FX25E vom ${periodLabel}`;
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
      + '<body style="font-family:Arial,Helvetica,sans-serif;color:#333;margin:0;padding:20px;background-color:#f5f5f5;">'
      + '<div style="max-width:800px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">'
      + '<div style="background-color:#1a3a5c;color:#fff;padding:20px 24px;">'
      + '<h2 style="margin:0;font-size:20px;">Ladevorg&auml;nge ID.BUZZ &ndash; OA-FX25E</h2>'
      + `<p style="margin:6px 0 0;font-size:14px;opacity:0.85;">${periodLabel}</p>`
      + '</div>'
      + '<div style="padding:24px;">'
      + `<p>Im Zeitraum <strong>${periodLabel}</strong> wurden keine relevanten Ladevorg&auml;nge erfasst.</p>`
      + '</div></div></body></html>';
    const text = `Ladevorgänge ID.BUZZ - OA-FX25E\n${periodLabel}\n\nKeine relevanten Ladevorgänge im angegebenen Zeitraum.`;

    await sendEmail(
      {
        host: env.SMTP_HOST,
        port: parseInt(env.SMTP_PORT, 10),
        username: env.SMTP_USERNAME,
        password: env.SMTP_PASSWORD,
      },
      env.SMTP_FROM,
      recipients,
      subject,
      html,
      text,
    );

    console.log('Info-Mail wurde erfolgreich verschickt.');
    state.last_billed_month = months[months.length - 1].key;
    await saveState(env, state);
    console.log(`Marker auf ${state.last_billed_month} gesetzt.`);
    return;
  }

  // Abrechnungstyp bestimmen:
  //   Dezember → volle Abrechnung (Jahreswechsel)
  //   >= Mindestbetrag → volle Abrechnung
  const minAmount = parseFloat(env.MIN_BILLING_AMOUNT || '25');
  const includesDecember = months.some((m) => m.month === 12);
  const fullBilling = totalPrice >= minAmount || includesDecember;

  // Excel nur bei voller Abrechnung erzeugen
  let xlsxData: Uint8Array | undefined;
  let xlsxFilename: string | undefined;

  if (fullBilling) {
    xlsxData = await generateExcel(chargesByMonth, monthKeys);
    xlsxFilename =
      months.length === 1
        ? `charging_${months[0].key}.xlsx`
        : `charging_${months[0].key}_${months[months.length - 1].key}.xlsx`;
    console.log('Excel erstellt');
  }

  // HTML-Email aufbauen
  const { html, text } = buildHtmlEmail(
    chargesByMonth,
    monthKeys,
    periodLabel,
    totalEnergy,
    totalPrice,
    fullBilling,
  );

  const subject = `Ladevorgänge zuhause ID.BUZZ OA-FX25E vom ${periodLabel}`;
  const recipients = (
    fullBilling ? env.INVOICE_RECIPIENTS : env.SUMMARY_RECIPIENTS
  )
    .split(',')
    .map((s) => s.trim());

  // Email per SMTP senden
  await sendEmail(
    {
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT, 10),
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
    },
    env.SMTP_FROM,
    recipients,
    subject,
    html,
    text,
    xlsxData && xlsxFilename
      ? { filename: xlsxFilename, content: xlsxData }
      : undefined,
  );

  console.log('E-Mail wurde erfolgreich verschickt.');

  // State aktualisieren
  state.last_billed_month = months[months.length - 1].key;
  await saveState(env, state);
  console.log(`Marker auf ${state.last_billed_month} gesetzt.`);
}

// Bestimmt die zu verarbeitenden Monate (vom Monat nach dem letzten
// abgerechneten bis zum Vormonat).
function getMonthsToProcess(lastBilledMonth: string | null): MonthInfo[] {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  let startMonth: Date;
  if (lastBilledMonth) {
    const [year, month] = lastBilledMonth.split('-').map(Number);
    // Date-Monat ist 0-indiziert → month (1-indiziert) ergibt den Folgemonat
    startMonth = new Date(year, month, 1);
  } else {
    // Erster Lauf: nur den Vormonat verarbeiten
    startMonth = new Date(lastMonth);
  }

  const months: MonthInfo[] = [];
  const current = new Date(startMonth);

  while (current <= lastMonth) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth() + 1,
      key: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`,
    });
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

async function loadState(env: Env): Promise<AppState> {
  const data = await env.STATE.get('ladepunkt_state');
  if (data) {
    return JSON.parse(data);
  }
  return { last_billed_month: null };
}

async function saveState(env: Env, state: AppState): Promise<void> {
  await env.STATE.put('ladepunkt_state', JSON.stringify(state));
}

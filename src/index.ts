import { Env, AppState, MonthInfo } from './types';
import { fetchCharges } from './evcc';
import { generateExcel } from './excel';
import { buildHtmlEmail, sendEmail } from './email';
import { round2, formatMonthDE } from './utils';

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log('Ladepunkt-Abrechnung wird gestartet...');
    await processCharges(env);
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

  if (allChargeCount === 0) {
    console.log('Keine relevanten Ladevorgänge gefunden, überspringe.');
    state.last_billed_month = months[months.length - 1].key;
    await saveState(env, state);
    console.log(`Marker auf ${state.last_billed_month} gesetzt.`);
    return;
  }

  // Abrechnungstyp bestimmen:
  //   Dezember → volle Abrechnung (Jahreswechsel)
  //   >= 25 EUR → volle Abrechnung
  const includesDecember = months.some((m) => m.month === 12);
  const fullBilling = totalPrice >= 25 || includesDecember;

  // Zeitraum-Label
  const periodLabel =
    months.length === 1
      ? formatMonthDE(months[0].key)
      : `${formatMonthDE(months[0].key)} bis ${formatMonthDE(months[months.length - 1].key)}`;

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
    fullBilling ? env.RECIPIENTS : env.RECIPIENTS_MONTHLY
  )
    .split(',')
    .map((s) => s.trim());

  // Email senden
  await sendEmail(
    env.RESEND_API_KEY,
    env.EMAIL_FROM,
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

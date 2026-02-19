import { Charge } from './types';
import { SmtpClient, SmtpConfig } from './smtp';
import {
  round2,
  fmtNum,
  formatMonthDE,
  formatDateDE,
  escapeHtml,
  uint8ArrayToBase64,
  utf8ToBase64,
  wrapBase64,
} from './utils';

// ---------------------------------------------------------------------------
// HTML-Email aufbauen (identisch zum PHP-Original)
// ---------------------------------------------------------------------------

export function buildHtmlEmail(
  chargesByMonth: Map<string, Charge[]>,
  monthKeys: string[],
  periodLabel: string,
  totalEnergy: number,
  totalPrice: number,
  fullBilling: boolean,
): { html: string; text: string } {
  let tableRows = '';

  for (const monthKey of monthKeys) {
    const charges = chargesByMonth.get(monthKey);
    if (!charges) continue;

    let mEnergy = 0;
    let mPrice = 0;

    for (const charge of charges) {
      const created = formatDateDE(charge.created);
      const finished = formatDateDE(charge.finished);
      const odometer =
        charge.odometer !== null
          ? Math.round(charge.odometer).toLocaleString('de-DE')
          : '';
      const energy = round2(charge.chargedEnergy);
      const price = round2(charge.price);
      mEnergy += energy;
      mPrice += price;

      tableRows += '<tr>'
        + `<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;">${created}</td>`
        + `<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;">${finished}</td>`
        + `<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">${odometer}</td>`
        + `<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">${fmtNum(energy)}</td>`
        + `<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">${fmtNum(charge.pricePerKWh)}</td>`
        + `<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">${fmtNum(price)}</td>`
        + '</tr>';
    }

    const mAvg = mEnergy > 0 ? mPrice / mEnergy : 0;
    const monthLabel = formatMonthDE(monthKey);

    tableRows += '<tr style="background-color:#D9E1F2;font-weight:bold;">'
      + `<td colspan="3" style="padding:6px 10px;">Summe ${monthLabel}</td>`
      + `<td style="padding:6px 10px;text-align:right;">${fmtNum(mEnergy)}</td>`
      + `<td style="padding:6px 10px;text-align:right;">${fmtNum(mAvg)}</td>`
      + `<td style="padding:6px 10px;text-align:right;">${fmtNum(mPrice)}</td>`
      + '</tr>';
  }

  const avgPrice = totalEnergy > 0 ? totalPrice / totalEnergy : 0;

  tableRows += '<tr style="background-color:#B4C6E7;font-weight:bold;">'
    + '<td colspan="3" style="padding:6px 10px;">GESAMTSUMME</td>'
    + `<td style="padding:6px 10px;text-align:right;">${fmtNum(totalEnergy)}</td>`
    + `<td style="padding:6px 10px;text-align:right;">${fmtNum(avgPrice)}</td>`
    + `<td style="padding:6px 10px;text-align:right;">${fmtNum(totalPrice)}</td>`
    + '</tr>';

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;color:#333;margin:0;padding:20px;background-color:#f5f5f5;">'
    + '<div style="max-width:800px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">'
    + '<div style="background-color:#1a3a5c;color:#fff;padding:20px 24px;">'
    + '<h2 style="margin:0;font-size:20px;">Ladevorg&auml;nge ID.BUZZ &ndash; OA-FX25E</h2>'
    + `<p style="margin:6px 0 0;font-size:14px;opacity:0.85;">${escapeHtml(periodLabel)}</p>`
    + '</div>'
    + '<div style="padding:24px;">'
    + '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">'
    + '<thead><tr style="background-color:#f0f0f0;">'
    + '<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #1a3a5c;">Beginn</th>'
    + '<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #1a3a5c;">Ende</th>'
    + '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">km-Stand</th>'
    + '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">kWh</th>'
    + '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">EUR/kWh</th>'
    + '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">Kosten</th>'
    + '</tr></thead>'
    + `<tbody>${tableRows}</tbody>`
    + '</table>'
    + (fullBilling
      ? '<p style="margin:20px 0 0;font-size:12px;color:#888;">Die vollst&auml;ndige Aufstellung ist als Excel-Datei angeh&auml;ngt.</p>'
      : '')
    + '</div></div></body></html>';

  const text =
    `Ladevorgänge ID.BUZZ - OA-FX25E\n${periodLabel}\n\n`
    + `Gesamtverbrauch: ${fmtNum(totalEnergy)} kWh\n`
    + `Durchschnittspreis: ${fmtNum(avgPrice)} EUR/kWh\n`
    + `Gesamtkosten: ${fmtNum(totalPrice)} EUR`
    + (fullBilling ? '\n\nDetails siehe Excel-Anhang.' : '');

  return { html, text };
}

// ---------------------------------------------------------------------------
// MIME-Nachricht bauen (RFC 2822 / RFC 2045)
// ---------------------------------------------------------------------------

function buildMimeMessage(options: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachment?: { filename: string; content: Uint8Array };
}): string {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2);
  const boundaryMixed = `----=_Mixed_${ts}_${rnd}`;
  const boundaryAlt = `----=_Alt_${ts}_${rnd}`;
  const date = new Date().toUTCString();

  const hasAttachment = !!options.attachment;

  // Header
  const headers = [
    `Date: ${date}`,
    `From: ${options.from}`,
    `To: ${options.to.join(', ')}`,
    `Subject: =?UTF-8?B?${utf8ToBase64(options.subject)}?=`,
    'MIME-Version: 1.0',
    hasAttachment
      ? `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`
      : `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
  ];

  let msg = headers.join('\r\n') + '\r\n\r\n';

  // Bei Anhang: äußere multipart/mixed → innere multipart/alternative
  if (hasAttachment) {
    msg += `--${boundaryMixed}\r\n`;
    msg += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n`;
  }

  // text/plain
  msg += `--${boundaryAlt}\r\n`;
  msg += 'Content-Type: text/plain; charset=UTF-8\r\n';
  msg += 'Content-Transfer-Encoding: base64\r\n\r\n';
  msg += wrapBase64(utf8ToBase64(options.text)) + '\r\n';

  // text/html
  msg += `--${boundaryAlt}\r\n`;
  msg += 'Content-Type: text/html; charset=UTF-8\r\n';
  msg += 'Content-Transfer-Encoding: base64\r\n\r\n';
  msg += wrapBase64(utf8ToBase64(options.html)) + '\r\n';

  msg += `--${boundaryAlt}--\r\n`;

  // Anhang
  if (options.attachment) {
    msg += `--${boundaryMixed}\r\n`;
    msg += 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; '
      + `name="${options.attachment.filename}"\r\n`;
    msg += 'Content-Transfer-Encoding: base64\r\n';
    msg += `Content-Disposition: attachment; filename="${options.attachment.filename}"\r\n\r\n`;
    msg += wrapBase64(uint8ArrayToBase64(options.attachment.content)) + '\r\n';
    msg += `--${boundaryMixed}--\r\n`;
  }

  return msg;
}

// ---------------------------------------------------------------------------
// Email per SMTP versenden
// ---------------------------------------------------------------------------

/** E-Mail-Adresse aus "Name <addr>" oder "addr" extrahieren. */
function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from.trim();
}

export async function sendEmail(
  smtp: SmtpConfig,
  from: string,
  to: string[],
  subject: string,
  html: string,
  text: string,
  attachment?: { filename: string; content: Uint8Array },
): Promise<void> {
  const message = buildMimeMessage({ from, to, subject, html, text, attachment });
  const envelope = extractEmail(from);

  const client = new SmtpClient();
  await client.connect(smtp);
  await client.sendMail(envelope, to, message);
  await client.quit();
}

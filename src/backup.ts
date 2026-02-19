import { Env } from './types';

export async function performBackup(env: Env): Promise<string> {
  if (!env.EVCC_BACKUP) {
    throw new Error('Kein EVCC_BACKUP R2-Binding konfiguriert');
  }

  const bucket = env.EVCC_BACKUP;
  const baseUrl = env.EVCC_URL.replace(/\/+$/, '');

  // Bei evcc einloggen, um Auth-Cookie zu erhalten
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: env.EVCC_ADMIN_PASS }),
  });

  if (!loginRes.ok) {
    const body = await loginRes.text().catch(() => '');
    throw new Error(`evcc Login fehlgeschlagen: HTTP ${loginRes.status} – ${body}`);
  }

  const setCookie = loginRes.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('evcc Login: Kein Auth-Cookie erhalten');
  }

  // Cookie-Wert extrahieren (vor dem ersten Semikolon)
  const cookieHeader = setCookie.split(';')[0];

  // SQLite-Backup über die API herunterladen (POST mit Passwort im Body)
  const backupRes = await fetch(`${baseUrl}/api/system/backup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ password: env.EVCC_ADMIN_PASS }),
  });

  if (!backupRes.ok) {
    const body = await backupRes.text().catch(() => '');
    throw new Error(`evcc Backup fehlgeschlagen: HTTP ${backupRes.status} – ${body}`);
  }

  const dbData = await backupRes.arrayBuffer();
  if (dbData.byteLength === 0) {
    throw new Error('evcc Backup: Leere Antwort erhalten');
  }

  // In R2 speichern mit Datum als Key
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 16).replace(':', '-');
  const key = `evcc-backup-${dateStr}--${timeStr}.db`;

  await bucket.put(key, dbData, { storageClass: 'InfrequentAccess' });
  const sizeMB = (dbData.byteLength / 1024 / 1024).toFixed(2);
  console.log(`Backup gespeichert: ${key} (${sizeMB} MB)`);

  // Alte Backups aufräumen
  await cleanupOldBackups(bucket, env.EVCC_BACKUP_DAYS);

  return key;
}

async function cleanupOldBackups(
  bucket: R2Bucket,
  backupDays?: string,
): Promise<void> {
  const retentionDays = parseInt(backupDays || '30', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const listed = await bucket.list({ prefix: 'evcc-backup-' });
  let deleted = 0;

  for (const obj of listed.objects) {
    // Key-Format: evcc-backup-YYYY-MM-DD--HH-MM.db
    const dateMatch = obj.key.match(/evcc-backup-(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const backupDate = new Date(dateMatch[1]);
    if (backupDate < cutoff) {
      await bucket.delete(obj.key);
      deleted++;
    }
  }

  if (deleted > 0) {
    console.log(`${deleted} alte Backup(s) gelöscht (älter als ${retentionDays} Tage)`);
  }
}

# evcc-auswertung

Cloudflare Worker zur automatischen Abrechnung von Ladevorgängen und Backup der [evcc](https://evcc.io)-Datenbank.

## Funktionen

### Ladepunkt-Abrechnung

- Ruft monatlich Ladesessions von der evcc-API ab
- Filtert nach konfigurierten Fahrzeugen und Ladepunkt
- Erzeugt eine Excel-Datei mit Abrechnungsdetails
- Versendet die Abrechnung per E-Mail (SMTP)

### evcc Datenbank-Backup

- Sichert täglich die komplette SQLite-Datenbank von evcc
- Speichert die Backups in Cloudflare R2
- Automatisches Aufräumen alter Backups nach konfigurierbarer Aufbewahrungsdauer

## Architektur

```
src/
├── index.ts    # Worker Entry Point (Cron-Handler, HTTP-Endpoints)
├── types.ts    # TypeScript-Interfaces (Env, Charge, etc.)
├── evcc.ts     # evcc-API-Client (Sessions abrufen)
├── backup.ts   # evcc-Datenbank-Backup nach R2
├── excel.ts    # Excel-Generierung mit ExcelJS
├── email.ts    # HTML-E-Mail-Aufbau und Versand
├── smtp.ts     # SMTP-Client für Cloudflare Workers
└── utils.ts    # Hilfsfunktionen (Formatierung, Encoding)
```

## Cron-Trigger

| Cron             | Beschreibung                   |
| ---------------- | ------------------------------ |
| `0 8 1 * *`      | Monatliche Abrechnung (1. des Monats, 08:00 UTC) |
| `0 3 * * *`      | Tägliches evcc-Backup (03:00 UTC) |

## HTTP-Endpoints

| Methode | Pfad       | Beschreibung              |
| ------- | ---------- | ------------------------- |
| `GET`   | `/`        | Status (letzter abgerechneter Monat) |
| `POST`  | `/trigger` | Manuelle Abrechnung       |
| `POST`  | `/backup`  | Manuelles Backup          |

## Cloudflare-Ressourcen

### KV Namespace

- **Binding:** `STATE` – Speichert den Abrechnungsstatus (`last_billed_month`)

### R2 Bucket

- **Binding:** `EVCC_BACKUP` – Speichert die täglichen SQLite-Backups
- Bucket muss manuell angelegt werden: `wrangler r2 bucket create evcc-backup`
- Der Bucket-Name ist in `wrangler.json` konfigurierbar (`bucket_name`)

## Secrets

Alle Secrets werden über `wrangler secret put <NAME>` gesetzt:

| Secret                       | Beschreibung                                    |
| ---------------------------- | ----------------------------------------------- |
| `EVCC_URL`                   | evcc Base-URL (z.B. `https://evcc.example.com`) |
| `EVCC_ADMIN_PASS`            | evcc Admin-Passwort (für Backup-API)            |
| `EVCC_BACKUP_DAYS`           | Aufbewahrungsdauer der Backups in Tagen         |
| `CARS`                       | Kommagetrennte Fahrzeugnamen                    |
| `SMTP_HOST`                  | SMTP-Server                                     |
| `SMTP_PORT`                  | SMTP-Port                                       |
| `SMTP_USERNAME`              | SMTP-Benutzername                               |
| `SMTP_PASSWORD`              | SMTP-Passwort                                   |
| `SMTP_FROM`             | Absender-E-Mail-Adresse                         |
| `INVOICE_RECIPIENTS`       | Empfänger der Abrechnung (kommagetrennt)        |

## Setup

```bash
# Dependencies installieren
npm install

# Secrets setzen
wrangler secret put EVCC_URL
wrangler secret put EVCC_ADMIN_PASS
wrangler secret put EVCC_BACKUP_DAYS
wrangler secret put CARS
wrangler secret put SMTP_HOST
wrangler secret put SMTP_PORT
wrangler secret put SMTP_USERNAME
wrangler secret put SMTP_PASSWORD
wrangler secret put SMTP_FROM
wrangler secret put INVOICE_RECIPIENTS

# R2 Bucket anlegen
wrangler r2 bucket create evcc-backup

# Deployen
npm run deploy
```

## Entwicklung

```bash
# Lokaler Dev-Server
npm run dev

# Logs ansehen
npm run tail
```

export interface Charge {
  vehicle: string;
  loadpoint: string;
  created: string;
  finished: string;
  odometer: number | null;
  chargedEnergy: number;
  pricePerKWh: number;
  price: number;
}

export interface AppState {
  last_billed_month: string | null;
}

export interface Env {
  STATE: KVNamespace;
  EVCC_BACKUP?: R2Bucket;
  EVCC_URL: string;
  EVCC_ADMIN_PASS?: string;
  EVCC_BACKUP_DAYS?: string;
  CARS: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USERNAME: string; // wrangler secret put SMTP_USERNAME
  SMTP_PASSWORD: string; // wrangler secret put SMTP_PASSWORD
  SMTP_FROM: string;
  INVOICE_RECIPIENTS: string;
}

export interface MonthInfo {
  year: number;
  month: number; // 1-12
  key: string; // "YYYY-MM"
}

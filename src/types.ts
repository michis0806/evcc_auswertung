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
  EVCC_URL: string;
  CARS: string;
  RESEND_API_KEY: string; // wrangler secret put RESEND_API_KEY
  EMAIL_FROM: string;
  RECIPIENTS: string;
  RECIPIENTS_MONTHLY: string;
}

export interface MonthInfo {
  year: number;
  month: number; // 1-12
  key: string; // "YYYY-MM"
}

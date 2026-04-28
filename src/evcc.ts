import { Charge, MonthInfo, Env } from './types';

export async function fetchCharges(
  env: Env,
  month: MonthInfo,
): Promise<Charge[]> {
  const cars = env.CARS.split(',').map((c) => c.trim());
  const baseUrl = env.EVCC_URL.replace(/\/+$/, '');
  const url = `${baseUrl}/api/sessions?month=${month.month}&year=${month.year}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`evcc-API HTTP ${response.status} für ${month.key}`);
  }

  const data: Charge[] = await response.json();
  if (!data || data.length === 0) {
    console.log(`${month.key}: Keine Ladevorgänge`);
    return [];
  }

  const filtered = data.filter(
    (charge) =>
      cars.includes(charge.vehicle) && charge.loadpoint === 'Doppelgarage',
  );

  console.log(
    `${month.key}: ${data.length} Ladevorgänge, ${filtered.length} relevant`,
  );
  return filtered;
}

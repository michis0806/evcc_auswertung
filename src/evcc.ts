import { Charge, MonthInfo, Env } from './types';

export async function fetchCharges(
  env: Env,
  months: MonthInfo[],
): Promise<Map<string, Charge[]>> {
  const cars = env.CARS.split(',').map((c) => c.trim());
  const chargesByMonth = new Map<string, Charge[]>();

  const baseUrl = env.EVCC_URL.replace(/\/+$/, '');

  for (const month of months) {
    const url = `${baseUrl}/api/sessions?month=${month.month}&year=${month.year}`;

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        console.log(`${month.key}: HTTP ${response.status}`);
        continue;
      }

      const data: Charge[] = await response.json();

      if (data && data.length > 0) {
        const filtered = data.filter(
          (charge) =>
            cars.includes(charge.vehicle) &&
            charge.loadpoint === 'Doppelgarage',
        );

        if (filtered.length > 0) {
          chargesByMonth.set(month.key, filtered);
        }

        console.log(
          `${month.key}: ${data.length} Ladevorgänge, ${filtered.length} relevant`,
        );
      } else {
        console.log(`${month.key}: Keine Ladevorgänge`);
      }
    } catch (error) {
      console.error(`${month.key}: Fehler beim Abruf: ${error}`);
    }
  }

  return chargesByMonth;
}

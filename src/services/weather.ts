import type { ExternalWeather, HourlyReading } from '../types';

export async function fetchOvernightWeather(
  lat: number,
  lon: number
): Promise<ExternalWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=2`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);

  const data = await res.json();
  const times: string[] = data.hourly.time;
  const temps: number[] = data.hourly.temperature_2m;
  const humidities: number[] = data.hourly.relative_humidity_2m;

  // Get overnight window: 9 PM tonight through 7 AM tomorrow
  const now = new Date();
  const tonight9pm = new Date(now);
  tonight9pm.setHours(21, 0, 0, 0);

  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(7, 0, 0, 0);

  const overnightTemps: HourlyReading[] = [];
  const overnightHumidity: HourlyReading[] = [];

  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    if (t >= tonight9pm && t <= tomorrowMorning) {
      overnightTemps.push({ hour: times[i], value: temps[i] });
      overnightHumidity.push({ hour: times[i], value: humidities[i] });
    }
  }

  return {
    overnightTemps,
    overnightHumidity,
    fetchedAt: Date.now(),
  };
}

export function getOvernightLow(weather: ExternalWeather): number | null {
  if (weather.overnightTemps.length === 0) return null;
  return Math.min(...weather.overnightTemps.map((r) => r.value));
}

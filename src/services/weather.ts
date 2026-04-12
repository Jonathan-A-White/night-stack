import type { ExternalWeather, HourlyReading } from '../types';

export async function fetchOvernightWeather(
  lat: number,
  lon: number,
  date?: string
): Promise<ExternalWeather> {
  // Determine the target evening date and whether it's in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = date ? new Date(date + 'T00:00:00') : new Date();
  const targetDateOnly = new Date(targetDate);
  targetDateOnly.setHours(0, 0, 0, 0);

  const isPast = targetDateOnly < today;

  // The overnight window spans two calendar days: date → date+1
  const nextDay = new Date(targetDateOnly);
  nextDay.setDate(nextDay.getDate() + 1);
  const startDate = date || today.toISOString().slice(0, 10);
  const endDate = nextDay.toISOString().slice(0, 10);

  let url: string;
  if (isPast) {
    // Use Open-Meteo archive API for historical data
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m&temperature_unit=fahrenheit&timezone=America/New_York&start_date=${startDate}&end_date=${endDate}`;
  } else {
    url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=2`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);

  const data = await res.json();
  const times: string[] = data.hourly.time;
  const temps: number[] = data.hourly.temperature_2m;
  const humidities: number[] = data.hourly.relative_humidity_2m;

  // Get overnight window: 9 PM on target date through 7 AM next day
  const tonight9pm = new Date(targetDateOnly);
  tonight9pm.setHours(21, 0, 0, 0);

  const tomorrowMorning = new Date(targetDateOnly);
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

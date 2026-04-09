import { describe, it, expect, beforeEach } from 'vitest';
import { db, seedDatabase } from '../db';

describe('seedDatabase', () => {
  beforeEach(async () => {
    // Clear all tables before each test
    await db.delete();
    await db.open();
  });

  it('seeds all configuration tables on first run', async () => {
    await seedDatabase();

    const settings = await db.appSettings.get('default');
    expect(settings).not.toBeNull();
    expect(settings!.latitude).toBe(41.37);
    expect(settings!.longitude).toBe(-73.41);
    expect(settings!.darkMode).toBe(true);
    expect(settings!.unitSystem).toBe('us');
    expect(settings!.weighInPeriod).toBe('morning');
    expect(settings!.sex).toBeNull();
    expect(settings!.heightInches).toBeNull();
    expect(settings!.startingWeightLbs).toBeNull();
    expect(settings!.age).toBeNull();

    const schedules = await db.alarmSchedules.toArray();
    expect(schedules).toHaveLength(7);

    const supplements = await db.supplementDefs.toArray();
    expect(supplements).toHaveLength(13);
    expect(supplements.find((s) => s.name === 'Magnesium Glycinate')).toBeTruthy();

    const clothing = await db.clothingItems.toArray();
    expect(clothing).toHaveLength(6);

    const bedding = await db.beddingItems.toArray();
    expect(bedding).toHaveLength(6);

    const copingItems = await db.middayCopingItems.toArray();
    expect(copingItems).toHaveLength(7);
    expect(copingItems.find((i) => i.name === 'Ginger juice / tea')?.type).toBe('drink');
    expect(copingItems.find((i) => i.name === 'Peanuts')?.type).toBe('food');
    expect(copingItems.find((i) => i.name === '30 minute power nap')?.type).toBe('nap');

    const causes = await db.wakeUpCauses.toArray();
    expect(causes).toHaveLength(8);

    const reasons = await db.bedtimeReasons.toArray();
    expect(reasons).toHaveLength(8);

    const rules = await db.sleepRules.toArray();
    expect(rules).toHaveLength(12);
    expect(rules.every((r) => r.source === 'seeded')).toBe(true);
    expect(rules.every((r) => r.isActive)).toBe(true);
  });

  it('does not re-seed if already seeded', async () => {
    await seedDatabase();
    const firstRules = await db.sleepRules.toArray();

    await seedDatabase(); // second call
    const secondRules = await db.sleepRules.toArray();

    expect(secondRules).toHaveLength(firstRules.length);
  });

  it('seeds correct alarm schedule', async () => {
    await seedDatabase();
    const schedules = await db.alarmSchedules.orderBy('dayOfWeek').toArray();

    // Sunday
    expect(schedules[0].hasAlarm).toBe(false);
    expect(schedules[0].naturalWakeTime).toBe('07:15');

    // Monday
    expect(schedules[1].hasAlarm).toBe(true);
    expect(schedules[1].alarmTime).toBe('04:43');

    // Wednesday
    expect(schedules[3].hasAlarm).toBe(true);
    expect(schedules[3].alarmTime).toBe('06:15');

    // Saturday
    expect(schedules[6].hasAlarm).toBe(false);
  });

  it('seeds all sleep rules with correct priorities', async () => {
    await seedDatabase();
    const rules = await db.sleepRules.toArray();

    const highRules = rules.filter((r) => r.priority === 'high');
    const medRules = rules.filter((r) => r.priority === 'medium');
    const lowRules = rules.filter((r) => r.priority === 'low');

    // 10 legacy rules + 2 midday coping rules (medium + low)
    expect(highRules).toHaveLength(5);
    expect(medRules).toHaveLength(5);
    expect(lowRules).toHaveLength(2);
  });
});

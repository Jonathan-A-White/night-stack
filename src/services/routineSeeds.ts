import type { Routine, RoutineStep, RoutineVariant } from '../types';

/**
 * Seed routines. The evening routine has a well-known id because it
 * predates the `routines` table (v13 stamps every existing step, variant
 * and session with it) and because `/tonight/routine`, the Tonight card
 * and the legacy WIP localStorage key all address it without a lookup.
 *
 * The sound booth routine is the Brookfield First Sunday-morning SOP,
 * seeded once (deduped by name) for fresh and upgraded installs.
 */

export const EVENING_ROUTINE_ID = 'evening';
export const SOUND_BOOTH_ROUTINE_NAME = 'Brookfield First — Sound Booth';

export interface RoutineBundle {
  routine: Routine;
  steps: RoutineStep[];
  variants: RoutineVariant[];
}

export function buildEveningRoutine(now: number = Date.now()): Routine {
  return {
    id: EVENING_ROUTINE_ID,
    name: 'Evening routine',
    description: 'Wind-down checklist timed back from tonight’s target bedtime.',
    schedule: { anchor: 'bedtime' },
    isActive: true,
    sortOrder: 1,
    createdAt: now,
  };
}

export function buildDefaultVariant(routineId: string, now: number = Date.now()): RoutineVariant {
  return {
    id: crypto.randomUUID(),
    routineId,
    name: 'Full',
    description: '',
    stepIds: [],
    isDefault: true,
    sortOrder: 1,
    createdAt: now,
  };
}

interface SeedStep {
  name: string;
  description: string;
  secretNames?: string[];
}

/** Sunday-morning sound booth SOP, starting from a dark room. */
const SOUND_BOOTH_STEPS: SeedStep[] = [
  {
    name: 'House lights on',
    description:
      'Open the door to the booth and turn on all the house lights.\n\n' +
      'Press the All On button on the white lighting plate on the right wall of the booth.',
  },
  {
    name: 'Stage lights on',
    description:
      'On the lighting controller on top of the black rack in the middle of the table, ' +
      'slide the slider marked Stage Lights all the way up. Look at the stage to make sure ' +
      'the lights actually come on and the indicator reads 101.\n\n' +
      'If it does not read 101 or the lights don’t come on: unplug the lighting controller ' +
      'at the back of the controller. This plug is very tight, so pull hard. Once plugged back in, ' +
      'press the 10 or so buttons on the left side of the controller until they are all green. ' +
      'Then move the Stage Lights fader all the way down and back up again. This should engage ' +
      'the stage lights.',
  },
  {
    name: 'Sound board on',
    description:
      'Press the red Power button on the black rack.\n\n' +
      'Remove the cloth cover from the top of the sound board.',
  },
  {
    name: 'Amplifiers on',
    description:
      'Under the booth on the left side there is a light switch. Flip it on to turn on the amps.',
  },
  {
    name: 'Collect mics and the Uncased iPad',
    description:
      'In the closet on the right, take the microphones labeled Lead Vocal and Handheld. ' +
      'Depending on how many singers there are, also take Vocal 1 and Vocal 2.\n\n' +
      'Grab the Uncased iPad and walk to the stage.',
  },
  {
    name: 'Place mics on stage',
    description:
      'Lead Vocal goes in Ewan’s mic stand.\n\n' +
      'Vocal 1 and/or Vocal 2 go next to their boxes on the floor: Vocal 1 is to the right of ' +
      'the pulpit, Vocal 2 is behind Ewan next to the drums.\n\n' +
      'Put the Handheld mic on the front pew next to the wooden box.',
  },
  {
    name: 'Stage lights scene (BTAIR on Uncased iPad)',
    description:
      'Unlock the Uncased iPad (password below). Double-click the home button and swipe up on ' +
      'the BTAIR app to force close it. Reopen the app and tap Pair Now.\n\n' +
      'Once paired, tap the 3 tab at the bottom of the screen, then tap Sunday Morning. ' +
      'Check every light on stage to make sure it changed. If any did not change, force close ' +
      'the app and try again — this can take several attempts to get each light working.\n\n' +
      'Walk back to the booth with the Uncased iPad and put it back in the closet.',
    secretNames: ['Uncased iPad password'],
  },
  {
    name: 'House light levels (Lutron on Cased iPad)',
    description:
      'Unlock the Cased iPad (password below) and open the Lutron app. Scroll down and open ' +
      'the Equipment Room tab. Set each slider to:\n\n' +
      'Left front track row 1 – 35%\n' +
      'Left second row track – 35%\n' +
      '4th row track left – 35%\n' +
      '3rd row track left – 35%\n' +
      'Left wall spots – Off\n' +
      'Right wall spots – Off\n' +
      'Recess right side – 15%\n' +
      'Recess left side – 15%\n' +
      'Recess back – 15%\n' +
      'Back row hanging lights – 35%\n' +
      'Right front hanging lights – 35%\n' +
      'Left front hanging lights – 35%\n' +
      'Left back hanging lights – 35%\n' +
      'Center recess – 35%\n' +
      'Alter track recess – 100%\n' +
      'Chandelier – 35%\n' +
      'Rear alter recess – Off\n' +
      'Stage rear right – On\n' +
      'Stage center spot – On\n' +
      'Left stage lights – On\n' +
      'Unknown 4 – Off\n' +
      'Unknown 5 – Off\n' +
      'Cross chandelier – 100%\n' +
      'Right track row 1 – 35%\n' +
      'Right 2nd row track – 35%\n' +
      '4th row track right – 35%\n' +
      '3rd row track right – 35%',
    secretNames: ['Cased iPad password'],
  },
  {
    name: 'Booth lights and small iPad',
    description:
      'Flip the booth lighting switch under the table on the right-hand side — it looks ' +
      'just like the amplifier switch.\n\n' +
      'Put the Cased iPad back into the closet. Take the small iPad out of the closet, plug ' +
      'the 3.5mm jack into it, and place it on the small shelf at the top left of the board.',
  },
  {
    name: 'Recall the Sunday Morning scene',
    description:
      'On the board, tap the Scenes button at the lower right of the screen. Tap scene 1, ' +
      'Sunday Morning, then tap Recall.\n\n' +
      'Press the Processing button, then press the green Select button on Lead Vocal to ' +
      'return to the normal screen.',
  },
  {
    name: 'Start pre-service music',
    description:
      'On the small iPad, open Spotify. There may be several pop-ups about logging into ' +
      'iCloud — ignore and close them all. Play the Livestream Instrumental playlist.\n\n' +
      'On the board, unmute the mp3 channel and slowly slide the fader up until the music is ' +
      'at an acceptable level.',
  },
  {
    name: 'Practice: mute mp3, unmute band',
    description:
      'Once practice is beginning, mute the mp3 and unmute the Vocal, FX, and Instrumental ' +
      'mute clusters on the right side of the board.',
  },
  {
    name: '9:45 — mute everything but mp3',
    description:
      'At 9:45 the board MUST be fully muted except the mp3, and music must be playing. ' +
      'This goes to the livestream.',
  },
];

export function buildSoundBoothRoutine(now: number = Date.now()): RoutineBundle {
  const routine: Routine = {
    id: crypto.randomUUID(),
    name: SOUND_BOOTH_ROUTINE_NAME,
    description:
      'Sunday-morning sound booth setup, starting from a dark room. The board must be ' +
      'muted (mp3 only) with music playing by 9:45 for the livestream.',
    schedule: { anchor: 'time', deadlineHHMM: '09:45', daysOfWeek: [0] },
    isActive: true,
    sortOrder: 2,
    createdAt: now,
  };
  const steps: RoutineStep[] = SOUND_BOOTH_STEPS.map((s, i) => ({
    id: crypto.randomUUID(),
    routineId: routine.id,
    name: s.name,
    description: s.description,
    secretNames: s.secretNames ?? [],
    sortOrder: i + 1,
    isActive: true,
    createdAt: now,
  }));
  const variant: RoutineVariant = {
    ...buildDefaultVariant(routine.id, now),
    stepIds: steps.map((s) => s.id),
  };
  return { routine, steps, variants: [variant] };
}

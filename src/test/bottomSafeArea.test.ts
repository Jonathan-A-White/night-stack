import { describe, it, expect } from 'vitest';
import themeCss from '../theme.css?raw';

// Android Chrome with three-button navigation reports
// env(safe-area-inset-bottom) as 0 under viewport-fit=cover, so a bottom bar
// padded only by that inset sits under the phone's own Back/Home/Recents bar.
// jsdom cannot measure layout, so this reads the stylesheet: every rule that
// pins itself to the bottom edge must pad by max(env(...), 48px), directly or
// through a custom property that resolves to it.

const css = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');

const FLOOR = /max\(\s*env\(safe-area-inset-bottom(?:,\s*0(?:px)?)?\)\s*,\s*48px\s*\)/;

interface Rule {
  selector: string;
  body: string;
}

function rules(source: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

function declared(name: string): string | null {
  for (const r of rules(css)) {
    const m = r.body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    if (m && r.selector.includes(':root')) return m[1].trim();
  }
  return null;
}

/** Resolve var(--x) chains until the value stops changing. */
function resolveVars(value: string): string {
  let v = value;
  for (let i = 0; i < 5; i++) {
    const next = v.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole, name) => declared(name) ?? whole);
    if (next === v) break;
    v = next;
  }
  return v;
}

// A rule is bottom-fixed when it is position:fixed and sits on the bottom
// edge: bottom:0, or inset:0 with a bar-sized height (a full-screen scrim is
// an overlay, not a bar, and has no bar to hide).
function bottomFixed(r: Rule): boolean {
  if (!/position\s*:\s*fixed/.test(r.body)) return false;
  return /(^|[;\s])bottom\s*:\s*0(px)?\s*(;|$)/.test(r.body);
}

describe('bottom-fixed bars clear the phone navigation bar', () => {
  const bars = rules(css).filter(bottomFixed);

  it('finds the bottom tabs', () => {
    expect(bars.map((b) => b.selector)).toContain('.bottom-tabs');
  });

  for (const bar of bars) {
    it(`${bar.selector} pads its bottom by max(env(safe-area-inset-bottom), 48px)`, () => {
      const pad = bar.body.match(/padding-bottom\s*:\s*([^;]+);/);
      expect(pad, `${bar.selector} has no padding-bottom`).not.toBeNull();
      expect(resolveVars(pad![1])).toMatch(FLOOR);
    });
  }

  it('the content above the tabs reserves room for the floored bar', () => {
    const content = rules(css).find((r) => r.selector === '.app-content');
    const pad = content!.body.match(/padding-bottom\s*:\s*([^;]+);/)![1];
    expect(resolveVars(pad)).toMatch(FLOOR);
  });
});

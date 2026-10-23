import { describe, expect, it } from 'vitest';
import morningSource from '../pages/morning/MorningLog.tsx?raw';
import eveningSource from '../pages/tonight/EveningLog.tsx?raw';
import tonightSource from '../pages/tonight/TonightPlan.tsx?raw';
import type { FormSpec } from 'voice-kit/forms';
import {
  EVENING_FORM,
  EVENING_PAGES,
  MORNING_FORM,
  MORNING_PAGES,
  PAGE_SIZE,
  TONIGHT_FORM,
  TONIGHT_PAGES,
  pagesOf,
} from './formSpecs';

/** every `form-label` text of a page's source, in screen order */
function labelsOf(text: string): string[] {
  return [...text.matchAll(/<label className="form-label">\s*([^<]*[^<\s])/g)].map((m) => m[1]);
}

const fieldsOf = (pages: readonly FormSpec[]) => pages.flatMap((p) => p.fields);

describe('form specs: pages of at most 8 fields that cover the page', () => {
  it('cuts a form into pages of at most 8, in screen order, each named for its place', () => {
    const pages = pagesOf({ name: 'Ten', fields: Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, label: `F${i}`, required: false, kind: 'text' as const })) });
    expect(pages.map((p) => p.fields.length)).toEqual([8, 2]);
    expect(pages.map((p) => p.name)).toEqual(['Ten (1 of 2)', 'Ten (2 of 2)']);
    expect(pagesOf({ name: 'Three', fields: MORNING_FORM.fields.slice(0, 3) }).map((p) => p.name)).toEqual(['Three']);
  });

  it('every page of every form holds at most 8 fields and a name of at most 40 characters', () => {
    for (const page of [...MORNING_PAGES, ...EVENING_PAGES, ...TONIGHT_PAGES]) {
      expect(page.fields.length).toBeGreaterThan(0);
      expect(page.fields.length).toBeLessThanOrEqual(PAGE_SIZE);
      expect(page.name.length).toBeLessThanOrEqual(40);
    }
  });

  it("the Morning log's pages hold the label of every manual entry field, in screen order", () => {
    const text = morningSource;
    const manual = [...text.matchAll(/<label className="form-label">([^<]+)<\/label>\s*<(?:input|select)[^>]*?value=\{manualFields\.(\w+)\}/g)];
    expect(manual).toHaveLength(19);
    expect(fieldsOf(MORNING_PAGES).map((f) => [f.label, f.name])).toEqual(manual.map((m) => [m[1], m[2]]));
    expect(MORNING_FORM.fields).toEqual(fieldsOf(MORNING_PAGES));
  });

  it("the Evening log's pages hold the label of every labelled field of the log, in screen order", () => {
    const labels = labelsOf(eveningSource);
    expect(labels).toHaveLength(16);
    expect(fieldsOf(EVENING_PAGES).map((f) => f.label)).toEqual(labels);
    expect(EVENING_FORM.fields).toEqual(fieldsOf(EVENING_PAGES));
  });

  it("Tonight's plan pages hold the label of every labelled field of the plan, in screen order", () => {
    const labels = labelsOf(tonightSource);
    expect(labels).toHaveLength(7);
    expect(fieldsOf(TONIGHT_PAGES).map((f) => f.label)).toEqual(labels);
    expect(TONIGHT_FORM.fields).toEqual(fieldsOf(TONIGHT_PAGES));
  });

  it('a choice names its options, and no two fields of a form share a name', () => {
    for (const form of [MORNING_FORM, EVENING_FORM, TONIGHT_FORM]) {
      expect(new Set(form.fields.map((f) => f.name)).size).toBe(form.fields.length);
      for (const f of form.fields) if (f.kind === 'choice') expect(f.options?.length).toBeGreaterThan(1);
    }
  });
});

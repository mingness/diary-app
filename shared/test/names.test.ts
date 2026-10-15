import { describe, expect, it } from 'vitest';
import { personName } from '../src/names.js';

describe('personName', () => {
  it('writes Chinese names family first with no space', () => {
    expect(personName('陳', '明德')).toBe('陳明德');
    expect(personName('歐陽', '修')).toBe('歐陽修');
  });

  it('writes other names given name first with a space', () => {
    expect(personName('Smith', 'John')).toBe('John Smith');
    expect(personName('Chen', 'Claudine')).toBe('Claudine Chen');
    // Mixed scripts read as a Western-style name.
    expect(personName('陳', 'Claudine')).toBe('Claudine 陳');
  });

  it('uses whichever part is set, trimmed', () => {
    expect(personName(' 陳 ', '')).toBe('陳');
    expect(personName('', ' John ')).toBe('John');
    expect(personName('', '')).toBe('');
  });
});

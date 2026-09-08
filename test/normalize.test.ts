import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/normalize';

describe('normalizeText', () => {
  it('normalizes typography, case and whitespace', () => {
    expect(normalizeText('  Human’s  “Example” —  HERE  ')).toBe(
      'human\'s "example" - here',
    );
  });
});

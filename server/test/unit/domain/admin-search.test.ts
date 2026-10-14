import { describe, expect, it } from 'vitest';
import { usernamePatternToLike } from '../../../src/domain/admin/search.js';

/** Interprets a LIKE pattern the way PostgreSQL does (with `\` escapes), to test what actually matches. */
function likeMatches(like: string, value: string): boolean {
  let re = '';
  for (let i = 0; i < like.length; i++) {
    const ch = like[i]!;
    if (ch === '\\') re += like[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i').test(value);
}

describe('usernamePatternToLike', () => {
  it.each([
    // [pattern, matches, does not match]
    ['chen', ['chen', 'chenmd', 'xchen'], ['che', 'chn']],
    ['chen*', ['chen', 'chenmd'], ['xchen']],
    ['*md', ['chenmd', 'md'], ['mdx']],
    ['user?', ['user1', 'userx'], ['user', 'user12']],
    ['u??r', ['user', 'uaar'], ['usr', 'useer']],
    ['*', ['anything', 'a'], []],
  ])('%j', (pattern, yes, no) => {
    const like = usernamePatternToLike(pattern);
    for (const v of yes) expect(likeMatches(like, v), `${pattern} should match ${v}`).toBe(true);
    for (const v of no)
      expect(likeMatches(like, v), `${pattern} should not match ${v}`).toBe(false);
  });

  it('treats % and _ typed by the admin as literal characters, not SQL wildcards', () => {
    expect(likeMatches(usernamePatternToLike('a_b'), 'a_b')).toBe(true);
    expect(likeMatches(usernamePatternToLike('a_b'), 'axb')).toBe(false);
    expect(likeMatches(usernamePatternToLike('100%'), 'x100%y')).toBe(true);
    expect(likeMatches(usernamePatternToLike('100%'), '100abc')).toBe(false);
    expect(likeMatches(usernamePatternToLike('a\\b'), 'a\\b')).toBe(true);
  });

  it('ignores surrounding spaces', () => {
    expect(usernamePatternToLike('  chen  ')).toBe('%chen%');
  });
});

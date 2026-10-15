/**
 * How a person's name is written, everywhere it is shown (lists, comments, the account page). The order follows
 * the name's own script, not the UI language: names in Chinese, Japanese or Korean characters are written
 * family name first with no space (陳明德), as their readers expect in either language; other names given name
 * first with a space (John Smith).
 */
const EAST_ASIAN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}·・]+$/u;

export function personName(familyName: string, givenName: string): string {
  const family = familyName.trim();
  const given = givenName.trim();
  if (!family || !given) return family || given;
  return EAST_ASIAN.test(family) && EAST_ASIAN.test(given)
    ? `${family}${given}`
    : `${given} ${family}`;
}

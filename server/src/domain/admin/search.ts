/**
 * The SYS_ADMIN username search (spec §6.5): `?` matches exactly one character and `*` any run of characters.
 * Without wildcards the text matches anywhere in the username, which is what people expect from a search box.
 */

/** Converts the admin's pattern to a SQL LIKE pattern, using `\` as the escape character. */
export function usernamePatternToLike(pattern: string): string {
  const escaped = pattern.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const hasWildcards = /[*?]/.test(escaped);
  const like = escaped.replace(/\*/g, '%').replace(/\?/g, '_');
  return hasWildcards ? like : `%${like}%`;
}

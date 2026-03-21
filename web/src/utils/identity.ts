/**
 * Derive a display name from an email address.
 *
 * Takes the local part (before @), replaces dots/underscores/hyphens with spaces,
 * and title-cases the result.
 *
 * e.g. 'karthik.s@gmail.com' → 'Karthik S'
 *      'ravi@gmail.com'      → 'Ravi'
 *      'john_doe@company.io' → 'John Doe'
 */
export function nameFromEmail(email: string): string {
  const local = email.includes("@") ? (email.split("@")[0] ?? email) : email;
  return local
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Text to moderate for a listing: the detail page shows `description`, cards and search show the plain text — check both (once when equal). */
export function listingModerationText(title: string, description: unknown, plain: string | undefined): string {
  const parts = [title];
  if (typeof description === 'string' && description) parts.push(description);
  if (plain && plain !== description) parts.push(plain);
  return parts.join('\n\n');
}

/**
 * Utility functions for handling user ID extraction across different auth formats
 * Supports: NextAuth IDs, MongoDB ObjectIds, and string IDs
 */

/**
 * Extracts user ID from various user object formats
 * @param user - User object or ID string
 * @returns Extracted ID string or null
 */
function extractUserId(user: any): string | null {
  if (!user) return null;
  if (typeof user === 'string') return user;
  if (user.id) return user.id;
  if (user._id) return typeof user._id === 'string' ? user._id : user._id.toString();
  return null;
}

/**
 * Checks if the current user is the owner of an item
 * @param itemAuthor - Author field from the item (can be object or string)
 * @param currentUser - Current user from session
 * @returns True if user owns the item
 */
export function isOwner(itemAuthor: any, currentUser: any): boolean {
  const authorId = extractUserId(itemAuthor);
  const userId = extractUserId(currentUser);
  return !!(userId && authorId && userId === authorId);
}

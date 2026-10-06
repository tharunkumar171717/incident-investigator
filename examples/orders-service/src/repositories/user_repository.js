// In-memory stand-in for the users table.
const users = new Map([
  ["u_100", { id: "u_100", email: "ada@example.com", deletedAt: null }],
  ["u_200", { id: "u_200", email: "grace@example.com", deletedAt: null }],
  ["u_300", { id: "u_300", email: "linus@example.com", deletedAt: "2026-09-30T12:00:00Z" }],
]);

/**
 * Returns the active user, or null when the user does not exist or was
 * soft-deleted. (Before v1.4 this threw a NotFoundError.)
 */
function getUser(id) {
  const user = users.get(id);
  if (!user || user.deletedAt) return null;
  return user;
}

module.exports = { getUser };

export async function hashPassword(password) {
  // Simulate hashing
  return `hashed_${password}`;
}

export async function verifyPassword(password, hash) {
  return hash === `hashed_${password}`;
}

export function formatDate(date) {
  if (date instanceof Date) {
    return date.toISOString();
  }
  return new Date(date).toISOString();
}

export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

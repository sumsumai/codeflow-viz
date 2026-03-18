const { hashPassword, verifyPassword } = require("./utils");
const { createSession } = require("./session");
const { findUserByEmail } = require("./database");

export async function login(email, password) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error("User not found");
  }

  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    throw new Error("Invalid password");
  }

  const session = await createSession(user.id);
  return { user, token: session.token };
}

export async function register(email, password, name) {
  const existing = await findUserByEmail(email);

  if (existing) {
    throw new Error("Email already in use");
  }

  const hash = await hashPassword(password);
  const user = await createUser({ email, passwordHash: hash, name });
  const session = await createSession(user.id);

  return { user, token: session.token };
}

export function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

async function createUser(data) {
  // Simulate DB insert
  return { id: Math.random().toString(36), ...data };
}

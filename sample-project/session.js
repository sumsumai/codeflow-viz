const { generateId } = require("./utils");

const sessions = new Map();

export function createSession(userId) {
  const token = generateId();
  const session = {
    id: generateId(),
    userId,
    token,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  sessions.set(token, session);
  return session;
}

export function getSession(token) {
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt < new Date()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

export function destroySession(token) {
  return sessions.delete(token);
}

export function cleanExpiredSessions() {
  const now = new Date();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

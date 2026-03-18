const { login, register, validateEmail } = require("./auth");
const { getSession, destroySession } = require("./session");
const { findUserById } = require("./database");
const { formatDate } = require("./utils");

export async function handleLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const result = await login(email, password);
    res.json({
      user: sanitizeUser(result.user),
      token: result.token,
    });
  } catch (err) {
    if (err.message === "User not found" || err.message === "Invalid password") {
      res.status(401).json({ error: "Invalid credentials" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

export async function handleRegister(req, res) {
  try {
    const { email, password, name } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const result = await register(email, password, name);
    res.status(201).json({
      user: sanitizeUser(result.user),
      token: result.token,
    });
  } catch (err) {
    if (err.message === "Email already in use") {
      res.status(409).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

export async function handleGetProfile(req, res) {
  const session = getSession(req.headers.authorization);

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await findUserById(session.userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({ user: sanitizeUser(user) });
}

export async function handleLogout(req, res) {
  const token = req.headers.authorization;

  if (token) {
    destroySession(token);
  }

  res.json({ success: true });
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: formatDate(user.createdAt),
  };
}

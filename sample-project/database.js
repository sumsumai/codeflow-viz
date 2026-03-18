const users = new Map();

export async function findUserByEmail(email) {
  for (const user of users.values()) {
    if (user.email === email) {
      return user;
    }
  }
  return null;
}

export async function findUserById(id) {
  return users.get(id) || null;
}

export async function saveUser(user) {
  users.set(user.id, user);
  return user;
}

export async function deleteUser(id) {
  const user = users.get(id);
  if (!user) {
    throw new Error("User not found");
  }
  users.delete(id);
  return user;
}

export async function listUsers(options = {}) {
  let result = Array.from(users.values());

  if (options.limit) {
    result = result.slice(0, options.limit);
  }

  if (options.sortBy) {
    result.sort((a, b) => {
      if (a[options.sortBy] < b[options.sortBy]) return -1;
      if (a[options.sortBy] > b[options.sortBy]) return 1;
      return 0;
    });
  }

  return result;
}

const state = {
  token: localStorage.getItem("chat_token") || null,
  username: localStorage.getItem("chat_username") || null,
  socket: null,
  activeChatWith: null,
  onlineUsernames: new Set(),
};

const el = (id) => document.getElementById(id);

/* ---------------- small fetch helper ---------------- */

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ---------------- auth screen ---------------- */

function showScreen(name) {
  el("auth-screen").classList.toggle("hidden", name !== "auth");
  el("chat-screen").classList.toggle("hidden", name !== "chat");
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const isLogin = btn.dataset.tab === "login";
    el("login-form").classList.toggle("hidden", !isLogin);
    el("register-form").classList.toggle("hidden", isLogin);
  });
});

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("login-error").textContent = "";
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: {
        username: el("login-username").value.trim(),
        password: el("login-password").value,
      },
    });
    onAuthenticated(data);
  } catch (err) {
    el("login-error").textContent = err.message;
  }
});

el("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("register-error").textContent = "";
  try {
    const data = await api("/api/register", {
      method: "POST",
      body: {
        username: el("register-username").value.trim(),
        password: el("register-password").value,
      },
    });
    onAuthenticated(data);
  } catch (err) {
    el("register-error").textContent = err.message;
  }
});

el("logout-btn").addEventListener("click", () => {
  localStorage.removeItem("chat_token");
  localStorage.removeItem("chat_username");
  if (state.socket) state.socket.disconnect();
  state.token = null;
  state.username = null;
  state.activeChatWith = null;
  showScreen("auth");
});

function onAuthenticated({ token, username }) {
  state.token = token;
  state.username = username;
  localStorage.setItem("chat_token", token);
  localStorage.setItem("chat_username", username);
  enterChat();
}

/* ---------------- chat screen ---------------- */

function enterChat() {
  el("current-username").textContent = state.username;
  showScreen("chat");
  connectSocket();
  loadUserList();
}

function connectSocket() {
  state.socket = io({ auth: { token: state.token } });

  state.socket.on("presence", ({ username, online }) => {
    if (online) state.onlineUsernames.add(username);
    else state.onlineUsernames.delete(username);
    renderUserListDots();
  });

  state.socket.on("private_message", (msg) => {
    const partner = msg.from === state.username ? msg.to : msg.from;
    if (partner === state.activeChatWith) {
      appendMessage(msg);
    }
  });

  state.socket.on("connect_error", (err) => {
    console.error("Socket auth failed:", err.message);
  });
}

async function loadUserList() {
  const users = await api("/api/users");
  const list = el("user-list");
  list.innerHTML = "";

  users.forEach(({ username }) => {
    const li = document.createElement("li");
    li.dataset.username = username;
    li.innerHTML = `<span class="dot"></span><span>${escapeHtml(username)}</span>`;
    li.addEventListener("click", () => openConversation(username));
    list.appendChild(li);
  });

  renderUserListDots();
}

function renderUserListDots() {
  document.querySelectorAll("#user-list li").forEach((li) => {
    const dot = li.querySelector(".dot");
    dot.classList.toggle("online", state.onlineUsernames.has(li.dataset.username));
  });
}

async function openConversation(withUsername) {
  state.activeChatWith = withUsername;

  document.querySelectorAll("#user-list li").forEach((li) => {
    li.classList.toggle("active", li.dataset.username === withUsername);
  });

  el("conversation-header").textContent = withUsername;
  el("message-form").classList.remove("hidden");

  const messages = el("messages");
  messages.innerHTML = "";

  const history = await api(`/api/messages/${encodeURIComponent(withUsername)}`);
  history.forEach(appendMessage);
}

function appendMessage(msg) {
  const messages = el("messages");
  const div = document.createElement("div");
  const mine = msg.from === state.username;
  div.className = `msg ${mine ? "mine" : "theirs"}`;

  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  div.innerHTML = `${escapeHtml(msg.content)}<time>${time}</time>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

el("message-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = el("message-input");
  const content = input.value.trim();
  if (!content || !state.activeChatWith) return;

  state.socket.emit("private_message", { to: state.activeChatWith, content });
  input.value = "";
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- boot ---------------- */

if (state.token && state.username) {
  enterChat();
} else {
  showScreen("auth");
}

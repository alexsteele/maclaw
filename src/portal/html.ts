// Renders the minimal browser portal shell served by `maclaw server`.
// See `docs/web-portal.md`.
import type { PortalRenderOptions } from "./types.js";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const renderProjectOptions = (
  projects: PortalRenderOptions["projects"],
  currentProject?: string,
): string => {
  if (projects.length === 0) {
    return '<option value="">No projects</option>';
  }

  return projects
    .map((project) => {
      const selected = project.name === currentProject ? " selected" : "";
      const label = project.isDefault ? `${project.name} (default)` : project.name;
      return `<option value="${escapeHtml(project.name)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
};

const serializeForScript = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

export const renderPortalHtml = ({
  currentProject,
  projects,
}: PortalRenderOptions): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>maclaw portal</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f5f7fb;
        --bg-soft: #eef2f8;
        --panel: #ffffff;
        --panel-2: #f8fafc;
        --border: #d6deea;
        --border-strong: #c3cedc;
        --text: #111827;
        --muted: #677489;
        --accent: #2563eb;
        --accent-soft: #dbe9ff;
        --shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
        --radius: 18px;
        --font-ui: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --font-mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0b1220;
          --bg-soft: #111a2b;
          --panel: #0f172a;
          --panel-2: #131d33;
          --border: #243046;
          --border-strong: #33425d;
          --text: #e5edf8;
          --muted: #9ba9be;
          --accent: #60a5fa;
          --accent-soft: rgba(96, 165, 250, 0.14);
          --shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
        }
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 28rem),
          linear-gradient(180deg, var(--bg-soft) 0%, var(--bg) 100%);
        color: var(--text);
        font: 14px/1.5 var(--font-ui);
      }

      .shell {
        display: grid;
        grid-template-columns: 248px minmax(0, 1fr) 300px;
        height: 100vh;
        overflow: hidden;
      }

      .sidebar {
        border-right: 1px solid var(--border);
        padding: 20px 18px;
        background: color-mix(in srgb, var(--panel) 84%, transparent);
        backdrop-filter: blur(10px);
      }

      .brand {
        margin: 0 0 6px;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.03em;
      }

      .lede {
        margin: 0 0 22px;
        color: var(--muted);
        font-size: 13px;
      }

      .main {
        padding: 18px;
        min-width: 0;
        min-height: 0;
      }

      .stack {
        display: grid;
        gap: 14px;
      }

      .card {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow);
        padding: 15px;
      }

      .card h2,
      .card h3 {
        margin: 0 0 10px;
        font-size: 14px;
      }

      .meta {
        color: var(--muted);
        font-size: 13px;
      }

      .sidebar-section-title {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .nav-list {
        display: grid;
        gap: 8px;
      }

      .nav-item {
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel-2);
      }

      .nav-item strong {
        display: block;
        margin-bottom: 2px;
        font-size: 13px;
      }

      .nav-item span {
        color: var(--muted);
        font-size: 12px;
      }

      .chat-app {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        height: calc(100vh - 36px);
        min-height: 0;
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--panel);
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--border);
        background: linear-gradient(180deg, var(--panel-2), transparent);
      }

      .chat-header h2 {
        margin: 0;
        font-size: 18px;
        letter-spacing: -0.02em;
      }

      .chat-subtitle {
        color: var(--muted);
        font-size: 13px;
      }

      .chat-status {
        color: var(--muted);
        font-size: 12px;
      }

      .transcript {
        min-height: 0;
        padding: 18px;
        display: grid;
        align-content: start;
        gap: 12px;
        overflow: auto;
        background:
          linear-gradient(180deg, rgba(37, 99, 235, 0.04), transparent 18rem),
          var(--panel);
      }

      .message {
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 12px 14px;
        background: var(--panel-2);
        max-width: 46rem;
        white-space: pre-wrap;
      }

      .message-user {
        justify-self: end;
        background: var(--accent-soft);
        border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
      }

      .message strong {
        display: block;
        margin-bottom: 4px;
        font-size: 11px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .empty-state {
        color: var(--muted);
        border: 1px dashed var(--border-strong);
        border-radius: 16px;
        padding: 18px;
        background: var(--panel-2);
      }

      .composer {
        padding: 14px 18px 18px;
        border-top: 1px solid var(--border);
        background: var(--panel);
      }

      label {
        display: block;
        margin-bottom: 6px;
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      select,
      textarea,
      button {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--border);
        font: inherit;
      }

      select,
      textarea {
        background: var(--panel);
        color: var(--text);
        padding: 10px 12px;
      }

      textarea {
        min-height: 112px;
        resize: vertical;
        line-height: 1.55;
      }

      button {
        margin-top: 10px;
        padding: 11px 14px;
        color: white;
        background: var(--accent);
        border-color: var(--accent);
        cursor: pointer;
        font-weight: 600;
      }

      .pill {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 600;
      }

      .inspector {
        border-left: 1px solid var(--border);
        padding: 18px 16px;
        background: color-mix(in srgb, var(--panel) 92%, transparent);
        overflow: auto;
      }

      .inspector h2 {
        margin: 0 0 14px;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }

      .stat {
        display: grid;
        gap: 3px;
      }

      .stat strong {
        font-size: 13px;
      }

      .stat span {
        color: var(--muted);
        font-size: 12px;
      }

      .code {
        font-family: var(--font-mono);
        font-size: 12px;
      }

      @media (max-width: 900px) {
        .shell {
          grid-template-columns: 1fr;
        }

        .sidebar {
          border-right: 0;
          border-bottom: 1px solid var(--border);
        }

        .inspector {
          border-left: 0;
          border-top: 1px solid var(--border);
        }

        .chat-app {
          height: auto;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar">
        <h1 class="brand">maclaw</h1>
        <p class="lede">maclaw is your AI workspace.</p>
        <div class="stack">
          <section class="card">
            <h2>Workspace</h2>
            <label for="project-select">Current project</label>
            <select id="project-select" name="project">
              ${renderProjectOptions(projects, currentProject)}
            </select>
          </section>
          <section class="card">
            <p class="sidebar-section-title">Chat-first layout</p>
            <div class="nav-list">
              <div class="nav-item">
                <strong>Main chat</strong>
                <span>The primary interaction surface.</span>
              </div>
              <div class="nav-item">
                <strong>Agents</strong>
                <span>Visible, but secondary.</span>
              </div>
              <div class="nav-item">
                <strong>Tasks</strong>
                <span>Kept close without crowding the chat.</span>
              </div>
            </div>
          </section>
        </div>
      </aside>
      <main class="main">
        <section class="chat-app">
          <header class="chat-header">
            <div>
              <h2>Chat</h2>
              <div class="chat-subtitle">Front and center, with agent and task context nearby.</div>
              <div class="chat-status" id="chat-status">Loading chat…</div>
            </div>
            <span class="pill">web channel</span>
          </header>
          <div class="transcript" id="transcript"></div>
          <div class="composer">
            <label for="message">Message</label>
            <textarea id="message" placeholder="Send a message to maclaw..."></textarea>
            <button type="button" id="send-button">Send</button>
          </div>
        </section>
      </main>
      <aside class="inspector">
        <h2>Context</h2>
        <div class="stack">
          <section class="card">
            <h3>Agents</h3>
            <div class="stat">
              <strong>Monitor and steer</strong>
              <span>List, create, pause, resume, stop, and steer agents from this side panel.</span>
            </div>
          </section>
          <section class="card">
            <h3>Tasks</h3>
            <div class="stat">
              <strong>Scheduled work</strong>
              <span>Create and manage recurring or one-off tasks without leaving the chat.</span>
            </div>
          </section>
          <section class="card">
            <h3>Notifications</h3>
            <div class="stat">
              <strong>Live events</strong>
              <span>Agent and task lifecycle events will stream here in real time.</span>
            </div>
          </section>
          <section class="card">
            <h3>Theme</h3>
            <p class="meta">Default to a clean white IDE-style look. Dark mode follows system preference.</p>
            <p class="code">prefers-color-scheme</p>
          </section>
        </div>
      </aside>
    </div>
    <script>
      const portalState = ${serializeForScript({
        chatId: "web",
        currentProject,
        projects,
      })};

      const projectSelect = document.getElementById("project-select");
      const transcript = document.getElementById("transcript");
      const status = document.getElementById("chat-status");
      const messageInput = document.getElementById("message");
      const sendButton = document.getElementById("send-button");
      let displayMessages = [];
      let persistedMessageCount = 0;

      const escapeHtml = (value) =>
        value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");

      const renderMessages = () => {
        if (displayMessages.length === 0) {
          transcript.innerHTML = '<div class="empty-state">No messages yet. Start the conversation here.</div>';
          return;
        }

        transcript.innerHTML = displayMessages.map((message) => {
          const userClass = message.role === "user" ? " message-user" : "";
          return [
            '<article class="message' + userClass + '">',
            '<strong>' + escapeHtml(message.role) + '</strong>',
            escapeHtml(message.content),
            '</article>',
          ].join("");
        }).join("");
        transcript.scrollTop = transcript.scrollHeight;
      };

      const currentProject = () => projectSelect.value || portalState.currentProject || "";

      const loadChat = async () => {
        const project = currentProject();
        if (!project) {
          status.textContent = "No project selected.";
          renderMessages([]);
          return;
        }

        status.textContent = "Loading chat…";
        const response = await fetch('/api/projects/' + encodeURIComponent(project) + '/chats/' + encodeURIComponent(portalState.chatId));
        const data = await response.json();
        displayMessages = data.chat?.messages || [];
        persistedMessageCount = displayMessages.length;
        renderMessages();
        status.textContent = project + ' / ' + portalState.chatId;
      };

      const sendMessage = async () => {
        const project = currentProject();
        const text = messageInput.value.trim();
        if (!project || !text) {
          return;
        }

        sendButton.disabled = true;
        status.textContent = "Sending…";

        const response = await fetch(
          '/api/projects/' + encodeURIComponent(project) + '/chats/' + encodeURIComponent(portalState.chatId) + '/messages',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          },
        );
        const data = await response.json();
        messageInput.value = "";
        if (data.command) {
          displayMessages = [
            ...displayMessages,
            { role: 'user', content: data.command.text },
            { role: 'assistant', content: data.command.reply },
          ];
        } else {
          const nextMessages = data.chat?.messages || [];
          if (nextMessages.length < persistedMessageCount) {
            displayMessages = nextMessages;
          } else {
            displayMessages = [
              ...displayMessages,
              ...nextMessages.slice(persistedMessageCount),
            ];
          }
          persistedMessageCount = nextMessages.length;
        }
        renderMessages();
        status.textContent = project + ' / ' + portalState.chatId;
        sendButton.disabled = false;
        messageInput.focus();
      };

      projectSelect.addEventListener('change', () => {
        void loadChat();
      });

      sendButton.addEventListener('click', () => {
        void sendMessage();
      });

      messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          void sendMessage();
        }
      });

      void loadChat();
    </script>
  </body>
</html>
`;

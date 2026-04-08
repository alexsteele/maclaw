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
      const label = project.name;
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

      body[data-theme="dark"] {
        --bg: #16181d;
        --bg-soft: #1b1e24;
        --panel: #20242b;
        --panel-2: #262b33;
        --border: #353c47;
        --border-strong: #454e5c;
        --text: #e7ebf2;
        --muted: #a1a9b7;
        --accent: #7aa2f7;
        --accent-soft: rgba(122, 162, 247, 0.14);
        --shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
      }

      @media (prefers-color-scheme: dark) {
        body:not([data-theme="light"]) {
          --bg: #16181d;
          --bg-soft: #1b1e24;
          --panel: #20242b;
          --panel-2: #262b33;
          --border: #353c47;
          --border-strong: #454e5c;
          --text: #e7ebf2;
          --muted: #a1a9b7;
          --accent: #7aa2f7;
          --accent-soft: rgba(122, 162, 247, 0.14);
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

      .nav-item,
      .chat-link,
      .theme-button {
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel-2);
      }

      .chat-link,
      .theme-button {
        width: 100%;
        color: var(--text);
        text-align: left;
        cursor: pointer;
      }

      .chat-link.is-active,
      .theme-button.is-active {
        border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
        background: var(--accent-soft);
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

      .chat-list,
      .tab-list {
        display: grid;
        gap: 8px;
      }

      .tab-list {
        gap: 2px;
      }

      .tab-button {
        width: 100%;
        margin: 0;
        padding: 8px 10px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--muted);
        text-align: left;
        cursor: pointer;
        font-weight: 500;
      }

      .tab-button:hover {
        background: color-mix(in srgb, var(--panel-2) 75%, transparent);
        color: var(--text);
      }

      .tab-button.is-active {
        background: var(--accent-soft);
        color: var(--text);
      }

      .chat-link strong {
        display: block;
        margin-bottom: 3px;
        font-size: 13px;
      }

      .chat-link span {
        display: block;
        color: var(--muted);
        font-size: 12px;
      }

      .sidebar-panel {
        display: none;
      }

      .sidebar-panel.is-active {
        display: grid;
        gap: 10px;
      }

      .empty-mini {
        color: var(--muted);
        font-size: 12px;
        border: 1px dashed var(--border-strong);
        border-radius: 12px;
        padding: 12px;
        background: var(--panel-2);
      }

      .sidebar-note {
        margin: 0 0 10px;
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
        min-height: 44px;
        height: 44px;
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
        display: flex;
        flex-direction: column;
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

      .theme-spacer {
        flex: 1 1 auto;
      }

      .theme-toggle {
        width: auto;
        min-width: 0;
        margin-top: 0;
        background: var(--panel-2);
        color: var(--text);
        border-color: var(--border);
      }

      .theme-footer {
        margin-top: auto;
        display: flex;
        justify-content: flex-end;
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
            <p class="sidebar-section-title">Browse</p>
            <div class="tab-list">
              <button type="button" class="tab-button is-active" data-tab="agents">Agents</button>
              <button type="button" class="tab-button" data-tab="tasks">Tasks</button>
              <button type="button" class="tab-button" data-tab="inbox">Inbox</button>
            </div>
          </section>
          <section class="card">
            <p class="sidebar-section-title">Recent chats</p>
            <p class="sidebar-note">Use <code>/chat switch</code> or <code>/chat fork</code> in the chat to manage chats.</p>
            <div class="chat-list" id="chat-list">
              <div class="empty-mini">Loading chats…</div>
            </div>
          </section>
          <section class="card">
            <div class="sidebar-panel is-active" id="panel-agents">
              <p class="sidebar-section-title">Agents</p>
              <div class="nav-list">
                <div class="nav-item">
                  <strong>Pause, resume, steer</strong>
                  <span>Keep active agents close to the chat.</span>
                </div>
              </div>
            </div>
            <div class="sidebar-panel" id="panel-tasks">
              <p class="sidebar-section-title">Tasks</p>
              <div class="nav-list">
                <div class="nav-item">
                  <strong>Scheduled work</strong>
                  <span>Quick access to one-off and recurring tasks.</span>
                </div>
              </div>
            </div>
            <div class="sidebar-panel" id="panel-inbox">
              <p class="sidebar-section-title">Inbox</p>
              <div class="nav-list">
                <div class="nav-item">
                  <strong>Notifications</strong>
                  <span>Recent agent and task events land here.</span>
                </div>
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
        <h2>Appearance</h2>
        <div class="theme-spacer"></div>
        <div class="theme-footer">
          <button type="button" class="theme-toggle" id="theme-toggle">Dark mode</button>
        </div>
      </aside>
    </div>
    <script>
      const portalState = ${serializeForScript({
        currentProject,
        projects,
      })};

      const projectSelect = document.getElementById("project-select");
      const transcript = document.getElementById("transcript");
      const status = document.getElementById("chat-status");
      const messageInput = document.getElementById("message");
      const sendButton = document.getElementById("send-button");
      const chatList = document.getElementById("chat-list");
      const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
      const sidebarPanels = {
        agents: document.getElementById('panel-agents'),
        tasks: document.getElementById('panel-tasks'),
        inbox: document.getElementById('panel-inbox'),
      };
      const themeToggle = document.getElementById("theme-toggle");
      let displayMessages = [];
      let persistedMessageCount = 0;
      let eventSource;
      let currentChatId = "";

      const chatStorageKey = (project) => 'maclaw-portal-chat:' + project;

      const escapeHtml = (value) =>
        value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");

      const readStoredChatId = (project) => {
        if (!project) {
          return "";
        }

        const projectSummary = portalState.projects.find((entry) => entry.name === project);
        return window.localStorage.getItem(chatStorageKey(project)) || projectSummary?.defaultChatId || "default";
      };

      const saveCurrentChatId = () => {
        const project = currentProject();
        if (!project) {
          return;
        }

        window.localStorage.setItem(chatStorageKey(project), currentChatId);
      };

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

      const renderChatList = (chats) => {
        if (!chatList) {
          return;
        }

        if (!chats.length) {
          chatList.innerHTML = '<div class="empty-mini">No chats yet.</div>';
          return;
        }

        chatList.innerHTML = chats.map((chat) => {
          const activeClass = chat.id === currentChatId ? ' is-active' : '';
          return [
            '<button type="button" class="chat-link' + activeClass + '" data-chat-id="' + escapeHtml(chat.id) + '">',
            '<strong>' + escapeHtml(chat.id) + '</strong>',
            '<span>' + String(chat.messageCount) + ' messages</span>',
            '</button>',
          ].join('');
        }).join('');

        for (const element of chatList.querySelectorAll('.chat-link')) {
          element.addEventListener('click', () => {
            currentChatId = element.getAttribute('data-chat-id') || readStoredChatId(currentProject());
            saveCurrentChatId();
            showLoadingChat('Loading chat…');
            void loadChat();
          });
        }
      };

      const appendNotification = (text) => {
        displayMessages = [
          ...displayMessages,
          { role: 'assistant', content: text },
        ];
        renderMessages();
      };

      const showLoadingChat = (message) => {
        displayMessages = [];
        persistedMessageCount = 0;
        renderMessages();
        status.textContent = message;
      };

      const currentProject = () => projectSelect.value || portalState.currentProject || "";

      const applyTheme = (theme) => {
        document.body.setAttribute('data-theme', theme);
        if (themeToggle) {
          themeToggle.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
        }
        window.localStorage.setItem('maclaw-theme', theme);
      };

      const setActiveTab = (tabName) => {
        for (const button of tabButtons) {
          button.classList.toggle('is-active', button.getAttribute('data-tab') === tabName);
        }

        for (const [name, panel] of Object.entries(sidebarPanels)) {
          panel?.classList.toggle('is-active', name === tabName);
        }
      };

      const loadChats = async () => {
        const project = currentProject();
        if (!project) {
          renderChatList([]);
          return [];
        }

        const response = await fetch('/api/projects/' + encodeURIComponent(project) + '/chats');
        const data = await response.json();
        const chats = data.chats || [];
        renderChatList(chats);
        return chats;
      };

      const chooseCurrentChatId = (chats) => {
        const project = currentProject();
        const storedChatId = readStoredChatId(project);
        if (chats.some((chat) => chat.id === currentChatId)) {
          return;
        }

        if (chats.some((chat) => chat.id === storedChatId)) {
          currentChatId = storedChatId;
          saveCurrentChatId();
          return;
        }

        if (chats.length > 0) {
          currentChatId = chats[0].id;
          saveCurrentChatId();
          return;
        }

        currentChatId = storedChatId;
        saveCurrentChatId();
      };

      const updateChatFromCommandReply = (reply) => {
        const switchedMatch = reply.match(/^switched to chat: (.+)$/m);
        if (switchedMatch?.[1]) {
          currentChatId = switchedMatch[1].trim();
          saveCurrentChatId();
          return true;
        }

        const forkedMatch = reply.match(/^forked current chat to: (.+)$/m);
        if (forkedMatch?.[1]) {
          currentChatId = forkedMatch[1].trim();
          saveCurrentChatId();
          return true;
        }

        return false;
      };

      const connectEvents = () => {
        if (eventSource) {
          eventSource.close();
        }

        const project = currentProject();
        if (!project) {
          return;
        }

        eventSource = new EventSource(
          '/api/projects/' + encodeURIComponent(project) + '/chats/' + encodeURIComponent(currentChatId) + '/events',
        );
        eventSource.addEventListener('notification', (event) => {
          const data = JSON.parse(event.data || '{}');
          if (data.text) {
            appendNotification(data.text);
          }
        });
      };

      const loadChat = async () => {
        const project = currentProject();
        if (!project) {
          status.textContent = "No project selected.";
          displayMessages = [];
          renderMessages();
          return;
        }

        showLoadingChat("Loading chat…");
        const chats = await loadChats();
        chooseCurrentChatId(chats);
        const response = await fetch('/api/projects/' + encodeURIComponent(project) + '/chats/' + encodeURIComponent(currentChatId));
        const data = await response.json();
        displayMessages = data.chat?.messages || [];
        persistedMessageCount = displayMessages.length;
        renderMessages();
        status.textContent = project + ' / ' + currentChatId;
        connectEvents();
      };

      const sendMessage = async () => {
        const project = currentProject();
        const text = messageInput.value.trim();
        if (!project || !text) {
          return;
        }

        displayMessages = [
          ...displayMessages,
          { role: 'user', content: text },
          { role: 'assistant', content: '...' },
        ];
        renderMessages();
        sendButton.disabled = true;
        status.textContent = "Sending…";
        messageInput.value = "";

        const response = await fetch(
          '/api/projects/' + encodeURIComponent(project) + '/chats/' + encodeURIComponent(currentChatId) + '/messages',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          },
        );
        const data = await response.json();
        if (data.command) {
          if (updateChatFromCommandReply(data.command.reply)) {
            await loadChat();
          } else {
            displayMessages = [
              ...displayMessages.slice(0, -2),
              { role: 'user', content: data.command.text },
              { role: 'assistant', content: data.command.reply },
            ];
            renderMessages();
            status.textContent = project + ' / ' + currentChatId;
            await loadChats();
          }
        } else {
          const nextMessages = data.chat?.messages || [];
          if (nextMessages.length < persistedMessageCount) {
            displayMessages = nextMessages;
          } else {
            displayMessages = [
              ...displayMessages.slice(0, -2),
              ...nextMessages.slice(persistedMessageCount),
            ];
          }
          persistedMessageCount = nextMessages.length;
          renderMessages();
          status.textContent = project + ' / ' + currentChatId;
          await loadChats();
        }
        sendButton.disabled = false;
        messageInput.focus();
      };

      projectSelect.addEventListener('change', () => {
        currentChatId = readStoredChatId(currentProject());
        showLoadingChat('Loading chat…');
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

      for (const button of tabButtons) {
        button.addEventListener('click', () => {
          setActiveTab(button.getAttribute('data-tab') || 'agents');
        });
      }

      themeToggle?.addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
      });

      applyTheme(window.localStorage.getItem('maclaw-theme') || 'light');
      setActiveTab('agents');
      currentChatId = readStoredChatId(currentProject());
      void loadChat();
    </script>
  </body>
</html>
`;

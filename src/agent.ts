import type { AppConfig } from "./config.js";
import { OpenAIResponsesProvider, LocalFallbackProvider, type Provider } from "./providers.js";
import { appendMessage, type SessionStore } from "./sessions.js";
import { loadSkills } from "./skills.js";
import { createTools } from "./tools.js";
import type { Message, SessionRecord, SessionSummary } from "./types.js";
import { TaskScheduler } from "./scheduler.js";

const buildSystemPrompt = async (
  config: AppConfig,
  session: SessionRecord,
): Promise<string> => {
  const skills = await loadSkills(config.skillsDir);
  const skillsBlock =
    skills.length === 0
      ? "No local skills are available."
      : skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");

  return [
    "You are maclaw, a small local LLM harness.",
    "Your goal is to help the user answer questions and complete tasks.",
    "Keep answers concise and practical.",
    "Use tools when needed.",
    "Local skills are available as user-authored task descriptions. Read them when useful.",
    `Project initialized: ${config.isProjectInitialized ? "yes" : "no"}.`,
    `Session retention: ${config.retentionDays} days.`,
    `Compression mode: ${config.compressionMode}. If set to planned, compression is not implemented yet.`,
    "",
    "Available skills:",
    skillsBlock,
    "",
    `Current session id: ${session.id}`,
    `Current time: ${new Date().toISOString()}`,
  ].join("\n");
};

const createProvider = (config: AppConfig): Provider => {
  if (config.provider === "openai" && config.openAiApiKey) {
    return new OpenAIResponsesProvider(config.openAiApiKey, config.model);
  }

  return new LocalFallbackProvider();
};

export class MaclawAgent {
  private readonly config: AppConfig;
  private readonly scheduler: TaskScheduler;
  private readonly sessionStore: SessionStore;
  private readonly provider: Provider;
  private activeSessionId: string;
  private activeSession?: SessionRecord;

  constructor(config: AppConfig, scheduler: TaskScheduler, sessionStore: SessionStore) {
    this.config = config;
    this.scheduler = scheduler;
    this.sessionStore = sessionStore;
    this.provider = createProvider(config);
    this.activeSessionId = config.sessionId;
  }

  getCurrentSessionId(): string {
    return this.activeSessionId;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.sessionStore.listSessions();
  }

  async switchSession(sessionId: string): Promise<SessionRecord> {
    this.activeSessionId = sessionId;
    this.activeSession = await this.sessionStore.loadSession(sessionId, {
      retentionDays: this.config.retentionDays,
      compressionMode: this.config.compressionMode,
    });
    return this.activeSession;
  }

  async forkSession(newSessionId: string): Promise<SessionRecord> {
    const sourceSession = await this.loadActiveSession();
    const now = new Date().toISOString();
    const forkedSession: SessionRecord = {
      ...structuredClone(sourceSession),
      id: newSessionId,
      createdAt: now,
      updatedAt: now,
    };

    await this.sessionStore.saveSession(forkedSession);
    this.activeSessionId = newSessionId;
    this.activeSession = forkedSession;
    return forkedSession;
  }

  async loadActiveSession(): Promise<SessionRecord> {
    if (!this.activeSession) {
      this.activeSession = await this.sessionStore.loadSession(
        this.activeSessionId,
        {
          retentionDays: this.config.retentionDays,
          compressionMode: this.config.compressionMode,
        },
      );
    }

    return this.activeSession;
  }

  async handleUserInput(userInput: string): Promise<Message> {
    const session = await this.loadActiveSession();
    appendMessage(session, "user", userInput);
    await this.sessionStore.saveSession(session);

    let assistantMessage: Message;
    try {
      const systemPrompt = await buildSystemPrompt(this.config, session);
      const tools = createTools(this.config, this.scheduler, session.id);
      const result = await this.provider.generate({
        session,
        userInput,
        systemPrompt,
        tools,
      });

      assistantMessage = appendMessage(session, "assistant", result.outputText);
    } catch (error) {
      const content = `Request failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      assistantMessage = appendMessage(session, "assistant", content);
    }

    await this.sessionStore.saveSession(session);
    this.activeSession = session;
    return assistantMessage;
  }

  async handleScheduledTask(
    sessionId: string,
    prompt: string,
  ): Promise<Message> {
    const session = await this.sessionStore.loadSession(
      sessionId,
      {
        retentionDays: this.config.retentionDays,
        compressionMode: this.config.compressionMode,
      },
    );

    appendMessage(session, "system", `Scheduled task triggered: ${prompt}`, "scheduler");
    await this.sessionStore.saveSession(session);

    let assistantMessage: Message;
    try {
      const systemPrompt = await buildSystemPrompt(this.config, session);
      const tools = createTools(this.config, this.scheduler, session.id);
      const result = await this.provider.generate({
        session,
        userInput: prompt,
        systemPrompt,
        tools,
      });

      assistantMessage = appendMessage(
        session,
        "assistant",
        result.outputText,
        "scheduler",
      );
    } catch (error) {
      const content = `Scheduled task failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      assistantMessage = appendMessage(session, "assistant", content, "scheduler");
    }

    await this.sessionStore.saveSession(session);
    if (this.activeSessionId === session.id) {
      this.activeSession = session;
    }
    return assistantMessage;
  }
}

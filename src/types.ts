export type Role = "system" | "user" | "assistant" | "tool";

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  name?: string;
  model?: string;
  usage?: ProviderUsage;
  latencyMs?: number;
  toolIterations?: number;
};

export type ChatRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  retentionDays: number;
  compressionMode: "none" | "planned";
  summary?: string;
  messages: Message[];
};

export type ChatSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

// where a notification is sent/recvd
export type ChannelTarget = {
  channel: string;
  userId: string;
  conversationId?: string;
  threadId?: string;
  metadata?: Record<string, string>;
};

export type Origin = ChannelTarget;

export type MessageContext = {
  origin?: Origin;
  displayInstructions?: string;
};

export type NotificationKind =
  | "agentCompleted"
  | "agentFailed"
  | "taskCompleted"
  | "taskFailed"
  | "manual";

export type NotificationSelector =
  | NotificationKind
  | "agent:*"
  | "task:*"
  | "errors";

export type NotificationPolicy =
  | "all"
  | "none"
  | NotificationSelector[]
  | {
      allow?: NotificationSelector[];
      deny?: NotificationSelector[];
    };

// TODO: simplify
export type NotificationTarget =
  | "inbox"
  | "origin"
  | { channel: string }
  | ChannelTarget;

export type NotificationDestination = string | NotificationTarget;

export type NotificationOverride = {
  notify?: NotificationPolicy;
  notifyTarget?: NotificationTarget;
};

export type InboxEntry = {
  id: string;
  kind: NotificationKind;
  text: string;
  origin: Origin;
  sourceType: "agent" | "task" | "user";
  sourceId: string;
  sourceName?: string;
  sourceChatId?: string;
  createdAt: string;
  sentAt?: string;
  readAt?: string;
};

export type AgentInboxEntry = {
  id: string;
  agentId: string;
  text: string;
  sourceType: "agent" | "task" | "user" | "system";
  sourceId: string;
  sourceName?: string;
  sourceChatId?: string;
  createdAt: string;
  readAt?: string;
};

export type AgentStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "stopped"
  | "failed";

export type CreatedBy = "user" | "tool";

export type AgentRecord = {
  id: string;
  name: string;
  prompt: string;
  chatId: string;
  sourceChatId?: string;
  createdBy?: CreatedBy;
  createdByAgentId?: string;
  origin?: Origin;
  notify?: NotificationPolicy;
  notifyTarget?: NotificationTarget;
  status: AgentStatus;
  maxSteps?: number;
  timeoutMs: number;
  stepIntervalMs?: number;
  stepCount: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastMessage?: string;
  lastError?: string;
};

export type Skill = {
  name: string;
  path: string;
  description: string;
  content: string;
};

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export type TaskSchedule =
  | {
      type: "once";
      runAt: string;
    }
  | {
      type: "hourly";
      minute: number;
    }
  | {
      type: "daily";
      hour: number;
      minute: number;
    }
  | {
      type: "weekly";
      days: Weekday[];
      hour: number;
      minute: number;
    };

export type ScheduledTask = {
  id: string;
  chatId: string;
  sourceChatId?: string;
  createdBy?: CreatedBy;
  createdByAgentId?: string;
  origin?: Origin;
  notify?: NotificationPolicy;
  notifyTarget?: NotificationTarget;
  title: string;
  prompt: string;
  schedule: TaskSchedule;
  nextRunAt: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
};

export type TaskRunLogEntry = {
  timestamp: string;
  taskId: string;
  chatId: string;
  title: string;
  prompt: string;
  schedule: TaskSchedule;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  error?: string;
};

export type ToolPermission = "read" | "act" | "dangerous";

export type ToolDefinition = {
  name: string;
  description: string;
  category?: string;
  permission: ToolPermission;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<string>;
};

export type ToolCallLogEntry = {
  name: string;
  input: unknown;
};

export type ProviderRequest = {
  chat: ChatRecord;
  userInput: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  onToolCall?: (entry: ToolCallLogEntry) => void | Promise<void>;
};

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type UsageSummary = {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
};

export type ProviderResult = {
  outputText: string;
  model?: string;
  usage?: ProviderUsage;
  latencyMs?: number;
  toolIterations?: number;
};

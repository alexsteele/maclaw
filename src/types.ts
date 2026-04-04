export type Role = "system" | "user" | "assistant" | "tool";

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  name?: string;
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

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<string>;
};

export type ProviderRequest = {
  chat: ChatRecord;
  userInput: string;
  systemPrompt: string;
  tools: ToolDefinition[];
};

export type ProviderResult = {
  outputText: string;
};

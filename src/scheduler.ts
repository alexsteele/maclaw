import type { ScheduledTask, TaskRunLogEntry, TaskSchedule, Weekday } from "./types.js";

const weekdayOrder: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const isWeekday = (value: string): value is Weekday => {
  return weekdayOrder.includes(value as Weekday);
};

export interface TaskStore {
  loadTasks(): Promise<ScheduledTask[]>;
  saveTasks(tasks: ScheduledTask[]): Promise<void>;
  logTaskRun(entry: TaskRunLogEntry): Promise<void>;
}

export class MemoryTaskStore implements TaskStore {
  private tasks: ScheduledTask[] = [];

  async loadTasks(): Promise<ScheduledTask[]> {
    return structuredClone(this.tasks);
  }

  async saveTasks(tasks: ScheduledTask[]): Promise<void> {
    this.tasks = structuredClone(tasks);
  }

  async logTaskRun(_entry: TaskRunLogEntry): Promise<void> {
    return;
  }
}

const createTaskId = (tasks: ScheduledTask[]): string => {
  const existingIds = new Set(tasks.map((task) => task.id));

  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const value = Math.floor(Math.random() * 10_000);
    const taskId = `task_${value.toString().padStart(4, "0")}`;
    if (!existingIds.has(taskId)) {
      return taskId;
    }
  }

  throw new Error("Unable to generate a unique task id.");
};


const setDateParts = (
  base: Date,
  dayOffset: number,
  hour: number,
  minute: number,
): Date => {
  const next = new Date(base);
  next.setSeconds(0, 0);
  next.setDate(next.getDate() + dayOffset);
  next.setHours(hour, minute, 0, 0);
  return next;
};

const computeNextRunAt = (schedule: TaskSchedule, from: Date): string | undefined => {
  const reference = new Date(from);

  switch (schedule.type) {
    case "once":
      return new Date(schedule.runAt).toISOString();
    case "hourly": {
      const next = new Date(reference);
      next.setSeconds(0, 0);
      next.setMinutes(schedule.minute, 0, 0);
      if (next <= reference) {
        next.setHours(next.getHours() + 1);
      }
      return next.toISOString();
    }
    case "daily": {
      const today = setDateParts(reference, 0, schedule.hour, schedule.minute);
      const next = today > reference ? today : setDateParts(reference, 1, schedule.hour, schedule.minute);
      return next.toISOString();
    }
    case "weekly": {
      const days = schedule.days.filter(isWeekday);
      if (days.length === 0) {
        return undefined;
      }

      for (let offset = 0; offset < 7; offset += 1) {
        const candidate = setDateParts(reference, offset, schedule.hour, schedule.minute);
        const weekday = weekdayOrder[candidate.getDay()];
        if (!days.includes(weekday)) {
          continue;
        }

        if (candidate > reference) {
          return candidate.toISOString();
        }
      }

      const fallback = setDateParts(reference, 7, schedule.hour, schedule.minute);
      return fallback.toISOString();
    }
  }
};

const advanceTaskAfterSuccess = (
  task: ScheduledTask,
  now: Date,
): ScheduledTask => {
  if (task.schedule.type === "once") {
    return {
      ...task,
      status: "completed",
      updatedAt: now.toISOString(),
      lastRunAt: now.toISOString(),
      lastError: undefined,
    };
  }

  const nextRunAt = computeNextRunAt(task.schedule, now);
  if (!nextRunAt) {
    throw new Error(`Unable to compute next run for task "${task.id}".`);
  }

  return {
    ...task,
    status: "pending",
    nextRunAt,
    updatedAt: now.toISOString(),
    lastRunAt: now.toISOString(),
    lastError: undefined,
  };
};

export class TaskScheduler {
  private readonly taskStore: TaskStore;
  private timer?: NodeJS.Timeout;

  constructor(taskStore: TaskStore) {
    this.taskStore = taskStore;
  }

  static createMemory(): TaskScheduler {
    return new TaskScheduler(new MemoryTaskStore());
  }

  private async readTasks(): Promise<ScheduledTask[]> {
    return this.taskStore.loadTasks();
  }

  private async writeTasks(tasks: ScheduledTask[]): Promise<void> {
    await this.taskStore.saveTasks(tasks);
  }

  async listTasks(chatId?: string): Promise<ScheduledTask[]> {
    const tasks = await this.readTasks();
    const filtered = chatId
      ? tasks.filter((task) => task.chatId === chatId)
      : tasks;

    return filtered.sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
  }

  async replaceTasks(tasks: ScheduledTask[]): Promise<void> {
    await this.writeTasks(tasks);
  }

  async createTask(input: {
    chatId: string;
    sourceChatId?: ScheduledTask["sourceChatId"];
    createdBy?: ScheduledTask["createdBy"];
    origin?: ScheduledTask["origin"];
    notify?: ScheduledTask["notify"];
    notifyTarget?: ScheduledTask["notifyTarget"];
    title: string;
    prompt: string;
    schedule?: TaskSchedule;
    runAt?: string;
  }): Promise<ScheduledTask> {
    const tasks = await this.readTasks();
    const timestamp = new Date();
    const schedule =
      input.schedule ??
      (input.runAt
        ? {
            type: "once" as const,
            runAt: input.runAt,
          }
        : undefined);

    if (!schedule) {
      throw new Error("Task creation requires either schedule or runAt.");
    }

    const nextRunAt = computeNextRunAt(schedule, timestamp);
    if (!nextRunAt) {
      throw new Error("Unable to compute the first run for this schedule.");
    }

    const task: ScheduledTask = {
      id: createTaskId(tasks),
      chatId: input.chatId,
      sourceChatId: input.sourceChatId,
      createdBy: input.createdBy,
      origin: input.origin,
      notify: input.notify,
      notifyTarget: input.notifyTarget,
      title: input.title,
      prompt: input.prompt,
      schedule,
      nextRunAt,
      status: "pending",
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    };

    tasks.push(task);
    await this.writeTasks(tasks);
    return task;
  }

  async deleteTask(taskId: string, chatId?: string): Promise<boolean> {
    const tasks = await this.readTasks();
    const filtered = tasks.filter((task) => {
      if (task.id !== taskId) {
        return true;
      }

      if (chatId && task.chatId !== chatId) {
        return true;
      }

      return false;
    });

    if (filtered.length === tasks.length) {
      return false;
    }

    await this.writeTasks(filtered);
    return true;
  }

  async markTask(
    taskId: string,
    patch: Partial<
      Pick<ScheduledTask, "lastError" | "lastRunAt" | "nextRunAt" | "status" | "updatedAt">
    >,
  ): Promise<void> {
    const tasks = await this.readTasks();
    const updated = tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...patch,
            updatedAt: patch.updatedAt ?? new Date().toISOString(),
          }
        : task,
    );

    await this.writeTasks(updated);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    const tasks = await this.readTasks();
    const now = new Date();
    let updatedTasks = tasks.slice();

    for (const task of tasks) {
      if (task.status !== "pending") {
        continue;
      }

      const nextRunAt = Date.parse(task.nextRunAt);
      if (!Number.isFinite(nextRunAt) || nextRunAt > now.getTime()) {
        continue;
      }

      updatedTasks = updatedTasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              status: "running",
              updatedAt: new Date().toISOString(),
            }
          : candidate,
      );
      await this.writeTasks(updatedTasks);

      const startedAt = new Date().toISOString();
      try {
        await onTask(task);
        const finishedAt = new Date().toISOString();
        const advanced = advanceTaskAfterSuccess(task, new Date(finishedAt));
        updatedTasks = updatedTasks.map((candidate) =>
          candidate.id === task.id ? advanced : candidate,
        );
        await this.taskStore.logTaskRun({
          timestamp: finishedAt,
          taskId: task.id,
          chatId: task.chatId,
          title: task.title,
          prompt: task.prompt,
          schedule: task.schedule,
          scheduledFor: task.nextRunAt,
          startedAt,
          finishedAt,
          status: "completed",
        });
      } catch (error) {
        const finishedAt = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        updatedTasks = updatedTasks.map((candidate) =>
          candidate.id === task.id
            ? {
                ...candidate,
                status: "failed",
                lastError: errorMessage,
                updatedAt: finishedAt,
              }
            : candidate,
        );
        await this.taskStore.logTaskRun({
          timestamp: finishedAt,
          taskId: task.id,
          chatId: task.chatId,
          title: task.title,
          prompt: task.prompt,
          schedule: task.schedule,
          scheduledFor: task.nextRunAt,
          startedAt,
          finishedAt,
          status: "failed",
          error: errorMessage,
        });
      }

      await this.writeTasks(updatedTasks);
    }
  }

  start(
    pollMs: number,
    onTask: (task: ScheduledTask) => Promise<void>,
  ): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.runDueTasks(onTask);
    }, pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

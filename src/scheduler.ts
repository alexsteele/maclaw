import { appendJsonLine, readJsonFile, writeJsonFile } from "./fs-utils.js";
import type { ScheduledTask, TaskRunLogEntry, TaskSchedule, Weekday } from "./types.js";

type LegacyScheduledTask = Omit<ScheduledTask, "nextRunAt" | "schedule"> & {
  nextRunAt?: string;
  runAt?: string;
  schedule?: TaskSchedule;
};

const weekdayOrder: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const isWeekday = (value: string): value is Weekday => {
  return weekdayOrder.includes(value as Weekday);
};

const normalizeTask = (task: LegacyScheduledTask): ScheduledTask => {
  const schedule =
    task.schedule ??
    (task.runAt
      ? {
          type: "once" as const,
          runAt: task.runAt,
        }
      : undefined);

  if (!schedule) {
    throw new Error(`Task "${task.id}" is missing schedule information.`);
  }

  const nextRunAt = task.nextRunAt ?? (schedule.type === "once" ? schedule.runAt : undefined);
  if (!nextRunAt) {
    throw new Error(`Task "${task.id}" is missing nextRunAt.`);
  }

  return {
    id: task.id,
    sessionId: task.sessionId,
    title: task.title,
    prompt: task.prompt,
    schedule,
    nextRunAt,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastRunAt: task.lastRunAt,
    lastError: task.lastError,
  };
};

const readAllTasks = async (tasksFile: string): Promise<ScheduledTask[]> => {
  const rawTasks = await readJsonFile<LegacyScheduledTask[]>(tasksFile, []);
  return rawTasks.map(normalizeTask);
};

const writeAllTasks = async (tasksFile: string, tasks: ScheduledTask[]): Promise<void> => {
  await writeJsonFile(tasksFile, tasks);
};

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
  private readonly tasksFile: string;
  private readonly taskRunsFile?: string;

  constructor(tasksFile: string, taskRunsFile?: string) {
    this.tasksFile = tasksFile;
    this.taskRunsFile = taskRunsFile;
  }

  async listTasks(sessionId?: string): Promise<ScheduledTask[]> {
    const tasks = await readAllTasks(this.tasksFile);
    const filtered = sessionId
      ? tasks.filter((task) => task.sessionId === sessionId)
      : tasks;

    return filtered.sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
  }

  async createTask(input: {
    sessionId: string;
    title: string;
    prompt: string;
    schedule?: TaskSchedule;
    runAt?: string;
  }): Promise<ScheduledTask> {
    const tasks = await readAllTasks(this.tasksFile);
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
      sessionId: input.sessionId,
      title: input.title,
      prompt: input.prompt,
      schedule,
      nextRunAt,
      status: "pending",
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    };

    tasks.push(task);
    await writeAllTasks(this.tasksFile, tasks);
    return task;
  }

  async deleteTask(taskId: string, sessionId?: string): Promise<boolean> {
    const tasks = await readAllTasks(this.tasksFile);
    const filtered = tasks.filter((task) => {
      if (task.id !== taskId) {
        return true;
      }

      if (sessionId && task.sessionId !== sessionId) {
        return true;
      }

      return false;
    });

    if (filtered.length === tasks.length) {
      return false;
    }

    await writeAllTasks(this.tasksFile, filtered);
    return true;
  }

  async markTask(
    taskId: string,
    patch: Partial<
      Pick<ScheduledTask, "lastError" | "lastRunAt" | "nextRunAt" | "status" | "updatedAt">
    >,
  ): Promise<void> {
    const tasks = await readAllTasks(this.tasksFile);
    const updated = tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...patch,
            updatedAt: patch.updatedAt ?? new Date().toISOString(),
          }
        : task,
    );

    await writeAllTasks(this.tasksFile, updated);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    const tasks = await readAllTasks(this.tasksFile);
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
      await writeAllTasks(this.tasksFile, updatedTasks);

      const startedAt = new Date().toISOString();
      try {
        await onTask(task);
        const finishedAt = new Date().toISOString();
        const advanced = advanceTaskAfterSuccess(task, new Date(finishedAt));
        updatedTasks = updatedTasks.map((candidate) =>
          candidate.id === task.id ? advanced : candidate,
        );
        await this.appendTaskRunLog({
          timestamp: finishedAt,
          taskId: task.id,
          sessionId: task.sessionId,
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
        await this.appendTaskRunLog({
          timestamp: finishedAt,
          taskId: task.id,
          sessionId: task.sessionId,
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

      await writeAllTasks(this.tasksFile, updatedTasks);
    }
  }

  private async appendTaskRunLog(entry: TaskRunLogEntry): Promise<void> {
    if (!this.taskRunsFile) {
      return;
    }

    await appendJsonLine(this.taskRunsFile, entry);
  }
}

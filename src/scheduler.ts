import { readJsonFile, writeJsonFile, makeId } from "./fs-utils.js";
import type { ScheduledTask } from "./types.js";

export class TaskScheduler {
  private readonly tasksFile: string;

  constructor(tasksFile: string) {
    this.tasksFile = tasksFile;
  }

  async listTasks(sessionId?: string): Promise<ScheduledTask[]> {
    const tasks = await readJsonFile<ScheduledTask[]>(this.tasksFile, []);
    const filtered = sessionId
      ? tasks.filter((task) => task.sessionId === sessionId)
      : tasks;

    return filtered.sort((left, right) => left.runAt.localeCompare(right.runAt));
  }

  async createTask(input: {
    sessionId: string;
    title: string;
    prompt: string;
    runAt: string;
  }): Promise<ScheduledTask> {
    const tasks = await this.listTasks();
    const timestamp = new Date().toISOString();
    const task: ScheduledTask = {
      id: makeId("task"),
      sessionId: input.sessionId,
      title: input.title,
      prompt: input.prompt,
      runAt: new Date(input.runAt).toISOString(),
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    tasks.push(task);
    await writeJsonFile(this.tasksFile, tasks);
    return task;
  }

  async markTask(
    taskId: string,
    patch: Partial<Pick<ScheduledTask, "status" | "lastError" | "updatedAt">>,
  ): Promise<void> {
    const tasks = await this.listTasks();
    const updated = tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...patch,
            updatedAt: patch.updatedAt ?? new Date().toISOString(),
          }
        : task,
    );

    await writeJsonFile(this.tasksFile, updated);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    const tasks = await this.listTasks();
    const now = Date.now();

    for (const task of tasks) {
      if (task.status !== "pending") {
        continue;
      }

      const runAt = Date.parse(task.runAt);
      if (!Number.isFinite(runAt) || runAt > now) {
        continue;
      }

      await this.markTask(task.id, { status: "running" });
      try {
        await onTask(task);
        await this.markTask(task.id, { status: "completed", lastError: undefined });
      } catch (error) {
        await this.markTask(task.id, {
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

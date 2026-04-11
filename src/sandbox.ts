/**
 * Sandbox runner interfaces and the first local bundle-based runner.
 *
 * The initial runner does not claim strong isolation. It creates a separate
 * workspace bundle on disk so maclaw can exercise the full sandbox request path
 * end to end before we swap in a stronger local-container or cloud runner.
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { defaultSandboxDir } from "./config.js";
import { ensureDir, makeId, writeJsonFile } from "./fs-utils.js";

export type SandboxRequest = {
  projectName: string;
  model: string;
  chatId: string;
  agentId?: string;
  prompt: string;
  transcript: string;
  createdAt: string;
};

export type SandboxResult = {
  summary: string;
  workspacePath: string;
  artifacts: string[];
  logs: string[];
};

export interface SandboxRunner {
  run(request: SandboxRequest): Promise<SandboxResult>;
}

export class LocalSandboxRunner implements SandboxRunner {
  private readonly baseDir: string;

  constructor(projectFolder: string) {
    this.baseDir = defaultSandboxDir(projectFolder);
  }

  async run(request: SandboxRequest): Promise<SandboxResult> {
    const sandboxId = makeId("sandbox");
    const workspacePath = path.join(this.baseDir, sandboxId);
    const promptPath = path.join(workspacePath, "prompt.txt");
    const transcriptPath = path.join(workspacePath, "transcript.md");
    const requestPath = path.join(workspacePath, "request.json");

    await ensureDir(workspacePath);
    await writeJsonFile(requestPath, request);
    await writeFile(promptPath, `${request.prompt}\n`, "utf8");
    await writeFile(transcriptPath, `${request.transcript}\n`, "utf8");

    return {
      summary: "Prepared a local sandbox bundle.",
      workspacePath,
      artifacts: [requestPath, promptPath, transcriptPath],
      logs: [`created workspace: ${workspacePath}`],
    };
  }
}

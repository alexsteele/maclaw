import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import type { ProjectConfig } from "../src/config.js";
import { createTools } from "../src/tools/index.js";

const createConfig = (projectDir: string): ProjectConfig => ({
  name: path.basename(projectDir),
  createdAt: undefined,
  model: "dummy/test-model",
  storage: "none",
  notifications: "all",
  contextMessages: 20,
  maxToolIterations: 8,
  retentionDays: 30,
  skillsDir: path.join(projectDir, ".maclaw", "skills"),
  compressionMode: "none",
  schedulerPollMs: 1000,
  projectFolder: projectDir,
  projectConfigFile: path.join(projectDir, ".maclaw", "maclaw.json"),
  chatId: "default",
  chatsDir: path.join(projectDir, ".maclaw", "chats"),
});

test("starter tools parse their own input", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-"));

  try {
    const config = createConfig(projectDir);
    await mkdir(config.skillsDir, { recursive: true });
    await writeFile(
      path.join(config.skillsDir, "daily_summary.md"),
      "# Daily Summary\n\nShort daily summary skill.\n",
      "utf8",
    );

    const tools = createTools(config);
    const listSkills = tools.find((tool) => tool.name === "list_skills");
    const readSkill = tools.find((tool) => tool.name === "read_skill");
    const getTime = tools.find((tool) => tool.name === "get_time");

    assert.ok(listSkills);
    assert.ok(readSkill);
    assert.ok(getTime);

    const skills = await listSkills.execute({});
    assert.match(skills, /daily_summary/u);

    const skill = await readSkill.execute({ name: "daily_summary" });
    assert.match(skill, /Daily Summary/u);

    const timestamp = await getTime.execute({});
    assert.ok(Number.isFinite(Date.parse(timestamp)));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

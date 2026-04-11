/**
 * Advisory per-project runtime lock for maclaw.
 *
 * This module keeps one active maclaw runtime per initialized project by
 * writing a small lock file under `.maclaw/lock.json`.
 */
import os from "node:os";
import path from "node:path";
import { open, readFile, rm } from "node:fs/promises";
import { defaultProjectLockFile } from "./config.js";
import { ensureDir } from "./fs-utils.js";
import { logger } from "./logger.js";

export type ProjectLockRecord = {
  pid: number;
  host: string;
  ownerId: string;
  acquiredAt: string;
};

export interface ProjectLockHandle {
  readonly filePath: string;
  readonly record: ProjectLockRecord;
  release(): Promise<void>;
}

// Node docs: `process.kill(pid, 0)` is the special case for probing whether a
// process exists without delivering a real signal.
// https://nodejs.org/api/process.html#processkillpid-signal
const PROCESS_EXISTS_SIGNAL = 0;

const readProjectLockRecord = async (
  filePath: string,
): Promise<ProjectLockRecord | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as ProjectLockRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, PROCESS_EXISTS_SIGNAL);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }

    if (code === "EPERM") {
      return true;
    }

    throw error;
  }
};

const createProjectLockHandle = (
  filePath: string,
  record: ProjectLockRecord,
): ProjectLockHandle => ({
  filePath,
  record,
  async release(): Promise<void> {
    const current = await readProjectLockRecord(filePath);
    if (
      current?.ownerId !== record.ownerId
      || current.pid !== record.pid
      || current.host !== record.host
    ) {
      logger.debug("project-lock", "skip release", {
        filePath,
        ownerId: record.ownerId,
      });
      return;
    }

    await rm(filePath, { force: true });
    logger.debug("project-lock", "released", {
      filePath,
      pid: record.pid,
      host: record.host,
    });
  },
});

const tryWriteProjectLock = async (
  filePath: string,
  record: ProjectLockRecord,
): Promise<ProjectLockHandle | undefined> => {
  await ensureDir(path.dirname(filePath));

  try {
    // `wx` uses exclusive create (`O_EXCL`), which gives us an atomic advisory
    // lock acquisition on normal local filesystems. The broader lock protocol
    // is still intentionally simple: stale-lock recovery and cross-host
    // behavior are best-effort and are not a distributed locking scheme.
    // Node docs: https://nodejs.org/api/fs.html
    // See the `fs.open()` / `fsPromises.open()` guidance for `'wx'` and `O_EXCL`.
    const handle = await open(filePath, "wx");
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.close();
    return createProjectLockHandle(filePath, record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return undefined;
    }

    throw error;
  }
};

const describeActiveLock = (
  filePath: string,
  record: ProjectLockRecord,
): string =>
  `Project is already in use by maclaw (pid ${record.pid} on ${record.host}). `
  + `Lock file: ${filePath}`;

export const acquireProjectLock = async (
  projectFolder: string,
  ownerId: string,
): Promise<ProjectLockHandle> => {
  const filePath = defaultProjectLockFile(projectFolder);
  const currentHost = os.hostname();
  const record: ProjectLockRecord = {
    pid: process.pid,
    host: currentHost,
    ownerId,
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acquired = await tryWriteProjectLock(filePath, record);
    if (acquired) {
      logger.debug("project-lock", "acquired", {
        filePath,
        pid: record.pid,
        host: record.host,
      });
      return acquired;
    }

    const existing = await readProjectLockRecord(filePath);
    if (!existing) {
      continue;
    }

    if (existing.ownerId === ownerId) {
      logger.debug("project-lock", "reused", {
        filePath,
        pid: existing.pid,
        host: existing.host,
      });
      return createProjectLockHandle(filePath, existing);
    }

    if (existing.host !== currentHost) {
      logger.debug("project-lock", "blocked by remote host", {
        filePath,
        pid: existing.pid,
        host: existing.host,
      });
      throw new Error(describeActiveLock(filePath, existing));
    }

    if (isProcessRunning(existing.pid)) {
      logger.debug("project-lock", "blocked by live process", {
        filePath,
        pid: existing.pid,
        host: existing.host,
      });
      throw new Error(describeActiveLock(filePath, existing));
    }

    logger.debug("project-lock", "removing stale lock", {
      filePath,
      pid: existing.pid,
      host: existing.host,
    });
    await rm(filePath, { force: true });
  }

  throw new Error(`Unable to acquire project lock: ${filePath}`);
};

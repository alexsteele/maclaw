/**
 * Small runtime logger for maclaw.
 *
 * Stderr logging is disabled by default. Set `MACLAW_LOG=1` (or `debug`) to
 * emit compact structured lines to stderr for critical lifecycle paths.
 *
 * Example:
 * `logger.debug("server", "started", { project: "home", port: 4000 })`
 * -> `2026-04-11T19:00:00.000Z [DEBUG] server started project=home port=4000`
 */
import path from "node:path";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  type WriteStream,
} from "node:fs";

type LogLevel = "debug" | "info" | "warn" | "error";
type LoggerRotationOptions = {
  maxBytes?: number;
  maxFiles?: number;
};

export type LoggerLike = {
  debug(scope: string, message: string, fields?: Record<string, unknown>): void;
  info(scope: string, message: string, fields?: Record<string, unknown>): void;
  warn(scope: string, message: string, fields?: Record<string, unknown>): void;
};

const formatValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value.includes(" ") ? JSON.stringify(value) : value;
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return String(value);
  }

  return JSON.stringify(value);
};

/**
 * Process-local logger with optional stderr and file sinks.
 */
export class Logger {
  private _filePath?: string;
  private _fileErrorReported = false;
  private _fileMaxBytes = 5 * 1024 * 1024;
  private _fileMaxFiles = 5;
  private _fileSizeBytes = 0;
  private _stderrEnabled?: boolean;
  private _stream?: WriteStream;

  private reportFileError(action: "open" | "write", error: unknown): void {
    if (this._fileErrorReported) {
      return;
    }

    this._fileErrorReported = true;
    const detail = error instanceof Error ? error.message : String(error);
    const location = this._filePath ?? "(unknown)";
    process.stderr.write(
      `${new Date().toISOString()} [WARN] logger file-${action}-failed `
      + `path=${JSON.stringify(location)} error=${JSON.stringify(detail)}\n`,
    );
  }

  private closeStream(): void {
    if (!this._stream) {
      return;
    }

    this._stream.destroy();
    this._stream = undefined;
  }

  private rotateFiles(filePath: string): void {
    if (this._fileMaxFiles <= 1) {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      return;
    }

    const oldestPath = `${filePath}.${this._fileMaxFiles - 1}`;
    if (existsSync(oldestPath)) {
      unlinkSync(oldestPath);
    }

    for (let index = this._fileMaxFiles - 2; index >= 1; index -= 1) {
      const source = `${filePath}.${index}`;
      const destination = `${filePath}.${index + 1}`;
      if (existsSync(source)) {
        renameSync(source, destination);
      }
    }

    if (existsSync(filePath)) {
      renameSync(filePath, `${filePath}.1`);
    }
  }

  private openFileStream(filePath: string): void {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this._fileSizeBytes = existsSync(filePath)
      ? statSync(filePath).size
      : 0;

    const stream = createWriteStream(filePath, {
      flags: "a",
      encoding: "utf8",
    });

    stream.on("error", () => {
      this.reportFileError("write", new Error("Logger stream error"));
      this._filePath = undefined;
      this._stream = undefined;
    });

    this._stream = stream;
  }

  private rotateExistingFileIfNeeded(filePath: string): void {
    if (!existsSync(filePath) || this._fileMaxBytes <= 0) {
      return;
    }

    const size = statSync(filePath).size;
    if (size <= this._fileMaxBytes) {
      return;
    }

    this.rotateFiles(filePath);
  }

  private rotateIfNeeded(nextLine: string): void {
    if (!this._filePath || this._fileMaxBytes <= 0) {
      return;
    }

    if (this._fileSizeBytes + Buffer.byteLength(nextLine, "utf8") <= this._fileMaxBytes) {
      return;
    }

    this.closeStream();
    this.rotateFiles(this._filePath);
    this.openFileStream(this._filePath);
  }

  private isStderrEnabled(): boolean {
    if (this._stderrEnabled !== undefined) {
      return this._stderrEnabled;
    }

    const value = process.env.MACLAW_LOG?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "debug";
  }

  private write(
    level: LogLevel,
    scope: string,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (!this.isStderrEnabled() && !this._filePath) {
      return;
    }

    const pairs = Object.entries(fields ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatValue(value)}`);
    const suffix = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${scope} ${message}${suffix}\n`;

    if (this.isStderrEnabled()) {
      process.stderr.write(line);
    }

    if (this._stream) {
      try {
        this.rotateIfNeeded(line);
        this._stream.write(line);
        this._fileSizeBytes += Buffer.byteLength(line, "utf8");
      } catch (error) {
        this.reportFileError("write", error);
        this.closeStream();
        this._filePath = undefined;
      }
    }
  }

  /**
   * Write a log line with an optional structured field map.
   *
   * `scope` identifies the subsystem, `message` names the event, and `fields`
   * adds compact key/value context such as `project`, `port`, or `agentId`.
   */
  debug(scope: string, message: string, fields?: Record<string, unknown>): void {
    this.write("debug", scope, message, fields);
  }

  info(scope: string, message: string, fields?: Record<string, unknown>): void {
    this.write("info", scope, message, fields);
  }

  warn(scope: string, message: string, fields?: Record<string, unknown>): void {
    this.write("warn", scope, message, fields);
  }

  setFile(filePath?: string, options: LoggerRotationOptions = {}): void {
    this.closeStream();

    this._fileErrorReported = false;
    this._fileMaxBytes = options.maxBytes ?? this._fileMaxBytes;
    this._fileMaxFiles = Math.max(options.maxFiles ?? this._fileMaxFiles, 1);
    this._fileSizeBytes = 0;
    this._filePath = filePath?.trim() || undefined;

    if (!this._filePath) {
      return;
    }

    try {
      this.rotateExistingFileIfNeeded(this._filePath);
      this.openFileStream(this._filePath);
    } catch (error) {
      this.reportFileError("open", error);
      this._filePath = undefined;
      this.closeStream();
    }
  }

  setStderr(enabled?: boolean): void {
    this._stderrEnabled = enabled;
  }

  async close(): Promise<void> {
    const stream = this._stream;
    this._stream = undefined;

    if (stream) {
      await new Promise<void>((resolve) => {
        stream.end(resolve);
      });
    }

    this._filePath = undefined;
    this._fileSizeBytes = 0;
    this._stderrEnabled = undefined;
  }
}

export const logger = new Logger();

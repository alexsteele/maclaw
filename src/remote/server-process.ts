/**
 * Shared remote server lifecycle shell commands.
 *
 * SSH and EC2 remotes both run the same background `maclaw server` process in a
 * checked-out workspace. This module keeps the pidfile and log conventions in
 * one place so provider-specific code can focus on transport details.
 */
import type { ProjectConfig } from "../config.js";
import type { EditableServerConfig } from "../server-config.js";
import { defaultServerPort } from "../server-config.js";
import {
  DEFAULT_REMOTE_RUNTIME_DIR,
  DEFAULT_REMOTE_SERVER_LOG_FILE,
  DEFAULT_REMOTE_SERVER_PID_FILE,
  DEFAULT_REMOTE_WORKSPACE,
} from "./constants.js";
import { buildRemoteServerInitScript, resolveRemoteBootstrapConfig } from "./bootstrap.js";
import type { RemoteBootstrapOptions } from "./types.js";

/**
 * Build the shell command used to start `maclaw server` on a remote machine.
 */
export function buildRemoteServerStartCommand(
  port?: number,
  project?: ProjectConfig,
  server?: EditableServerConfig,
  options?: RemoteBootstrapOptions,
): string {
  const remotePort = port ?? defaultServerPort();
  const bootstrap = resolveRemoteBootstrapConfig(project, options);
  return script(`
    set -e
    cd ${bootstrap.workspace}
${buildRemoteServerInitScript(project, server, options)}
    pid_file=${bootstrap.runtimeDir}/server.pid
    log_file=${bootstrap.runtimeDir}/server.log
    if [ -f "$pid_file" ]; then
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "maclaw server already running on port ${remotePort} (pid $pid)"
        exit 0
      fi
      rm -f "$pid_file"
    fi
    nohup npm start -- server --api-only --port ${remotePort} >> "$log_file" 2>&1 < /dev/null &
    pid=$!
    echo "$pid" > "$pid_file"
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      echo "started maclaw server on port ${remotePort} (pid $pid)"
      exit 0
    fi
    rm -f "$pid_file"
    echo "maclaw server exited during startup; see ${DEFAULT_REMOTE_SERVER_LOG_FILE}"
    tail -n 40 "$log_file" 2>/dev/null || true
    exit 1
  `);
}

/**
 * Build the shell command used to stop the managed remote `maclaw server`.
 */
export function buildRemoteServerStopCommand(options?: RemoteBootstrapOptions): string {
  const bootstrap = resolveRemoteBootstrapConfig(undefined, options);
  return script(`
    set -e
    cd ${bootstrap.workspace}
    mkdir -p ${bootstrap.runtimeDir}
    pid_file=${bootstrap.runtimeDir}/server.pid
    if [ ! -f "$pid_file" ]; then
      echo 'maclaw server is not running'
      exit 0
    fi
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -z "$pid" ]; then
      rm -f "$pid_file"
      echo 'cleared empty maclaw server pid file'
      exit 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "maclaw server was not running (cleared stale pid $pid)"
      exit 0
    fi
    kill "$pid"
    for _ in 1 2 3 4 5; do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$pid_file"
        echo "stopped maclaw server (pid $pid)"
        exit 0
      fi
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null || true
    if kill -0 "$pid" 2>/dev/null; then
      echo "failed to stop maclaw server (pid $pid)"
      exit 1
    fi
    rm -f "$pid_file"
    echo "stopped maclaw server with SIGKILL (pid $pid)"
  `);
}

/**
 * Build the shell command used to launch the interactive remote `maclaw` REPL.
 */
export function buildRemoteReplStartCommand(
  promptPrefix?: string,
  options?: RemoteBootstrapOptions,
): string {
  const bootstrap = resolveRemoteBootstrapConfig(undefined, options);
  const promptExport = promptPrefix?.trim()
    ? `MACLAW_PROMPT=${shellQuote(promptPrefix.trim())} `
    : "";
  return script(`
    set -e
    cd ${bootstrap.workspace}
    ${promptExport}npm start
  `);
}

function script(value: string): string {
  return value.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/**
 * Remote bootstrap and initialization scripts.
 *
 * This module builds the shell scripts that prepare a remote workspace,
 * initialize maclaw config there, and install/build the repo when needed.
 */
import type { ProjectConfig } from "../config.js";
import type { EditableServerConfig } from "../server-config.js";
import {
  DEFAULT_REMOTE_INSTALL_MARKER,
  DEFAULT_REMOTE_NODE_MAJOR,
  DEFAULT_REMOTE_REPO_URL,
  DEFAULT_REMOTE_RUNTIME_DIR,
  DEFAULT_REMOTE_SERVER_HOME_DIR,
  DEFAULT_REMOTE_WORKSPACE,
} from "./constants.js";
import type {
  RemoteBootstrapOptions,
} from "./types.js";

export function buildRemoteServerInitScript(
  project?: ProjectConfig,
  server?: EditableServerConfig,
  options?: RemoteBootstrapOptions,
): string {
  const bootstrap = resolveRemoteBootstrapConfig(project, options);
  const remoteServerConfig = buildRemoteServerConfig(
    bootstrap.projectConfig.name ?? "remote",
    server,
  );

  return script(`
    mkdir -p ${bootstrap.runtimeDir}
    mkdir -p ${bootstrap.serverHomeDir}
    workspace_dir="$(pwd)"
    server_home="$workspace_dir/${bootstrap.serverHomeDir}"
    export MACLAW_HOME="$server_home"
    project_config="$workspace_dir/${bootstrap.runtimeDir}/maclaw.json"
    server_config="$server_home/server.json"
    if [ ! -f "$project_config" ]; then
      cat > "$project_config" <<'EOF'
${JSON.stringify(bootstrap.projectConfig, null, 2)}
EOF
    fi
    if [ ! -f "$server_config" ]; then
      cat > "$server_config" <<EOF
${JSON.stringify(remoteServerConfig, null, 2).replaceAll("\"__WORKSPACE_DIR__\"", "\"$workspace_dir\"")}
EOF
    fi
  `);
}

export function buildSshBootstrapCommand(
  project?: ProjectConfig,
  server?: EditableServerConfig,
  options?: RemoteBootstrapOptions,
): string {
  const bootstrap = resolveRemoteBootstrapConfig(project, options);
  return script(`
    set -e
    mkdir -p ${bootstrap.workspace}
    cd ${bootstrap.workspace}
    if [ -f package.json ] && [ -f ${bootstrap.installMarker} ]; then
      echo 'maclaw already installed in ${bootstrap.workspace}'
      exit 0
    fi
    command -v node >/dev/null 2>&1 || { echo 'node is required'; exit 1; }
    command -v npm >/dev/null 2>&1 || { echo 'npm is required'; exit 1; }
    command -v git >/dev/null 2>&1 || { echo 'git is required'; exit 1; }
    if [ ! -f package.json ]; then
      if [ -n "$(ls -A . 2>/dev/null)" ]; then
        echo 'workspace is not a maclaw repo and is not empty: ${bootstrap.workspace}'
        exit 2
      fi
      git clone ${bootstrap.repoUrl} .
    fi
    npm install
    npm run build
${buildRemoteServerInitScript(project, server, options)}
  `);
}

export function buildEc2BootstrapCommand(
  project?: ProjectConfig,
  server?: EditableServerConfig,
  options?: RemoteBootstrapOptions,
): string {
  const bootstrap = resolveRemoteBootstrapConfig(project, options);
  return script(`
    set -e
    mkdir -p ${bootstrap.workspace}
    cd ${bootstrap.workspace}
    if [ -f package.json ] && [ -f ${bootstrap.installMarker} ]; then
      echo 'maclaw already installed in ${bootstrap.workspace}'
      exit 0
    fi
    sudo dnf update -y
    sudo dnf install -y git tar gzip
    if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q '^v${bootstrap.nodeMajor}\\.'; then
      curl -fsSL https://rpm.nodesource.com/setup_${bootstrap.nodeMajor}.x | sudo bash -
      sudo dnf install -y nodejs
    fi
    if [ ! -f package.json ]; then
      if [ -n "$(ls -A . 2>/dev/null)" ]; then
        echo 'workspace is not a maclaw repo and is not empty: ${bootstrap.workspace}'
        exit 2
      fi
      git clone ${bootstrap.repoUrl} .
    fi
    npm install
    npm run build
${buildRemoteServerInitScript(project, server, options)}
  `);
}

function buildRemoteServerConfig(
  projectName: string,
  _server?: EditableServerConfig,
): {
  defaultProject: string;
  projects: Array<{ folder: string; name: string }>;
} {
  return {
    defaultProject: projectName,
    projects: [
      {
        folder: "__WORKSPACE_DIR__",
        name: projectName,
      },
    ],
  };
}

export function resolveRemoteBootstrapConfig(
  project?: ProjectConfig,
  options: RemoteBootstrapOptions = {},
) {
  const baseProjectConfig = buildRemoteProjectConfig(project);
  return {
    installMarker: options.installMarker ?? DEFAULT_REMOTE_INSTALL_MARKER,
    nodeMajor: options.nodeMajor ?? DEFAULT_REMOTE_NODE_MAJOR,
    projectConfig: {
      ...baseProjectConfig,
      ...options.projectConfig,
    },
    repoUrl: options.repoUrl ?? DEFAULT_REMOTE_REPO_URL,
    runtimeDir: options.runtimeDir ?? DEFAULT_REMOTE_RUNTIME_DIR,
    serverHomeDir: options.serverHomeDir ?? DEFAULT_REMOTE_SERVER_HOME_DIR,
    workspace: options.workspace ?? DEFAULT_REMOTE_WORKSPACE,
  };
}

function buildRemoteProjectConfig(project?: ProjectConfig): Partial<ProjectConfig> {
  return {
    compressionMode: project?.compressionMode ?? "none",
    contextMessages: project?.contextMessages ?? 20,
    defaultTaskTime: project?.defaultTaskTime ?? "09:00",
    maxToolIterations: project?.maxToolIterations ?? 8,
    model: project?.model ?? "openai/gpt-5.4-mini",
    name: project?.name ?? "remote",
    notifications: project?.notifications ?? "none",
    retentionDays: project?.retentionDays ?? 30,
    schedulerPollMs: project?.schedulerPollMs ?? 15_000,
    storage: project?.storage ?? "json",
    tools: project?.tools ?? ["read"],
  };
}

function script(value: string): string {
  return value.trim();
}

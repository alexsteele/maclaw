/**
 * Docker-backed runtime helpers for SSH and EC2 remotes.
 *
 * These commands keep Docker as a runtime mode on top of an existing remote
 * provider rather than introducing Docker as a separate remote type.
 */
import type { ProjectConfig } from "../config.js";
import type {
  DockerRemoteRuntime,
  EditableServerConfig,
  RemoteConfig,
  RemoteRuntimeConfig,
} from "../server-config.js";
import {
  DEFAULT_REMOTE_DOCKER_CONTAINER_NAME,
  DEFAULT_REMOTE_DOCKER_DATA_DIR,
  DEFAULT_REMOTE_DOCKER_IMAGE,
} from "./constants.js";
import { resolveRemoteBootstrapConfig } from "./bootstrap.js";
import type { RemoteBootstrapOptions } from "./types.js";

const CONTAINER_HOME_DIR = "/data/home";
const CONTAINER_PROJECTS_DIR = "/data/projects";

export const getRemoteRuntime = (remote: RemoteConfig): RemoteRuntimeConfig =>
  remote.runtime ?? { kind: "host" };

export const isDockerRuntime = (remote: RemoteConfig): boolean =>
  getRemoteRuntime(remote).kind === "docker";

export const getDockerRuntime = (remote: RemoteConfig): DockerRemoteRuntime => {
  const runtime = getRemoteRuntime(remote);
  if (runtime.kind !== "docker") {
    throw new Error(`Remote ${remote.name} is not configured for the docker runtime.`);
  }

  return {
    kind: "docker",
    image: runtime.image ?? DEFAULT_REMOTE_DOCKER_IMAGE,
    dataDir: runtime.dataDir ?? DEFAULT_REMOTE_DOCKER_DATA_DIR,
    containerName: runtime.containerName ?? DEFAULT_REMOTE_DOCKER_CONTAINER_NAME,
    hostNetwork: runtime.hostNetwork ?? true,
    hostPid: runtime.hostPid ?? true,
  };
};

export function buildDockerBootstrapCommand(
  remote: RemoteConfig,
  project?: ProjectConfig,
  server?: EditableServerConfig,
  options?: RemoteBootstrapOptions,
  installDocker = false,
): string {
  const bootstrap = resolveRemoteBootstrapConfig(project, options);

  return script(`
    set -e
    mkdir -p ${bootstrap.workspace}
    cd ${bootstrap.workspace}
${installDocker ? buildDockerInstallScript() : buildDockerCheckScript()}
    if [ ! -f package.json ]; then
      if [ -n "$(ls -A . 2>/dev/null)" ]; then
        echo 'workspace is not a maclaw repo and is not empty: ${bootstrap.workspace}'
        exit 2
      fi
      git clone ${bootstrap.repoUrl} .
    fi
    npm install
    npm run build
${buildDockerRuntimeInitScript(remote, project, server, options)}
    docker build -t ${getDockerRuntime(remote).image} .
  `);
}

export function buildDockerStartCommand(
  remote: RemoteConfig,
  port: number,
  project?: ProjectConfig,
  server?: EditableServerConfig,
  options?: RemoteBootstrapOptions,
): string {
  const runtime = getDockerRuntime(remote);
  return script(`
    set -e
${buildDockerRuntimeInitScript(remote, project, server, options)}
    docker rm -f ${runtime.containerName} >/dev/null 2>&1 || true
    rm -f ${dockerProjectDir(remote, project, options)}/.maclaw/lock.json
    docker run -d \
      --name ${runtime.containerName} \
      --restart unless-stopped \
${runtime.hostNetwork ? "      --network host \\\n" : ""}${runtime.hostPid ? "      --pid host \\\n" : ""}      -e MACLAW_HOME=${CONTAINER_HOME_DIR} \
      -v ${runtime.dataDir}/home:${CONTAINER_HOME_DIR} \
      -v ${runtime.dataDir}/projects:${CONTAINER_PROJECTS_DIR} \
      ${runtime.image} \
      server --api-only --port ${port}
    sleep 3
    docker ps --filter name=${runtime.containerName} --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  `);
}

export function buildDockerStopCommand(remote: RemoteConfig): string {
  const runtime = getDockerRuntime(remote);
  return script(`
    set -e
    if ! docker ps -a --format '{{.Names}}' | grep -Fx ${runtime.containerName} >/dev/null; then
      echo 'maclaw container is not running'
      exit 0
    fi
    docker rm -f ${runtime.containerName}
  `);
}

function buildDockerRuntimeInitScript(
  remote: RemoteConfig,
  project?: ProjectConfig,
  server?: EditableServerConfig,
  options?: RemoteBootstrapOptions,
): string {
  const runtime = getDockerRuntime(remote);
  const bootstrap = resolveRemoteBootstrapConfig(project, options);
  const projectName = bootstrap.projectConfig.name ?? "remote";
  void server;

  return script(`
    mkdir -p ${runtime.dataDir}/home
    mkdir -p ${dockerProjectDir(remote, project, options)}/.maclaw
    project_config=${dockerProjectDir(remote, project, options)}/.maclaw/maclaw.json
    server_config=${runtime.dataDir}/home/server.json
    if [ ! -f "$project_config" ]; then
      cat > "$project_config" <<'EOF'
${JSON.stringify({ ...bootstrap.projectConfig, name: projectName }, null, 2)}
EOF
    fi
    if [ ! -f "$server_config" ]; then
      cat > "$server_config" <<'EOF'
${JSON.stringify({
  defaultProject: projectName,
  projects: [{ name: projectName, folder: `${CONTAINER_PROJECTS_DIR}/${projectName}` }],
}, null, 2)}
EOF
    fi
  `);
}

function dockerProjectDir(
  remote: RemoteConfig,
  project?: ProjectConfig,
  options?: RemoteBootstrapOptions,
): string {
  const runtime = getDockerRuntime(remote);
  const bootstrap = resolveRemoteBootstrapConfig(project, options);
  const projectName = bootstrap.projectConfig.name ?? "remote";
  return `${runtime.dataDir}/projects/${projectName}`;
}

function buildDockerCheckScript(): string {
  return script(`
    command -v node >/dev/null 2>&1 || { echo 'node is required'; exit 1; }
    command -v npm >/dev/null 2>&1 || { echo 'npm is required'; exit 1; }
    command -v git >/dev/null 2>&1 || { echo 'git is required'; exit 1; }
    command -v docker >/dev/null 2>&1 || { echo 'docker is required'; exit 1; }
  `);
}

function buildDockerInstallScript(): string {
  return script(`
    sudo dnf install -y docker git tar gzip
    sudo systemctl enable --now docker
    command -v node >/dev/null 2>&1 || { echo 'node is required'; exit 1; }
    command -v npm >/dev/null 2>&1 || { echo 'npm is required'; exit 1; }
  `);
}

function script(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

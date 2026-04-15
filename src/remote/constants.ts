/**
 * Shared defaults for remote bootstrap and runtime setup.
 */
export const DEFAULT_REMOTE_NODE_MAJOR = 24;
export const DEFAULT_REMOTE_WORKSPACE = "~/maclaw";
export const DEFAULT_REMOTE_REPO_URL = "https://github.com/alexsteele/maclaw.git";
export const DEFAULT_REMOTE_INSTALL_MARKER = "dist/index.js";
export const DEFAULT_REMOTE_RUNTIME_DIR = ".maclaw";
export const DEFAULT_REMOTE_SERVER_LOG_FILE = `${DEFAULT_REMOTE_RUNTIME_DIR}/server.log`;
export const DEFAULT_REMOTE_SERVER_PID_FILE = `${DEFAULT_REMOTE_RUNTIME_DIR}/server.pid`;
export const DEFAULT_REMOTE_SERVER_HOME_DIR = `${DEFAULT_REMOTE_RUNTIME_DIR}/home`;
export const DEFAULT_REMOTE_DOCKER_IMAGE = "maclaw:dev";
export const DEFAULT_REMOTE_DOCKER_DATA_DIR = "~/maclaw-data";
export const DEFAULT_REMOTE_DOCKER_CONTAINER_NAME = "maclaw-server";

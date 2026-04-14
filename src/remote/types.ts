/**
 * Shared remote lifecycle types.
 *
 * These types are kept separate from the remote registry so provider files can
 * import them without creating a runtime cycle.
 */
import type { spawn } from "node:child_process";
import type { MaclawClient } from "./client.js";
import type { ProjectConfig } from "../config.js";
import type { EditableServerConfig, RemoteConfig } from "../server-config.js";

export type RemoteActionResult = {
  exitCode: number;
  message: string;
};

export type RemoteSetupError = "cancelled" | "invalid";

export type RemoteSetupResult = RemoteConfig | RemoteSetupError;

export type RemoteConnectOptions = {
  fetchFn?: typeof fetch;
  spawnFn?: typeof spawn;
  startupDelayMs?: number;
};

export type RemoteBootstrapOptions = {
  installMarker?: string;
  nodeMajor?: number;
  projectConfig?: Partial<ProjectConfig>;
  repoUrl?: string;
  runtimeDir?: string;
  serverHomeDir?: string;
  workspace?: string;
};

export type RemoteInitOptions = {
  bootstrap?: RemoteBootstrapOptions;
  project: ProjectConfig;
  server?: EditableServerConfig;
};

/**
 * Small prompt surface used by provider-specific remote setup flows.
 */
export type RemotePrompter = {
  askInt(prompt: string, defaultValue: number): Promise<number>;
  askLine(
    prompt: string,
    defaultValue?: string,
    options?: { preserveBlank?: boolean },
  ): Promise<string>;
  print(line?: string): void;
};

/**
 * Remote setup recipe.
 *
 * A recipe describes one kind of remote, knows how to walk the user through
 * creating its config, and can build a concrete `Remote` from that config.
 */
export type RemoteRecipe = {
  name: string;
  description: string;
  /**
   * Example config shape for scripting and future agent inspection.
   */
  exampleConfig: RemoteConfig;
  setup(prompter: RemotePrompter, config?: RemoteConfig): Promise<RemoteSetupResult>;
  create(config: RemoteConfig): Remote;
};


/**
 * Remote interacts with maclaw on a remote machine.
 */
export type Remote = {
  config: RemoteConfig;
  /**
   * Prepare the remote so maclaw can run there, for example by checking
   * prerequisites, installing dependencies, and building the workspace.
   */
  bootstrap(options?: RemoteInitOptions): Promise<RemoteActionResult>;
  /**
   * Start the remote maclaw runtime, typically the API-only server used by
   * teleport.
   */
  start(options?: RemoteInitOptions): Promise<RemoteActionResult>;
  /**
   * Connect to the remote runtime and return a ready-to-use maclaw client.
   */
  connect(options?: RemoteConnectOptions): Promise<RemoteConnection>;
  /**
   * Stop the remote maclaw runtime when the provider supports it.
   */
  stop(options?: RemoteInitOptions): Promise<RemoteActionResult>;
};

/**
 * Connected remote maclaw client used by teleport.
 *
 * A remote connection wraps a ready-to-use client together with the metadata
 * and cleanup needed for that connection, such as an SSH or SSM tunnel.
 */
export type RemoteConnection = MaclawClient & {
  buildOriginMetadata(target: string): Record<string, string>;
  close(): Promise<void>;
  describe(): string;
  getMode(): string;
};

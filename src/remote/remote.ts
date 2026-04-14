/**
 * Remote registry and factory.
 */
import type { RemoteConfig, ServerConfig } from "../server-config.js";
import { ec2RemoteRecipe, summarizeEc2Remote } from "./ec2.js";
import {
  createHttpTargetRemote,
  httpRemoteRecipe,
  isHttpRemoteTarget,
  summarizeHttpRemote,
} from "./http.js";
import { sshRemoteRecipe, summarizeSshRemote } from "./ssh.js";
export type * from "./types.js";
import type { Remote, RemoteRecipe } from "./types.js";

const remoteRecipes = new Map<string, RemoteRecipe>([
  [httpRemoteRecipe.name, httpRemoteRecipe],
  [sshRemoteRecipe.name, sshRemoteRecipe],
  [ec2RemoteRecipe.name, ec2RemoteRecipe],
]);

export const listRemoteRecipes = (): RemoteRecipe[] => Array.from(remoteRecipes.values());

export const getRemoteRecipe = (name: string): RemoteRecipe | undefined => remoteRecipes.get(name);

export const findRemoteConfig = (
  config: Pick<ServerConfig, "remotes">,
  name: string,
): RemoteConfig | undefined => config.remotes?.find((remote) => remote.name === name);

export const summarizeRemote = (config: RemoteConfig): string => {
  if (config.provider === "http") {
    return summarizeHttpRemote(config);
  }

  if (config.provider === "ssh") {
    return summarizeSshRemote(config);
  }

  if (config.provider === "aws-ec2") {
    return summarizeEc2Remote(config);
  }

  return config.provider;
};

export const resolveRemoteTarget = (
  target: string,
  config?: Pick<ServerConfig, "remotes">,
): Remote | undefined => {
  if (isHttpRemoteTarget(target)) {
    return createHttpTargetRemote(target);
  }

  const remoteConfig = findRemoteConfig(config ?? {}, target);
  return remoteConfig ? createRemote(remoteConfig) : undefined;
};

export const createRemote = (config: RemoteConfig): Remote => {
  const remoteRecipe = getRemoteRecipe(config.provider);
  if (!remoteRecipe) {
    throw new Error(`Unknown remote recipe: ${config.provider}`);
  }

  return remoteRecipe.create(config);
};

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ServerProjectConfig = {
  folder: string;
  name: string;
};

type RawWhatsAppConfig = {
  defaultProject?: string;
  enabled?: boolean;
  graphApiVersion?: string;
  phoneNumberId?: string;
  port?: number;
  webhookPath?: string;
};

type RawServerConfig = {
  channels?: {
    whatsapp?: RawWhatsAppConfig;
  };
  projects: ServerProjectConfig[];
};

export type WhatsAppConfig = {
  defaultProject?: string;
  enabled: boolean;
  graphApiVersion: string;
  phoneNumberId?: string;
  port: number;
  webhookPath: string;
};

export type ServerConfig = {
  configFile: string;
  projects: ServerProjectConfig[];
  channels: {
    whatsapp: WhatsAppConfig;
  };
};

type ServerSecretsFile = {
  whatsapp?: {
    accessToken?: string;
    verifyToken?: string;
  };
};

export type ServerSecrets = {
  configFile: string;
  whatsapp: {
    accessToken?: string;
    verifyToken?: string;
  };
};

export const defaultServerConfigFile = (): string =>
  process.env.MACLAW_SERVER_CONFIG ?? path.join(os.homedir(), ".maclaw", "server.json");

export const defaultServerSecretsFile = (): string =>
  process.env.MACLAW_SERVER_SECRETS ?? path.join(os.homedir(), ".maclaw", "secrets.json");

const toPositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== "number") {
    return fallback;
  }

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const loadServerConfig = (
  configFile: string = defaultServerConfigFile(),
): ServerConfig => {
  const resolvedConfigFile = path.resolve(configFile);
  if (!existsSync(resolvedConfigFile)) {
    throw new Error(
      `Server config not found: ${resolvedConfigFile}. Create ~/.maclaw/server.json to use 'maclaw server'.`,
    );
  }

  const raw = readFileSync(resolvedConfigFile, "utf8");
  const parsed = JSON.parse(raw) as RawServerConfig;
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  const names = new Set<string>();

  for (const project of projects) {
    if (!project?.name || !project?.folder) {
      throw new Error(`Invalid server project entry in ${resolvedConfigFile}`);
    }

    if (names.has(project.name)) {
      throw new Error(`Duplicate server project name: ${project.name}`);
    }

    names.add(project.name);
  }

  const whatsapp = parsed.channels?.whatsapp ?? {};
  if (whatsapp.defaultProject && !names.has(whatsapp.defaultProject)) {
    throw new Error(`Unknown WhatsApp default project: ${whatsapp.defaultProject}`);
  }

  return {
    configFile: resolvedConfigFile,
    projects: projects.map((project) => ({
      name: project.name,
      folder: path.resolve(project.folder),
    })),
    channels: {
      whatsapp: {
        defaultProject: whatsapp.defaultProject,
        enabled: whatsapp.enabled ?? false,
        graphApiVersion: whatsapp.graphApiVersion ?? "v23.0",
        phoneNumberId:
          process.env.MACLAW_WHATSAPP_PHONE_NUMBER_ID ?? whatsapp.phoneNumberId,
        port: toPositiveInt(whatsapp.port, 3000),
        webhookPath: whatsapp.webhookPath ?? "/whatsapp/webhook",
      },
    },
  };
};

export const loadServerSecrets = (
  secretsFile: string = defaultServerSecretsFile(),
): ServerSecrets => {
  const resolvedSecretsFile = path.resolve(secretsFile);
  const parsed: ServerSecretsFile = existsSync(resolvedSecretsFile)
    ? (JSON.parse(readFileSync(resolvedSecretsFile, "utf8")) as ServerSecretsFile)
    : {};

  return {
    configFile: resolvedSecretsFile,
    whatsapp: {
      accessToken:
        process.env.MACLAW_WHATSAPP_ACCESS_TOKEN ??
        parsed.whatsapp?.accessToken,
      verifyToken:
        process.env.MACLAW_WHATSAPP_VERIFY_TOKEN ??
        parsed.whatsapp?.verifyToken,
    },
  };
};

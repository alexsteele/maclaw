import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ServerProjectConfig = {
  folder: string;
  name: string;
};

export type WhatsAppConfig = {
  enabled: boolean;
  graphApiVersion: string;
  phoneNumberId?: string;
  port: number;
  webhookPath: string;
};

export type SlackConfig = {
  enabled: boolean;
  botUserId?: string;
};

export type DiscordConfig = {
  enabled: boolean;
};

export type ServerConfig = {
  configFile: string;
  defaultProject?: string;
  projects: ServerProjectConfig[];
  channels: {
    discord: DiscordConfig;
    slack: SlackConfig;
    whatsapp: WhatsAppConfig;
  };
};

export type ServerSecrets = {
  configFile: string;
  discord: {
    botToken?: string;
  };
  slack: {
    appToken?: string;
    botToken?: string;
  };
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
  const parsed = JSON.parse(raw) as {
    defaultProject?: string;
    channels?: {
      discord?: Partial<DiscordConfig>;
      slack?: Partial<SlackConfig>;
      whatsapp?: Partial<WhatsAppConfig>;
    };
    projects?: ServerProjectConfig[];
  };
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
  const slack = parsed.channels?.slack ?? {};
  const discord = parsed.channels?.discord ?? {};
  if (parsed.defaultProject && !names.has(parsed.defaultProject)) {
    throw new Error(`Unknown default project: ${parsed.defaultProject}`);
  }

  return {
    configFile: resolvedConfigFile,
    defaultProject: parsed.defaultProject,
    projects: projects.map((project) => ({
      name: project.name,
      folder: path.resolve(project.folder),
    })),
    channels: {
      discord: {
        enabled: discord.enabled ?? false,
      },
      slack: {
        enabled: slack.enabled ?? false,
        botUserId: process.env.MACLAW_SLACK_BOT_USER_ID ?? slack.botUserId,
      },
      whatsapp: {
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
  const parsed = existsSync(resolvedSecretsFile)
    ? (JSON.parse(readFileSync(resolvedSecretsFile, "utf8")) as {
        discord?: Partial<ServerSecrets["discord"]>;
        slack?: Partial<ServerSecrets["slack"]>;
        whatsapp?: Partial<ServerSecrets["whatsapp"]>;
      })
    : {};

  return {
    configFile: resolvedSecretsFile,
    discord: {
      botToken:
        process.env.MACLAW_DISCORD_BOT_TOKEN ??
        parsed.discord?.botToken,
    },
    slack: {
      appToken:
        process.env.MACLAW_SLACK_APP_TOKEN ??
        parsed.slack?.appToken,
      botToken:
        process.env.MACLAW_SLACK_BOT_TOKEN ??
        parsed.slack?.botToken,
    },
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

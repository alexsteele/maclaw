/**
 * Global server config and secrets loading for maclaw.
 *
 * This module defines the server-wide channel config, managed project list, and
 * secret loading used by `MaclawServer` and the REPL. See `docs/config.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ServerProjectConfig = {
  folder: string;
  name: string;
};

/**
 * Named SSH remote used by `maclaw teleport`.
 *
 * The CLI can resolve one of these entries, open a short-lived SSH tunnel, and
 * forward commands to a remote maclaw server over the local forwarded port.
 */
export type TeleportRemoteConfig = {
  name: string;
  sshHost: string;
  sshUser?: string;
  sshPort?: number;
  remoteServerPort?: number;
  localForwardPort?: number;
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

export type EmailConfig = {
  enabled: boolean;
  from: string;
  to?: string;  // default=from
  host: string;
  port: number;
  startTls: boolean;
};

export type ServerLoggingConfig = {
  file: string;
  maxBytes: number;
  maxFiles: number;
};

export type ServerConfig = {
  configFile: string;
  defaultProject?: string;
  logging: ServerLoggingConfig;
  port?: number;
  projects: ServerProjectConfig[];
  remotes?: TeleportRemoteConfig[];
  channels?: {
    discord?: DiscordConfig;
    email?: EmailConfig;
    slack?: SlackConfig;
    whatsapp?: WhatsAppConfig;
  };
};

export type ServerSecrets = {
  configFile: string;
  openai: {
    apiKey?: string;
  };
  discord: {
    botToken?: string;
  };
  email: {
    smtpPassword?: string;
    smtpUser?: string;
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

export const maclawHomeDir = (homeDir: string = os.homedir()): string =>
  process.env.MACLAW_HOME
    ? path.resolve(process.env.MACLAW_HOME)
    : path.join(homeDir, ".maclaw");

export const defaultServerConfigFile = (homeDir: string = os.homedir()): string =>
  process.env.MACLAW_SERVER_CONFIG ?? path.join(maclawHomeDir(homeDir), "server.json");

export const defaultServerSecretsFile = (homeDir: string = os.homedir()): string =>
  process.env.MACLAW_SERVER_SECRETS ?? path.join(maclawHomeDir(homeDir), "secrets.json");

export const defaultServerLogFile = (homeDir: string = os.homedir()): string =>
  path.join(maclawHomeDir(homeDir), "logs", "server.log");

export const defaultServerLogMaxBytes = (): number => 5 * 1024 * 1024;

export const defaultServerLogMaxFiles = (): number => 5;

export const defaultServerPort = (): number => 4000;
export const defaultTeleportForwardPort = (): number => 4001;

export const defaultWhatsAppConfig = (): Omit<WhatsAppConfig, "enabled"> => ({
  graphApiVersion: "v23.0",
  port: 3000,
  webhookPath: "/whatsapp/webhook",
});

export const defaultSlackConfig = (): Omit<SlackConfig, "enabled"> => ({});

export const defaultDiscordConfig = (): Omit<DiscordConfig, "enabled"> => ({});
export const defaultEmailConfig = (): Omit<EmailConfig, "enabled"> => ({
  from: "",
  host: "",
  port: 587,
  startTls: true,
});

const toPositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== "number") {
    return fallback;
  }

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// TODO: Too much complicated custom code here.
export const loadServerConfig = (
  configFile: string = defaultServerConfigFile(),
): ServerConfig => {
  const resolvedConfigFile = path.resolve(configFile);
  if (!existsSync(resolvedConfigFile)) {
    throw new Error(
      `Server config not found: ${resolvedConfigFile}. Create ${defaultServerConfigFile()} to use 'maclaw server'.`,
    );
  }

  const raw = readFileSync(resolvedConfigFile, "utf8");
  const parsed = JSON.parse(raw) as {
    defaultProject?: string;
    logging?: Partial<ServerLoggingConfig>;
    port?: number;
    remotes?: Partial<TeleportRemoteConfig>[];
    channels?: {
      discord?: Partial<DiscordConfig>;
      email?: Partial<EmailConfig>;
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

  const whatsapp = parsed.channels?.whatsapp;
  const slack = parsed.channels?.slack;
  const discord = parsed.channels?.discord;
  const email = parsed.channels?.email;
  const logging = parsed.logging;
  const remotes = Array.isArray(parsed.remotes) ? parsed.remotes : [];
  if (parsed.defaultProject && !names.has(parsed.defaultProject)) {
    throw new Error(`Unknown default project: ${parsed.defaultProject}`);
  }

  const remoteNames = new Set<string>();
  for (const remote of remotes) {
    if (!remote?.name || !remote?.sshHost) {
      throw new Error(`Invalid server remote entry in ${resolvedConfigFile}`);
    }

    if (remoteNames.has(remote.name)) {
      throw new Error(`Duplicate server remote name: ${remote.name}`);
    }

    remoteNames.add(remote.name);
  }

  const channels = {
    ...(discord
      ? {
          discord: {
            ...defaultDiscordConfig(),
            ...discord,
            enabled: discord.enabled ?? false,
          },
        }
      : {}),
    ...(email
      ? {
          email: {
            ...defaultEmailConfig(),
            ...email,
            enabled: email.enabled ?? false,
            port: toPositiveInt(email.port, defaultEmailConfig().port),
          },
        }
      : {}),
    ...(slack
      ? {
          slack: {
            ...defaultSlackConfig(),
            ...slack,
            enabled: slack.enabled ?? false,
            botUserId: process.env.MACLAW_SLACK_BOT_USER_ID ?? slack.botUserId,
          },
        }
      : {}),
    ...(whatsapp
      ? {
          whatsapp: {
            ...defaultWhatsAppConfig(),
            ...whatsapp,
            enabled: whatsapp.enabled ?? false,
            phoneNumberId:
              process.env.MACLAW_WHATSAPP_PHONE_NUMBER_ID ?? whatsapp.phoneNumberId,
            port: toPositiveInt(whatsapp.port, defaultWhatsAppConfig().port),
          },
        }
      : {}),
  };

  return {
    configFile: resolvedConfigFile,
    defaultProject: parsed.defaultProject,
    logging: {
      file:
        typeof logging?.file === "string" && logging.file.trim().length > 0
          ? path.resolve(path.dirname(resolvedConfigFile), logging.file)
          : defaultServerLogFile(),
      maxBytes: toPositiveInt(logging?.maxBytes, defaultServerLogMaxBytes()),
      maxFiles: toPositiveInt(logging?.maxFiles, defaultServerLogMaxFiles()),
    },
    port: toPositiveInt(parsed.port, defaultServerPort()),
    projects: projects.map((project) => ({
      name: project.name,
      folder: path.resolve(project.folder),
    })),
    remotes:
      remotes.length > 0
        ? remotes.map((remote) => ({
            name: remote.name as string,
            sshHost: remote.sshHost as string,
            sshUser: remote.sshUser,
            sshPort: toPositiveInt(remote.sshPort, 22),
            remoteServerPort: toPositiveInt(
              remote.remoteServerPort,
              defaultServerPort(),
            ),
            localForwardPort: toPositiveInt(
              remote.localForwardPort,
              defaultTeleportForwardPort(),
            ),
          }))
        : undefined,
    channels: Object.keys(channels).length > 0 ? channels : undefined,
  };
};

export const loadServerSecrets = (
  secretsFile: string = defaultServerSecretsFile(),
): ServerSecrets => {
  const resolvedSecretsFile = path.resolve(secretsFile);
  const parsed = existsSync(resolvedSecretsFile)
    ? (JSON.parse(readFileSync(resolvedSecretsFile, "utf8")) as {
        openai?: Partial<ServerSecrets["openai"]>;
        discord?: Partial<ServerSecrets["discord"]>;
        email?: Partial<ServerSecrets["email"]>;
        slack?: Partial<ServerSecrets["slack"]>;
        whatsapp?: Partial<ServerSecrets["whatsapp"]>;
      })
    : {};

  return {
    configFile: resolvedSecretsFile,
    openai: {
      apiKey:
        process.env.OPENAI_API_KEY ??
        parsed.openai?.apiKey,
    },
    discord: {
      botToken:
        process.env.MACLAW_DISCORD_BOT_TOKEN ??
        parsed.discord?.botToken,
    },
    email: {
      smtpUser:
        process.env.MACLAW_EMAIL_SMTP_USER ??
        parsed.email?.smtpUser,
      smtpPassword:
        process.env.MACLAW_EMAIL_SMTP_PASSWORD ??
        parsed.email?.smtpPassword,
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

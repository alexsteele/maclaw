/**
 * Interactive first-run setup for model, project, server, and channel config.
 *
 * Proposal and example flow:
 * - docs/setup.md
 */
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { existsSync } from "node:fs";
import {
  defaultProjectDataDir,
  initProjectConfig,
  normalizeConfiguredModel,
  parseConfiguredModel,
  type ProjectConfig,
} from "../config.js";
import { renderModelSuggestions } from "../models.js";
import {
  defaultServerPort,
  defaultTeleportForwardPort,
  defaultServerConfigFile,
  defaultServerSecretsFile,
  maclawHomeDir,
  type SshConfig,
  type RemoteConfig,
  type ServerConfig,
  type ServerSecrets,
} from "../server-config.js";
import { readJsonFile, writeJsonFile } from "../fs-utils.js";

type SetupOptions = {
  answers?: string[];
  cwd?: string;
  homeDir?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  startSection?: SetupSection;
};

type ProviderChoice = "openai" | "dummy" | "skip";
type ChannelChoice = "slack" | "discord" | "whatsapp" | "email";
type SetupSection = "all" | "model" | "project" | "server" | "channels" | "remotes";

export const normalizeSetupSection = (value: string | undefined): SetupSection | undefined => {
  switch (value?.toLowerCase()) {
    case undefined:
      return undefined;
    case "all":
      return "all";
    case "model":
      return "model";
    case "project":
      return "project";
    case "server":
      return "server";
    case "channel":
    case "channels":
      return "channels";
    case "remote":
    case "remotes":
      return "remotes";
    default:
      return undefined;
  }
};

type ServerConfigData = {
  defaultProject?: string;
  port?: number;
  projects?: ServerConfig["projects"];
  remotes?: ServerConfig["remotes"];
  channels?: {
    discord?: Partial<NonNullable<ServerConfig["channels"]>["discord"]>;
    email?: Partial<NonNullable<ServerConfig["channels"]>["email"]>;
    slack?: Partial<NonNullable<ServerConfig["channels"]>["slack"]>;
    whatsapp?: Partial<NonNullable<ServerConfig["channels"]>["whatsapp"]>;
  };
};
type ServerSecretsData = Partial<Omit<ServerSecrets, "configFile">>;

const OPENAI_SETUP_URL = "https://developers.openai.com/api/docs/quickstart";
const SLACK_SETUP_URL = "https://api.slack.com/apps";
const DISCORD_SETUP_URL = "https://discord.com/developers/applications";
const WHATSAPP_SETUP_URL = "https://developers.facebook.com/docs/whatsapp/cloud-api";
const GMAIL_APP_PASSWORDS_URL = "https://myaccount.google.com/apppasswords";

const expandHome = (value: string, homeDir: string): string => {
  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/")) {
    return path.join(homeDir, value.slice(2));
  }

  return value;
};

const emptyServerConfig = (): ServerConfigData => ({
  projects: [],
});

const loadSetupServerConfig = async (homeDir: string): Promise<ServerConfigData> => {
  return readJsonFile<ServerConfigData>(
    defaultServerConfigFile(homeDir),
    {},
  );
};

const loadSetupServerSecrets = async (homeDir: string): Promise<ServerSecretsData> => {
  return readJsonFile<ServerSecretsData>(
    defaultServerSecretsFile(homeDir),
    {},
  );
};

const projectConfigFileForFolder = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "maclaw.json");

const findExistingDefaultProjectFolder = (
  homeDir: string,
  serverConfig: ServerConfigData,
): string | undefined => {
  const configuredDefaultProject = serverConfig.defaultProject;
  if (configuredDefaultProject) {
    const configuredProject = (serverConfig.projects ?? []).find(
      (project) => project.name === configuredDefaultProject,
    );
    if (configuredProject && existsSync(projectConfigFileForFolder(configuredProject.folder))) {
      return configuredProject.folder;
    }
  }

  const fallbackProjectFolder = path.join(maclawHomeDir(homeDir), "projects", "default");
  return existsSync(projectConfigFileForFolder(fallbackProjectFolder))
    ? fallbackProjectFolder
    : undefined;
};

const loadExistingProjectConfig = async (
  projectFolder: string | undefined,
): Promise<Partial<ProjectConfig>> => {
  if (!projectFolder) {
    return {};
  }

  return readJsonFile<Partial<ProjectConfig>>(
    projectConfigFileForFolder(projectFolder),
    {},
  );
};

class SetupPrompter {
  private rl?: readline.Interface;

  constructor(
    private readonly input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
    private readonly answers: string[] = [],
  ) {}

  async close(): Promise<void> {
    this.rl?.close();
  }

  print(line = ""): void {
    this.output.write(`${line}\n`);
  }

  private printDefault(defaultValue: string): void {
    this.print(`Default: ${defaultValue}`);
  }

  private async waitForAnswer(prompt: string): Promise<string> {
    this.rl ??= readline.createInterface({
      input: this.input,
      output: this.output,
    });
    const rl = this.rl;

    let cancel = (): void => {};
    const cancelOnEof = new Promise<never>((_resolve, reject) => {
      cancel = (): void => {
        this.input.removeListener("end", cancel);
        this.input.removeListener("close", cancel);
        rl.removeListener("close", cancel);
        reject(new SetupCancelledError());
      };

      this.input.once("end", cancel);
      this.input.once("close", cancel);
      rl.once("close", cancel);
    });

    try {
      return await Promise.race([
        rl.question(prompt),
        cancelOnEof,
      ]);
    } finally {
      this.input.removeListener("end", cancel);
      this.input.removeListener("close", cancel);
      rl.removeListener("close", cancel);
    }
  }

  private async nextAnswer(prompt: string): Promise<string> {
    if (this.answers.length > 0) {
      const answer = this.answers.shift() ?? "";
      this.output.write(`${prompt}${answer}\n`);
      return answer.trim();
    }

    return (await this.waitForAnswer(prompt)).trim();
  }

  async askLine(
    prompt: string,
    defaultValue?: string,
    options: { preserveBlank?: boolean } = {},
  ): Promise<string> {
    this.print(prompt);
    if (defaultValue) {
      this.printDefault(defaultValue);
    }
    const answer = await this.nextAnswer("> ");
    if (options.preserveBlank && !answer) {
      return "";
    }
    return answer || defaultValue || "";
  }

  async askYesNo(prompt: string, defaultValue = true): Promise<boolean> {
    const defaultLabel = defaultValue ? "yes" : "no";
    while (true) {
      this.print(prompt);
      this.printDefault(defaultLabel);
      const answer = (await this.nextAnswer("> ")).toLowerCase();
      if (!answer) {
        return defaultValue;
      }

      if (["y", "yes"].includes(answer)) {
        return true;
      }

      if (["n", "no"].includes(answer)) {
        return false;
      }

      this.print("Please answer yes or no.");
    }
  }

  async askChoice<T extends string>(
    prompt: string,
    options: T[],
    defaultValue: T,
  ): Promise<T> {
    this.print(prompt);
    options.forEach((option, index) => {
      this.print(`  ${index + 1}. ${option}`);
    });
    this.printDefault(defaultValue);

    while (true) {
      const answer = (await this.nextAnswer("> ")).toLowerCase();
      if (!answer) {
        return defaultValue;
      }

      const optionByNumber = options[Number.parseInt(answer, 10) - 1];
      if (optionByNumber) {
        return optionByNumber;
      }

      const optionByName = options.find((option) => option.toLowerCase() === answer);
      if (optionByName) {
        return optionByName;
      }

      this.print(`Choose one of: ${options.join(", ")}`);
    }
  }

  async askMultiChoice<T extends string>(
    prompt: string,
    options: T[],
    settings: { skipOptionLabel?: string } = {},
  ): Promise<T[]> {
    this.print(prompt);
    options.forEach((option, index) => {
      this.print(`  ${index + 1}. ${option}`);
    });
    if (settings.skipOptionLabel) {
      this.print(`  ${options.length + 1}. ${settings.skipOptionLabel}`);
    }
    this.print("  Enter comma-separated numbers or names, or leave blank to skip.");

    while (true) {
      const answer = (await this.nextAnswer("> ")).toLowerCase();
      const skipNumber = String(options.length + 1);
      if (
        !answer
        || answer === "skip"
        || answer === "none"
        || (settings.skipOptionLabel && answer === settings.skipOptionLabel.toLowerCase())
        || (settings.skipOptionLabel && answer === skipNumber)
      ) {
        return [];
      }

      const values = answer
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const selected = new Set<T>();
      let valid = true;

      for (const value of values) {
        const byNumber = options[Number.parseInt(value, 10) - 1];
        const byName = options.find((option) => option.toLowerCase() === value);
        const match = byNumber ?? byName;
        if (!match) {
          valid = false;
          break;
        }

        selected.add(match);
      }

      if (valid) {
        return [...selected];
      }

      this.print(`Choose any of: ${options.join(", ")}, or skip.`);
    }
  }
}

class SetupCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
  }
}

const isSetupCancelledError = (error: unknown): boolean =>
  error instanceof SetupCancelledError
  || (error instanceof Error && error.name === "AbortError");

const runProviderSetup = async (
  prompt: SetupPrompter,
  projectConfig: Partial<ProjectConfig>,
  serverSecrets: ServerSecretsData,
): Promise<void> => {
  const existingModel = projectConfig.model
    ? parseConfiguredModel(normalizeConfiguredModel(projectConfig.model))
    : undefined;
  const providerChoice = await prompt.askChoice<ProviderChoice>(
    "Model source?",
    ["openai", "dummy", "skip"],
    existingModel?.provider ?? "openai",
  );

  if (providerChoice === "openai") {
    prompt.print();
    prompt.print("OpenAI API setup:");
    prompt.print(`  ${OPENAI_SETUP_URL}`);
    prompt.print("Suggested models:");
    prompt.print(renderModelSuggestions("openai"));

    const model = normalizeConfiguredModel(
      await prompt.askLine(
        "Model?",
        existingModel?.provider === "openai" ? existingModel.modelName : "gpt-5.4-mini",
      ),
      "openai",
    );
    const apiKey = await prompt.askLine("OpenAI API key");
    projectConfig.model = model;
    if (apiKey) {
      serverSecrets.openai = { apiKey };
    }
    return;
  }

  if (providerChoice === "dummy") {
    prompt.print();
    prompt.print("Suggested models:");
    prompt.print(renderModelSuggestions("dummy"));
    const model = normalizeConfiguredModel(
      await prompt.askLine(
        "Model?",
        existingModel?.provider === "dummy" ? existingModel.modelName : "default",
      ),
      "dummy",
    );
    projectConfig.model = model;
  }
};

const runProjectSetup = async (
  prompt: SetupPrompter,
  homeDir: string,
  projectConfig: Partial<ProjectConfig>,
  serverConfig: ServerConfigData,
): Promise<ProjectConfig | undefined> => {
  const existingDefaultProjectName = serverConfig.defaultProject;
  const existingDefaultProject = existingDefaultProjectName
    ? (serverConfig.projects ?? []).find((project) => project.name === existingDefaultProjectName)
    : undefined;
  const existingProjectFolder = existingDefaultProject?.folder
    ?? findExistingDefaultProjectFolder(homeDir, serverConfig);

  if (existingProjectFolder && existingDefaultProjectName) {
    prompt.print(`Found existing default project: ${existingDefaultProjectName}`);
    prompt.print(`  ${existingProjectFolder}`);
    prompt.print();
  }

  const projectName = await prompt.askLine(
    "Project name",
    existingDefaultProjectName ?? "default",
  );
  const defaultProjectFolder =
    existingProjectFolder && existingDefaultProjectName === projectName
      ? existingProjectFolder
      : path.join(maclawHomeDir(homeDir), "projects", projectName);
  const projectFolder = path.resolve(
    expandHome(
      await prompt.askLine("Project folder", defaultProjectFolder),
      homeDir,
    ),
  );

  if (
    existingDefaultProjectName
    && existingProjectFolder
    && (
      existingDefaultProjectName !== projectName
      || path.resolve(existingProjectFolder) !== projectFolder
    )
  ) {
    const shouldCreateAnotherProject = await prompt.askYesNo(
      `You already have default project ${existingDefaultProjectName}. Create another project?`,
      false,
    );
    if (!shouldCreateAnotherProject) {
      return undefined;
    }
  }

  const createdProject = await initProjectConfig(projectFolder, {
    ...projectConfig,
    name: projectName,
  });
  const shouldSetDefaultProject = await prompt.askYesNo(
    `Make ${createdProject.name} the default project?`,
    !existingDefaultProjectName || existingDefaultProjectName === createdProject.name,
  );
  if (shouldSetDefaultProject) {
    serverConfig.defaultProject = createdProject.name;
  }
  serverConfig.projects = [
    ...(serverConfig.projects ?? []).filter((project) => project.name !== createdProject.name),
    {
      name: createdProject.name,
      folder: createdProject.projectFolder,
    },
  ];
  return createdProject;
};

const runServerSetup = async (
  prompt: SetupPrompter,
  serverConfig: ServerConfigData,
  confirmSetup = true,
): Promise<boolean> => {
  const askServerPort = async (): Promise<void> => {
    const port = Number.parseInt(await prompt.askLine(
      "Server port",
      String(serverConfig.port ?? defaultServerPort()),
    ), 10) || defaultServerPort();
    serverConfig.port = port;
  };

  if (confirmSetup) {
    const setupServer = await prompt.askChoice(
      "Set up maclaw server?",
      ["yes", "skip"],
      "yes",
    );

    if (setupServer !== "yes") {
      return false;
    }
  }

  await askServerPort();

  const registeredProjects = serverConfig.projects ?? [];
  if (registeredProjects.length === 0) {
    prompt.print();
    prompt.print("No projects are registered in the server config yet.");
    prompt.print("Use the project step now, or update server.json later.");
    return true;
  }

  if (
    serverConfig.defaultProject
    && registeredProjects.some((project) => project.name === serverConfig.defaultProject)
  ) {
    prompt.print();
    prompt.print(`Found existing default server project: ${serverConfig.defaultProject}`);
    return true;
  }

  if (registeredProjects.length === 1) {
    serverConfig.defaultProject = registeredProjects[0]?.name;
    prompt.print();
    prompt.print(`Default server project: ${serverConfig.defaultProject}`);
    return true;
  }

  prompt.print();
  const projectNames = registeredProjects.map((project) => project.name);
  const defaultProject = await prompt.askChoice(
    "Default server project?",
    projectNames,
    projectNames.includes(serverConfig.defaultProject ?? "")
      ? serverConfig.defaultProject as string
      : projectNames[0],
  );
  serverConfig.defaultProject = defaultProject;
  return true;
};

// notes: Do not override server config until we receive a complete config from the user.
const runChannelSetup = async (
  prompt: SetupPrompter,
  serverConfig: ServerConfigData,
  serverSecrets: ServerSecretsData,
): Promise<boolean> => {
  const selectedChannels = await prompt.askMultiChoice<ChannelChoice>(
    "Enable channels?",
    [
      "slack",
      "discord",
      "whatsapp",
      "email",
    ],
    { skipOptionLabel: "skip" },
  );

  if (selectedChannels.length === 0) {
    return false;
  }

  if (selectedChannels.includes("slack")) {
    prompt.print();
    prompt.print("Slack setup:");
    prompt.print("  Create a Slack app and enable Socket Mode:");
    prompt.print(`  ${SLACK_SETUP_URL}`);
    printExistingChannelConfig(prompt, "slack", serverConfig.channels?.slack);
    const slackConfig = {
      ...(serverConfig.channels?.slack ?? {}),
      enabled: true,
    };
    const appToken = await prompt.askLine("Slack app token");
    const botToken = await prompt.askLine("Slack bot token");
    const slackSecrets =
      appToken || botToken
        ? {
            ...(appToken ? { appToken } : {}),
            ...(botToken ? { botToken } : {}),
          }
        : undefined;
    const channels = (serverConfig.channels ??= {});
    channels.slack = slackConfig;
    if (appToken || botToken) {
      serverSecrets.slack = slackSecrets;
    }
  }

  if (selectedChannels.includes("discord")) {
    prompt.print();
    prompt.print("Discord setup:");
    prompt.print("  Register a bot in the Discord Developer Portal:");
    prompt.print(`  ${DISCORD_SETUP_URL}`);
    printExistingChannelConfig(prompt, "discord", serverConfig.channels?.discord);
    const discordConfig = {
      ...(serverConfig.channels?.discord ?? {}),
      enabled: true,
    };
    const botToken = await prompt.askLine("Discord bot token");
    const channels = (serverConfig.channels ??= {});
    channels.discord = discordConfig;
    if (botToken) {
      serverSecrets.discord = { botToken };
    }
  }

  if (selectedChannels.includes("whatsapp")) {
    prompt.print();
    prompt.print("WhatsApp setup:");
    prompt.print("  Configure a WhatsApp Cloud API app and webhook:");
    prompt.print(`  ${WHATSAPP_SETUP_URL}`);
    prompt.print("  Warning: this exposes a public webhook, so be careful how and where you run it.");
    printExistingChannelConfig(prompt, "whatsapp", serverConfig.channels?.whatsapp);
    const phoneNumberId = await prompt.askLine("WhatsApp phone number id");
    const whatsappConfig = {
      ...(serverConfig.channels?.whatsapp ?? {}),
      enabled: true,
      ...(phoneNumberId ? { phoneNumberId } : {}),
    };
    const accessToken = await prompt.askLine("WhatsApp access token");
    const verifyToken = await prompt.askLine("WhatsApp verify token");
    const whatsappSecrets =
      accessToken || verifyToken
        ? {
            ...(accessToken ? { accessToken } : {}),
            ...(verifyToken ? { verifyToken } : {}),
          }
        : undefined;
    const channels = (serverConfig.channels ??= {});
    channels.whatsapp = whatsappConfig;
    if (accessToken || verifyToken) {
      serverSecrets.whatsapp = whatsappSecrets;
    }
  }

  if (selectedChannels.includes("email")) {
    prompt.print();
    prompt.print("Email setup:");
    prompt.print("  maclaw sends outbound email notifications over SMTP.");
    prompt.print("  For Gmail, use smtp.gmail.com:587 with STARTTLS and a Google App Password:");
    prompt.print(`  ${GMAIL_APP_PASSWORDS_URL}`);
    printExistingChannelConfig(prompt, "email", serverConfig.channels?.email);
    const from = await prompt.askLine("Email from address");
    const to = await prompt.askLine("Default email to address (optional)");
    const host = await prompt.askLine("SMTP host");
    const portText = await prompt.askLine("SMTP port", "587");
    const startTls = await prompt.askYesNo("Use STARTTLS?", true);
    const emailConfig = {
      ...(serverConfig.channels?.email ?? {}),
      enabled: true,
      from,
      ...(to ? { to } : {}),
      host,
      port: Number.parseInt(portText, 10) || 587,
      startTls,
    };
    const smtpUser = await prompt.askLine("SMTP username");
    const smtpPassword = await prompt.askLine("SMTP password");
    const emailSecrets =
      smtpUser || smtpPassword
        ? {
            ...(smtpUser ? { smtpUser } : {}),
            ...(smtpPassword ? { smtpPassword } : {}),
          }
        : undefined;
    const channels = (serverConfig.channels ??= {});
    channels.email = emailConfig;
    if (smtpUser || smtpPassword) {
      serverSecrets.email = emailSecrets;
    }
  }

  return true;
};

const runRemoteSetup = async (
  prompt: SetupPrompter,
  serverConfig: ServerConfigData,
  confirmSetup = true,
): Promise<boolean> => {
  if (confirmSetup) {
    const setupRemotes = await prompt.askChoice(
      "Set up remotes?",
      ["yes", "skip"],
      "skip",
    );
    if (setupRemotes !== "yes") {
      return false;
    }
  }

  prompt.print();
  prompt.print("Remote setup:");
  prompt.print("  A remote lets maclaw open a temporary SSH tunnel for teleport.");
  prompt.print("  Run `maclaw server --api-only` on the remote host.");

  const configuredRemoteNames = (serverConfig.remotes ?? []).map((remote) => remote.name);
  if (configuredRemoteNames.length > 0) {
    prompt.print(`Configured remotes: ${configuredRemoteNames.join(", ")}`);
  }

  const remoteName = await prompt.askLine(
    "Remote name",
    configuredRemoteNames[0] ?? "remote",
  );
  const existingRemote = (serverConfig.remotes ?? []).find((remote) => remote.name === remoteName);
  printExistingRemoteConfig(prompt, existingRemote);
  const existingSshRemote: RemoteConfig | undefined =
    existingRemote?.provider === "ssh" ? existingRemote : undefined;
  const existingSshConfig = existingSshRemote?.metadata as SshConfig | undefined;

  const sshHost = await prompt.askLine(
    "SSH host",
    existingSshConfig?.host ?? "",
  );
  const sshUser = await prompt.askLine(
    "SSH user (optional)",
    existingSshConfig?.user ?? "",
    { preserveBlank: true },
  );
  const sshPort = Number.parseInt(
    await prompt.askLine(
      "SSH port",
      String(existingSshConfig?.port ?? 22),
    ),
    10,
  ) || 22;
  const remoteServerPort = Number.parseInt(
    await prompt.askLine(
      "Remote maclaw server port",
      String(existingRemote?.remoteServerPort ?? defaultServerPort()),
    ),
    10,
  ) || defaultServerPort();
  const localForwardPort = Number.parseInt(
    await prompt.askLine(
      "Local forwarded port",
      String(existingRemote?.localForwardPort ?? defaultTeleportForwardPort()),
    ),
    10,
  ) || defaultTeleportForwardPort();

  const remoteConfig: RemoteConfig = {
    name: remoteName,
    provider: "ssh",
    metadata: {
      host: sshHost,
      ...(sshUser ? { user: sshUser } : {}),
      port: sshPort,
    },
    remoteServerPort,
    localForwardPort,
  };
  serverConfig.remotes = [
    ...(serverConfig.remotes ?? []).filter((remote) => remote.name !== remoteName),
    remoteConfig,
  ];
  return true;
};

const writeSetupConfig = async (
  homeDir: string,
  serverConfig: ServerConfigData,
  serverSecrets: ServerSecretsData,
  writtenFiles: string[],
): Promise<void> => {
  const serverConfigPath = defaultServerConfigFile(homeDir);
  const serverSecretsPath = defaultServerSecretsFile(homeDir);

  await writeJsonFile(serverConfigPath, serverConfig);
  writtenFiles.push(serverConfigPath);

  await writeJsonFile(serverSecretsPath, serverSecrets);
  writtenFiles.push(serverSecretsPath);
};

const printExistingConfigStatus = (
  prompt: SetupPrompter,
  homeDir: string,
  serverConfig: ServerConfigData,
): void => {
  const serverConfigPath = defaultServerConfigFile(homeDir);

  if (existsSync(serverConfigPath)) {
    prompt.print(`Found existing server config: ${serverConfigPath}`);
    const configuredChannels = Object.entries(serverConfig.channels ?? {})
      .filter(([, channelConfig]) => channelConfig?.enabled)
      .map(([channelName]) => channelName);
    if (configuredChannels.length > 0) {
      prompt.print(`Configured channels: ${configuredChannels.join(", ")}`);
    }
    const configuredRemotes = (serverConfig.remotes ?? []).map((remote) => remote.name);
    if (configuredRemotes.length > 0) {
      prompt.print(`Configured remotes: ${configuredRemotes.join(", ")}`);
    }
  }

  if (existsSync(serverConfigPath)) {
    prompt.print();
  }
};

const printExistingChannelConfig = (
  prompt: SetupPrompter,
  channelName: string,
  channelConfig: unknown,
): void => {
  if (!channelConfig) {
    return;
  }

  prompt.print(`Current ${channelName} config:`);
  prompt.print(JSON.stringify(channelConfig, null, 2));
};

const printExistingRemoteConfig = (
  prompt: SetupPrompter,
  remoteConfig: RemoteConfig | undefined,
): void => {
  if (!remoteConfig) {
    return;
  }

  prompt.print(`Current remote config for ${remoteConfig.name}:`);
  prompt.print(JSON.stringify(remoteConfig, null, 2));
};

const askSetupSection = async (prompt: SetupPrompter): Promise<SetupSection> => {
  return prompt.askChoice<SetupSection>(
    "Where do you want to start?",
    ["all", "model", "project", "server", "channels", "remotes"],
    "all",
  );
};

const SETUP_BANNER = [
  "                      _                ",
  " _ __ ___   __ _  ___| | __ ___      __",
  "| '_ ` _ \\ / _` |/ __| |/ _` \\ \\ /\\ / /",
  "| | | | | | (_| | (__| | (_| |\\ V  V / ",
  "|_| |_| |_|\\__,_|\\___|_|\\__,_| \\_/\\_/  ",
];

const runSetupFlow = async (
  prompt: SetupPrompter,
  homeDir: string,
  startSection?: SetupSection,
): Promise<void> => {
  const writtenFiles: string[] = [];

  if (!startSection) {
    SETUP_BANNER.forEach((line) => {
      prompt.print(line);
    });
    prompt.print("Welcome to maclaw setup!");
    prompt.print();
    prompt.print("This setup will help you configure:");
    prompt.print("  1. Model");
    prompt.print("  2. Project");
    prompt.print("  3. Channels");
    prompt.print("  4. Server");
    prompt.print("  5. Remotes");
    prompt.print();
    prompt.print("It should take under 1 minute.");
    prompt.print();
  }

  const setupSection = startSection ?? await askSetupSection(prompt);
  if (!startSection) {
    prompt.print();
  }

  const globalHome = maclawHomeDir(homeDir);
  const hasExistingServerConfig = existsSync(defaultServerConfigFile(homeDir));
  const hasExistingGlobalHome = existsSync(globalHome);
  const saveGlobalConfig = hasExistingGlobalHome
    ? true
    : await prompt.askYesNo(
        `maclaw can save server config and API secrets in ${globalHome}. Is that OK?`,
        true,
      );
  if (!saveGlobalConfig) {
    prompt.print(`Global config will not be written. You can configure ${globalHome} manually later.`);
    prompt.print();
  }

  const projectConfig: Partial<ProjectConfig> = {};
  const serverConfig = saveGlobalConfig
    ? await loadSetupServerConfig(homeDir)
    : emptyServerConfig();
  const serverSecrets = saveGlobalConfig
    ? await loadSetupServerSecrets(homeDir)
    : {};
  const existingProjectConfig = await loadExistingProjectConfig(
    findExistingDefaultProjectFolder(homeDir, serverConfig),
  );

  Object.assign(projectConfig, existingProjectConfig);

  if (saveGlobalConfig) {
    printExistingConfigStatus(prompt, homeDir, serverConfig);
  }

  if (setupSection === "all" || setupSection === "model") {
    await runProviderSetup(prompt, projectConfig, serverSecrets);
  }

  const defaultProject =
    setupSection === "all" || setupSection === "project"
      ? await runProjectSetup(
          prompt,
          homeDir,
          projectConfig,
          serverConfig,
        )
      : undefined;
  if (defaultProject) {
    writtenFiles.push(defaultProject.projectConfigFile);
  }

  const configuredServer = saveGlobalConfig
    && (setupSection === "all" || setupSection === "server")
    ? await runServerSetup(prompt, serverConfig, setupSection !== "server")
    : false;
  const configuredChannels = saveGlobalConfig
    && (setupSection === "all" || setupSection === "channels")
    ? await runChannelSetup(prompt, serverConfig, serverSecrets)
    : false;
  const configuredRemotes = saveGlobalConfig
    && (setupSection === "all" || setupSection === "remotes")
    ? await runRemoteSetup(prompt, serverConfig, setupSection !== "remotes")
    : false;
  const shouldShowServerCommand =
    Boolean(defaultProject) || configuredServer || configuredChannels || configuredRemotes;

  if (saveGlobalConfig) {
    await writeSetupConfig(
      homeDir,
      serverConfig,
      serverSecrets,
      writtenFiles,
    );
  }

  if (writtenFiles.length > 0) {
    prompt.print();
    prompt.print("Writing:");
    writtenFiles.forEach((filePath) => {
      prompt.print(`  ${filePath}`);
    });
  }

  prompt.print();
  prompt.print("Done! 🦞");
  prompt.print("Run:");
  prompt.print("  maclaw");
  if (shouldShowServerCommand) {
    prompt.print("  maclaw server");
  }
};

const logSetupError = (error: unknown): void => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`\n[maclaw setup] failed\n${message}\n`);
};

export const runSetup = async ({
  answers = [],
  cwd = process.cwd(),
  homeDir = os.homedir(),
  input = process.stdin,
  output = process.stdout,
  startSection,
}: SetupOptions = {}): Promise<void> => {
  const prompt = new SetupPrompter(input, output, answers);

  try {
    await runSetupFlow(prompt, homeDir, startSection);
  } catch (error) {
    if (isSetupCancelledError(error)) {
      output.write("\nBye!\n");
      return;
    }

    logSetupError(error);
    throw error;
  } finally {
    await prompt.close();
  }
};

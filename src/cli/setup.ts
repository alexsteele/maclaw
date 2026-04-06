/**
 * Interactive first-run setup for provider, project, and server/channel config.
 *
 * Proposal and example flow:
 * - docs/setup.md
 */
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { initProjectConfig, type ProjectConfig } from "../config.js";
import {
  defaultServerConfigFile,
  defaultServerSecretsFile,
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
};

type ProviderChoice = "openai" | "dummy" | "skip";
type ChannelChoice = "slack" | "discord" | "whatsapp";

type ServerConfigData = {
  defaultProject?: string;
  projects?: ServerConfig["projects"];
  channels?: {
    discord?: Partial<ServerConfig["channels"]["discord"]>;
    slack?: Partial<ServerConfig["channels"]["slack"]>;
    whatsapp?: Partial<ServerConfig["channels"]["whatsapp"]>;
  };
};
type ServerSecretsData = Partial<Omit<ServerSecrets, "configFile">>;

const OPENAI_SETUP_URL = "https://developers.openai.com/api/docs/quickstart";
const SLACK_SETUP_URL = "https://api.slack.com/apps";
const DISCORD_SETUP_URL = "https://discord.com/developers/applications";
const WHATSAPP_SETUP_URL = "https://developers.facebook.com/docs/whatsapp/cloud-api";

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

  private async nextAnswer(prompt: string): Promise<string> {
    if (this.answers.length > 0) {
      const answer = this.answers.shift() ?? "";
      this.output.write(`${prompt}${answer}\n`);
      return answer.trim();
    }

    this.rl ??= readline.createInterface({
      input: this.input,
      output: this.output,
    });
    return (await this.rl.question(prompt)).trim();
  }

  async askLine(prompt: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = await this.nextAnswer(`${prompt}${suffix}\n> `);
    return answer || defaultValue || "";
  }

  async askYesNo(prompt: string, defaultValue = true): Promise<boolean> {
    const defaultLabel = defaultValue ? "yes" : "no";
    while (true) {
      const answer = (await this.nextAnswer(`${prompt} [${defaultLabel}]\n> `)).toLowerCase();
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
  ): Promise<T[]> {
    this.print(prompt);
    options.forEach((option, index) => {
      this.print(`  ${index + 1}. ${option}`);
    });
    this.print("  Enter comma-separated numbers or names, or leave blank to skip.");

    while (true) {
      const answer = (await this.nextAnswer("> ")).toLowerCase();
      if (!answer || answer === "skip" || answer === "none") {
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

const runProviderSetup = async (
  prompt: SetupPrompter,
  projectConfig: Partial<ProjectConfig>,
  serverSecrets: ServerSecretsData,
): Promise<void> => {
  const providerChoice = await prompt.askChoice<ProviderChoice>(
    "Provider?",
    ["openai", "dummy", "skip"],
    "openai",
  );

  if (providerChoice === "openai") {
    prompt.print();
    prompt.print("OpenAI API setup:");
    prompt.print(`  ${OPENAI_SETUP_URL}`);

    projectConfig.provider = "openai";
    projectConfig.model = await prompt.askLine("Model?", "gpt-5.4-mini");
    const apiKey = await prompt.askLine("OpenAI API key");
    if (apiKey) {
      serverSecrets.openai = { apiKey };
    }
    return;
  }

  if (providerChoice === "dummy") {
    projectConfig.provider = "dummy";
    projectConfig.model = await prompt.askLine("Model?", "dummy-model");
  }
};

const runProjectSetup = async (
  prompt: SetupPrompter,
  homeDir: string,
  projectConfig: Partial<ProjectConfig>,
  serverConfig: ServerConfigData,
): Promise<ProjectConfig | undefined> => {
  const defaultProjectLocation = "~/.maclaw/projects/default";
  const projectChoice = await prompt.askChoice(
    `Create a default project in ${defaultProjectLocation}?`,
    ["yes", "no", "other location"],
    "yes",
  );

  if (projectChoice === "no") {
    return undefined;
  }

  const projectFolder = path.resolve(
    expandHome(
      projectChoice === "other location"
        ? await prompt.askLine("Where should the default project live?")
        : defaultProjectLocation,
      homeDir,
    ),
  );

  const defaultProject = await initProjectConfig(projectFolder, projectConfig);
  serverConfig.defaultProject = defaultProject.name;
  serverConfig.projects = [
    ...(serverConfig.projects ?? []).filter((project) => project.name !== defaultProject.name),
    {
      name: defaultProject.name,
      folder: defaultProject.projectFolder,
    },
  ];
  return defaultProject;
};

const runServerSetup = async (
  prompt: SetupPrompter,
  serverConfig: ServerConfigData,
  serverSecrets: ServerSecretsData,
): Promise<boolean> => {
  const setupServer = await prompt.askChoice(
    "Set up maclaw server and connectors?",
    ["yes", "skip"],
    "skip",
  );

  if (setupServer !== "yes") {
    return false;
  }

  const selectedChannels = await prompt.askMultiChoice<ChannelChoice>("Enable channels?", [
    "slack",
    "discord",
    "whatsapp",
  ]);

  if (selectedChannels.includes("slack")) {
    prompt.print();
    prompt.print("Slack setup:");
    prompt.print("  Create a Slack app and enable Socket Mode:");
    prompt.print(`  ${SLACK_SETUP_URL}`);
    const channels = (serverConfig.channels ??= {});
    channels.slack = {
      ...(channels.slack ?? {}),
      enabled: true,
    };
    const appToken = await prompt.askLine("Slack app token");
    const botToken = await prompt.askLine("Slack bot token");
    if (appToken || botToken) {
      serverSecrets.slack = {
        ...(appToken ? { appToken } : {}),
        ...(botToken ? { botToken } : {}),
      };
    }
  }

  if (selectedChannels.includes("discord")) {
    prompt.print();
    prompt.print("Discord setup:");
    prompt.print("  Register a bot in the Discord Developer Portal:");
    prompt.print(`  ${DISCORD_SETUP_URL}`);
    const channels = (serverConfig.channels ??= {});
    channels.discord = {
      ...(channels.discord ?? {}),
      enabled: true,
    };
    const botToken = await prompt.askLine("Discord bot token");
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
    const channels = (serverConfig.channels ??= {});
    const phoneNumberId = await prompt.askLine("WhatsApp phone number id");
    channels.whatsapp = {
      ...(channels.whatsapp ?? {}),
      enabled: true,
      ...(phoneNumberId ? { phoneNumberId } : {}),
    };
    const accessToken = await prompt.askLine("WhatsApp access token");
    const verifyToken = await prompt.askLine("WhatsApp verify token");
    if (accessToken || verifyToken) {
      serverSecrets.whatsapp = {
        ...(accessToken ? { accessToken } : {}),
        ...(verifyToken ? { verifyToken } : {}),
      };
    }
  }

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

const runSetupFlow = async (
  prompt: SetupPrompter,
  homeDir: string,
): Promise<void> => {
  const writtenFiles: string[] = [];

  prompt.print("Welcome to maclaw setup.");
  prompt.print();
  prompt.print("This setup will help you:");
  prompt.print("  1. Choose a provider and model");
  prompt.print("  2. Pick a default project");
  prompt.print("  3. Optionally configure maclaw server and connectors");
  prompt.print();
  prompt.print("Once complete, you can run a local maclaw REPL with `maclaw` and a server with");
  prompt.print("`maclaw server`.");
  prompt.print();

  const saveGlobalConfig = await prompt.askYesNo(
    "maclaw can save server config and API secrets in ~/.maclaw. Is that OK?",
    true,
  );
  if (!saveGlobalConfig) {
    prompt.print("Global config will not be written. You can configure ~/.maclaw manually later.");
    prompt.print();
  }

  const projectConfig: Partial<ProjectConfig> = {};
  const serverConfig = saveGlobalConfig
    ? await loadSetupServerConfig(homeDir)
    : emptyServerConfig();
  const serverSecrets = saveGlobalConfig
    ? await loadSetupServerSecrets(homeDir)
    : {};

  await runProviderSetup(prompt, projectConfig, serverSecrets);

  const defaultProject = await runProjectSetup(prompt, homeDir, projectConfig, serverConfig);
  if (defaultProject) {
    writtenFiles.push(defaultProject.projectConfigFile);
  }

  const configuredServer = saveGlobalConfig
    ? await runServerSetup(prompt, serverConfig, serverSecrets)
    : false;
  const shouldShowServerCommand = Boolean(defaultProject) || configuredServer;

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
  prompt.print("Done.");
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
  homeDir = os.homedir(),
  input = process.stdin,
  output = process.stdout,
}: SetupOptions = {}): Promise<void> => {
  const prompt = new SetupPrompter(input, output, answers);

  try {
    await runSetupFlow(prompt, homeDir);
  } catch (error) {
    logSetupError(error);
    throw error;
  } finally {
    await prompt.close();
  }
};

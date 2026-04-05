/**
 * Interactive first-run setup for provider, project, and server/channel config.
 *
 * Proposal and example flow:
 * - docs/setup.md
 */
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { initProjectConfig, type ProjectConfig } from "./config.js";
import {
  type ServerConfig,
  type ServerSecrets,
} from "./server-config.js";
import { writeJsonFile } from "./fs-utils.js";

type SetupOptions = {
  answers?: string[];
  cwd?: string;
  homeDir?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

type ProviderChoice = "openai" | "dummy" | "skip";
type ChannelChoice = "slack" | "discord" | "whatsapp";

const OPENAI_SETUP_URL = "https://developers.openai.com/api/docs/quickstart";
const SLACK_SETUP_URL = "https://api.slack.com/apps";
const DISCORD_SETUP_URL = "https://discord.com/developers/applications";
const WHATSAPP_SETUP_URL = "https://developers.facebook.com/docs/whatsapp/cloud-api";

const defaultSetupProjectFolder = (homeDir: string): string =>
  path.join(homeDir, "maclaw-projects", "default");

const defaultSetupServerConfigFile = (homeDir: string): string =>
  path.join(homeDir, ".maclaw", "server.json");

const defaultSetupServerSecretsFile = (homeDir: string): string =>
  path.join(homeDir, ".maclaw", "secrets.json");

const expandHome = (value: string, homeDir: string): string => {
  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/")) {
    return path.join(homeDir, value.slice(2));
  }

  return value;
};

class SetupPrompter {
  private readonly rl: readline.Interface;

  constructor(
    input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
    private readonly answers: string[] = [],
  ) {
    this.rl = readline.createInterface({ input, output });
  }

  async close(): Promise<void> {
    this.rl.close();
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

  const allowGlobalWrites = await prompt.askYesNo(
    "maclaw can save server config and API secrets in ~/.maclaw. Is that OK?",
    true,
  );

  const providerChoice = await prompt.askChoice<ProviderChoice>(
    "Provider?",
    ["openai", "dummy", "skip"],
    "openai",
  );

  let provider: ProjectConfig["provider"] | undefined;
  let model: string | undefined;
  let openAiApiKey: string | undefined;

  if (providerChoice === "openai") {
    provider = "openai";
    prompt.print();
    prompt.print("OpenAI API setup:");
    prompt.print(`  ${OPENAI_SETUP_URL}`);
    if (allowGlobalWrites) {
      openAiApiKey = await prompt.askLine("OpenAI API key");
    } else {
      prompt.print("OpenAI API keys will not be saved. You can set OPENAI_API_KEY later.");
    }
    model = await prompt.askLine("Model?", "gpt-5.4-mini");
  } else if (providerChoice === "dummy") {
    provider = "local";
    model = await prompt.askLine("Model?", "dummy-model");
  }

  const createDefaultProject = await prompt.askYesNo(
    "Do you want to create a default project?",
    true,
  );

  let defaultProject: ProjectConfig | undefined;
  if (createDefaultProject) {
    const projectFolder = path.resolve(
      expandHome(
        await prompt.askLine(
          "Where should the default project live?",
          "~/maclaw-projects/default",
        ),
        homeDir,
      ),
    );
    defaultProject = await initProjectConfig(projectFolder, {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    });
    writtenFiles.push(defaultProject.projectConfigFile);
  }

  let selectedChannels: ChannelChoice[] = [];
  let slackAppToken = "";
  let slackBotToken = "";
  let discordBotToken = "";
  let whatsappPhoneNumberId = "";
  let whatsappAccessToken = "";
  let whatsappVerifyToken = "";

  const setupServer = allowGlobalWrites
    ? await prompt.askChoice("Set up maclaw server and connectors?", ["yes", "skip"], "skip")
    : "skip";

  if (setupServer === "yes") {
    selectedChannels = await prompt.askMultiChoice<ChannelChoice>("Enable channels?", [
      "slack",
      "discord",
      "whatsapp",
    ]);

    if (selectedChannels.includes("slack")) {
      prompt.print();
      prompt.print("Slack setup:");
      prompt.print("  Create a Slack app and enable Socket Mode:");
      prompt.print(`  ${SLACK_SETUP_URL}`);
      slackAppToken = await prompt.askLine("Slack app token");
      slackBotToken = await prompt.askLine("Slack bot token");
    }

    if (selectedChannels.includes("discord")) {
      prompt.print();
      prompt.print("Discord setup:");
      prompt.print("  Register a bot in the Discord Developer Portal:");
      prompt.print(`  ${DISCORD_SETUP_URL}`);
      discordBotToken = await prompt.askLine("Discord bot token");
    }

    if (selectedChannels.includes("whatsapp")) {
      prompt.print();
      prompt.print("WhatsApp setup:");
      prompt.print("  Configure a WhatsApp Cloud API app and webhook:");
      prompt.print(`  ${WHATSAPP_SETUP_URL}`);
      prompt.print("  Warning: this exposes a public webhook, so be careful how and where you run it.");
      whatsappPhoneNumberId = await prompt.askLine("WhatsApp phone number id");
      whatsappAccessToken = await prompt.askLine("WhatsApp access token");
      whatsappVerifyToken = await prompt.askLine("WhatsApp verify token");
    }
  }

  const shouldWriteServerConfig =
    allowGlobalWrites && (setupServer === "yes" || Boolean(openAiApiKey));

  if (shouldWriteServerConfig) {
    const serverConfigPath = defaultSetupServerConfigFile(homeDir);
    const serverSecretsPath = defaultSetupServerSecretsFile(homeDir);
    const serverConfig: Omit<ServerConfig, "configFile"> = {
      defaultProject: defaultProject?.name,
      projects: defaultProject
        ? [{ name: defaultProject.name, folder: defaultProject.projectFolder }]
        : [],
      channels: {
        discord: {
          enabled: selectedChannels.includes("discord"),
        },
        slack: {
          enabled: selectedChannels.includes("slack"),
        },
        whatsapp: {
          enabled: selectedChannels.includes("whatsapp"),
          graphApiVersion: "v23.0",
          phoneNumberId: whatsappPhoneNumberId || undefined,
          port: 3000,
          webhookPath: "/whatsapp/webhook",
        },
      },
    };
    const serverSecrets: Omit<ServerSecrets, "configFile"> = {
      openai: {
        apiKey: openAiApiKey || undefined,
      },
      discord: {
        botToken: discordBotToken || undefined,
      },
      slack: {
        appToken: slackAppToken || undefined,
        botToken: slackBotToken || undefined,
      },
      whatsapp: {
        accessToken: whatsappAccessToken || undefined,
        verifyToken: whatsappVerifyToken || undefined,
      },
    };

    if (setupServer === "yes") {
      await writeJsonFile(serverConfigPath, serverConfig);
      writtenFiles.push(serverConfigPath);
    }

    if (
      openAiApiKey ||
      discordBotToken ||
      slackAppToken ||
      slackBotToken ||
      whatsappAccessToken ||
      whatsappVerifyToken
    ) {
      await writeJsonFile(serverSecretsPath, serverSecrets);
      writtenFiles.push(serverSecretsPath);
    }
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
  if (setupServer === "yes") {
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

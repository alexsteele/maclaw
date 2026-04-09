// Curated model suggestions for setup and help surfaces.
// These are suggestions, not an authoritative model registry.

export type ModelSuggestion = {
  id: string;
  tags: string[];
  description: string;
};

export const OPENAI_MODELS_URL = "https://platform.openai.com/docs/models";
export const DEFAULT_MODEL = "openai/gpt-4.1-mini";

export const modelSuggestions: ModelSuggestion[] = [
  {
    id: "openai/gpt-5.4-nano",
    tags: ["small", "cheap"],
    description: "Lightweight model for simple tasks and lower-cost automation.",
  },
  {
    id: "openai/gpt-5.4-mini",
    tags: ["fast", "recommended"],
    description: "Good default for everyday chat and agent work.",
  },
  {
    id: "openai/gpt-5.4",
    tags: ["reasoning", "strong"],
    description: "Smartest frontier model.",
  },
  {
    id: "dummy/default",
    tags: ["local", "testing"],
    description: "Built-in stand-in provider for local testing without API calls.",
  },
];

export const listSuggestedModels = (
  provider?: "openai" | "dummy",
): ModelSuggestion[] => {
  if (!provider) {
    return modelSuggestions;
  }

  return modelSuggestions.filter((model) => model.id.startsWith(`${provider}/`));
};

export const renderModelSuggestions = (
  provider?: "openai" | "dummy",
): string => {
  const lines = listSuggestedModels(provider).map(
    (model) => `- ${model.id} [${model.tags.join(", ")}]: ${model.description}`,
  );

  return [...lines, "", `OpenAI model docs: ${OPENAI_MODELS_URL}`].join("\n");
};

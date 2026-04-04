import type {
  ProviderRequest,
  ProviderResult,
  SessionRecord,
  ToolDefinition,
} from "./types.js";

type ResponsesApiOutputItem = {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string;
};

type ResponsesApiResponse = {
  output?: ResponsesApiOutputItem[];
  output_text?: string;
};

const buildToolSpec = (tool: ToolDefinition): Record<string, unknown> => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
});

const conversationInput = (session: SessionRecord): Array<Record<string, unknown>> => {
  return session.messages.map((message) => ({
    role: message.role,
    content: [{ type: "input_text", text: message.content }],
  }));
};

export interface Provider {
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

export class LocalFallbackProvider implements Provider {
  async generate(request: ProviderRequest): Promise<ProviderResult> {
    return {
      outputText: [
        "No OpenAI API key is configured yet.",
        "",
        "The harness is still working locally. Try asking it to list skills or tasks once a model is configured.",
        "",
        `You said: ${request.userInput}`,
      ].join("\n"),
    };
  }
}

export class OpenAIResponsesProvider implements Provider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const toolsByName = new Map(request.tools.map((tool) => [tool.name, tool]));
    const input: Array<Record<string, unknown>> = [
      { role: "system", content: [{ type: "input_text", text: request.systemPrompt }] },
      ...conversationInput(request.session),
    ];

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const response = await this.createResponse(input, request.tools);
      const output = response.output ?? [];
      const toolCalls = output.filter((item) => item.type === "function_call");

      if (toolCalls.length === 0) {
        return {
          outputText: response.output_text?.trim() || "The model returned no text.",
        };
      }

      for (const toolCall of toolCalls) {
        const tool = toolCall.name ? toolsByName.get(toolCall.name) : undefined;
        if (!tool || !toolCall.call_id) {
          continue;
        }

        let outputText: string;
        try {
          const parsedArguments = toolCall.arguments
            ? JSON.parse(toolCall.arguments)
            : {};
          outputText = await tool.execute(parsedArguments);
        } catch (error) {
          outputText = `Tool execution failed: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }

        input.push({
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: outputText,
        });
      }
    }

    return {
      outputText: "Stopped after too many tool-calling iterations.",
    };
  }

  private async createResponse(
    input: Array<Record<string, unknown>>,
    tools: ToolDefinition[],
  ): Promise<ResponsesApiResponse> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input,
        tools: tools.map(buildToolSpec),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API request failed: ${response.status} ${body}`);
    }

    return (await response.json()) as ResponsesApiResponse;
  }
}

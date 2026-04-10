import type { ChannelTarget } from "../types.js";

export type ChannelMessage = {
  channel: string;
  text: string;
  userId: string;
  conversationId?: string;
  threadId?: string;
};

export type ChannelMessageHandler = (
  message: ChannelMessage,
) => Promise<string | null>;

// Communications channel between the user and maclaw such as whatsapp.
// Handlers receive a message from the user and send an optional message back.
export interface Channel {
  readonly name: string;
  start(messageHandler?: ChannelMessageHandler): Promise<void>;
  send(target: ChannelTarget, text: string): Promise<void>;
  stop(): Promise<void>;
}

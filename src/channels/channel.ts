export type ChannelMessage = {
  channel: string;
  text: string;
  userId: string;
};

export type ChannelMessageHandler = (
  message: ChannelMessage,
) => Promise<string | null>;

// Communications channel between the user and maclaw such as whatsapp.
// Handlers receive a message from the user and send an optional message back.
export interface Channel {
  readonly name: string;
  start(messageHandler?: ChannelMessageHandler): Promise<void>;
  stop(): Promise<void>;
}

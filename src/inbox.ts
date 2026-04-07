// Inbox stores notifications.
// Stored behind a small store interface so we can swap in sqlite later.
import { appendJsonLine, makeId, readJsonLines } from "./fs-utils.js";
import type { InboxEntry, NotificationKind, Origin } from "./types.js";

export const createInboxEntry = (input: {
  kind: NotificationKind;
  text: string;
  origin: Origin;
}): InboxEntry => ({
  id: makeId("inbox"),
  kind: input.kind,
  text: input.text,
  origin: input.origin,
  createdAt: new Date().toISOString(),
});

export interface InboxStore {
  loadEntries(): Promise<InboxEntry[]>;
  saveEntry(entry: InboxEntry): Promise<void>;
}

export class JsonFileInboxStore implements InboxStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  loadEntries(): Promise<InboxEntry[]> {
    return readJsonLines<InboxEntry>(this.filePath);
  }

  saveEntry(entry: InboxEntry): Promise<void> {
    return appendJsonLine(this.filePath, entry);
  }
}

export class MemoryInboxStore implements InboxStore {
  private entries: InboxEntry[] = [];

  async loadEntries(): Promise<InboxEntry[]> {
    return structuredClone(this.entries);
  }

  async saveEntry(entry: InboxEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }
}

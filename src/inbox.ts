// Inbox stores notifications.
// Stored behind a small store interface so we can swap in sqlite later.
import { makeId } from "./fs-utils.js";
import type { InboxEntry, NotificationKind, Origin } from "./types.js";

export const createInboxEntry = (input: {
  kind: NotificationKind;
  text: string;
  origin: Origin;
  sourceType: InboxEntry["sourceType"];
  sourceId: string;
  sourceName?: string;
}): InboxEntry => {
  const timestamp = new Date().toISOString();
  return {
    id: makeId("inbox"),
    kind: input.kind,
    text: input.text,
    origin: input.origin,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    createdAt: timestamp,
    sentAt: timestamp,
  };
};

export interface InboxStore {
  loadEntries(): Promise<InboxEntry[]>;
  saveEntry(entry: InboxEntry): Promise<void>;
  deleteEntry(entryId: string): Promise<boolean>;
  clearEntries(): Promise<number>;
}

export class MemoryInboxStore implements InboxStore {
  private entries: InboxEntry[] = [];

  async loadEntries(): Promise<InboxEntry[]> {
    return structuredClone(this.entries);
  }

  async saveEntry(entry: InboxEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    const nextEntries = this.entries.filter((entry) => entry.id !== entryId);
    const deleted = nextEntries.length !== this.entries.length;
    this.entries = nextEntries;
    return deleted;
  }

  async clearEntries(): Promise<number> {
    const count = this.entries.length;
    this.entries = [];
    return count;
  }
}

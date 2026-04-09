// Notification selector and policy helpers used by config and harness.
// note: We expand the allowed notification types at startup.
import type { NotificationKind, NotificationPolicy, NotificationSelector } from "./types.js";

export const ALL_NOTIFICATION_KINDS: NotificationKind[] = [
  "agentCompleted",
  "agentFailed",
  "taskCompleted",
  "taskFailed",
  "manual",
];

const NOTIFICATION_SELECTORS = new Set<NotificationSelector>([
  ...ALL_NOTIFICATION_KINDS,
  "agent:*",
  "task:*",
  "errors",
]);

export const isNotificationSelector = (value: unknown): value is NotificationSelector =>
  typeof value === "string" && NOTIFICATION_SELECTORS.has(value as NotificationSelector);

export const normalizeNotificationSelectors = (
  value: unknown,
): NotificationSelector[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const selectors = value.filter(isNotificationSelector);
  return selectors.length === value.length ? selectors : undefined;
};

type ParsedNotificationSelectors = {
  selectors?: NotificationSelector[];
  invalidSelectors: string[];
};

export type ParsedNotificationPolicy = {
  policy: NotificationPolicy;
  invalidSelectors: string[];
};

const parseNotificationSelectors = (value: unknown): ParsedNotificationSelectors => {
  if (!Array.isArray(value)) {
    return { invalidSelectors: [] };
  }

  const selectors: NotificationSelector[] = [];
  const invalidSelectors: string[] = [];
  for (const item of value) {
    if (isNotificationSelector(item)) {
      selectors.push(item);
      continue;
    }

    invalidSelectors.push(String(item));
  }

  return {
    selectors: invalidSelectors.length === 0 ? selectors : undefined,
    invalidSelectors,
  };
};

export const parseNotifications = (value: unknown): ParsedNotificationPolicy => {
  if (value === "all" || value === "none") {
    return {
      policy: value,
      invalidSelectors: [],
    };
  }

  if (Array.isArray(value)) {
    const parsed = parseNotificationSelectors(value);
    return {
      policy: parsed.selectors ?? "all",
      invalidSelectors: parsed.invalidSelectors,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      policy: "all",
      invalidSelectors: [],
    };
  }

  const object = value as { allow?: unknown; deny?: unknown };
  const parsedAllow =
    object.allow === undefined
      ? { selectors: undefined, invalidSelectors: [] }
      : parseNotificationSelectors(object.allow);
  const parsedDeny =
    object.deny === undefined
      ? { selectors: undefined, invalidSelectors: [] }
      : parseNotificationSelectors(object.deny);
  const invalidSelectors = [
    ...parsedAllow.invalidSelectors,
    ...parsedDeny.invalidSelectors,
  ];

  if (
    (object.allow !== undefined && !parsedAllow.selectors) ||
    (object.deny !== undefined && !parsedDeny.selectors)
  ) {
    return {
      policy: "all",
      invalidSelectors,
    };
  }

  return {
    policy: {
      ...(parsedAllow.selectors ? { allow: parsedAllow.selectors } : {}),
      ...(parsedDeny.selectors ? { deny: parsedDeny.selectors } : {}),
    },
    invalidSelectors,
  };
};

export const normalizeNotifications = (value: unknown): NotificationPolicy => {
  return parseNotifications(value).policy;
};

const expandNotificationSelector = (
  selector: NotificationSelector,
): NotificationKind[] => {
  if (ALL_NOTIFICATION_KINDS.includes(selector as NotificationKind)) {
    return [selector as NotificationKind];
  }

  if (selector === "agent:*") {
    return ["agentCompleted", "agentFailed"];
  }

  if (selector === "task:*") {
    return ["taskCompleted", "taskFailed"];
  }

  if (selector === "errors") {
    return ["agentFailed", "taskFailed"];
  }

  return [];
};


export const expandNotificationSelectors = (
  selectors: NotificationSelector[],
): Set<NotificationKind> => {
  const kinds = new Set<NotificationKind>();
  for (const selector of selectors) {
    for (const kind of expandNotificationSelector(selector)) {
      kinds.add(kind);
    }
  }

  return kinds;
};

export const expandNotificationPolicy = (
  policy: NotificationPolicy,
): Set<NotificationKind> => {
  if (policy === "all") {
    return new Set(ALL_NOTIFICATION_KINDS);
  }

  if (policy === "none") {
    return new Set();
  }

  const allowed = Array.isArray(policy)
    ? expandNotificationSelectors(policy)
    : policy.allow
      ? expandNotificationSelectors(policy.allow)
      : new Set(ALL_NOTIFICATION_KINDS);

  if (!Array.isArray(policy) && policy.deny) {
    const denied = expandNotificationSelectors(policy.deny);
    for (const kind of denied) {
      allowed.delete(kind);
    }
  }

  return allowed;
};

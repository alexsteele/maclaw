// Types for the server-hosted browser portal.

export type PortalProjectSummary = {
  name: string;
  defaultChatId: string;
  isDefault?: boolean;
};

export type PortalRenderOptions = {
  currentProject?: string;
  projects: PortalProjectSummary[];
};

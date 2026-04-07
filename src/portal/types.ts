// Types for the server-hosted browser portal.

export type PortalProjectSummary = {
  isDefault?: boolean;
  name: string;
};

export type PortalRenderOptions = {
  currentProject?: string;
  projects: PortalProjectSummary[];
};

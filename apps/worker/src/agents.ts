export const agentHandlers = {} as Record<string, (job: import("@commerce-os/database").Job, log: (m: string) => void) => Promise<void>>;

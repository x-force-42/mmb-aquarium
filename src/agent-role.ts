export type AgentRole = 'planner' | 'atomic' | 'unknown';

export function parseAgentRole(name: string | null | undefined): AgentRole {
  if (!name) return 'unknown';
  if (name.startsWith('[W]')) return 'planner';
  if (name.startsWith('[A]')) return 'atomic';
  return 'unknown';
}

import { describe, it, expect } from 'vitest';
import { parseAgentRole } from '../../src/agent-role';

describe('parseAgentRole', () => {
  it('returns "planner" for name starting with [W]', () => {
    expect(parseAgentRole('[W] worker-core-123')).toBe('planner');
  });

  it('returns "planner" for bare [W] prefix', () => {
    expect(parseAgentRole('[W]')).toBe('planner');
  });

  it('returns "atomic" for name starting with [A]', () => {
    expect(parseAgentRole('[A] atomic-task-456')).toBe('atomic');
  });

  it('returns "atomic" for bare [A] prefix', () => {
    expect(parseAgentRole('[A]')).toBe('atomic');
  });

  it('returns "atomic" for [A] followed by space', () => {
    expect(parseAgentRole('[A] ')).toBe('atomic');
  });

  it('returns "unknown" for an arbitrary name', () => {
    expect(parseAgentRole('some-worker')).toBe('unknown');
  });

  it('returns "unknown" for null', () => {
    expect(parseAgentRole(null)).toBe('unknown');
  });

  it('returns "unknown" for undefined', () => {
    expect(parseAgentRole(undefined)).toBe('unknown');
  });

  it('returns "unknown" for empty string', () => {
    expect(parseAgentRole('')).toBe('unknown');
  });

  it('does not match lowercase prefix as planner', () => {
    expect(parseAgentRole('[w] worker')).toBe('unknown');
  });

  it('does not match lowercase prefix as atomic', () => {
    expect(parseAgentRole('[a] atomic')).toBe('unknown');
  });
});

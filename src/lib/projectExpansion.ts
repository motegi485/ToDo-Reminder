import { storage } from './storage';
import { CONSTANTS } from './constants';

export function projectKey(name: string | null): string {
  return name ?? CONSTANTS.PROJECT_RESERVED_KEY;
}

export function isExpanded(name: string | null): boolean {
  const key = projectKey(name);
  const states = storage.getProjectStates();
  if (key in states) return states[key]!;
  return storage.getProjectDefaultExpanded();
}

export function toggleExpanded(name: string | null): boolean {
  const key = projectKey(name);
  const states = storage.getProjectStates();
  const current = key in states ? states[key]! : storage.getProjectDefaultExpanded();
  const next = !current;
  states[key] = next;
  storage.setProjectStates(states);
  return next;
}

export function applyDefaultExpansion(newDefault: boolean, activeProjectNames: Array<string | null>): void {
  const existing = storage.getProjectStates();
  const states: Record<string, boolean> = {};
  for (const k of Object.keys(existing)) states[k] = newDefault;
  for (const name of activeProjectNames) states[projectKey(name)] = newDefault;
  storage.setProjectStates(states);
  storage.setProjectDefaultExpanded(newDefault);
}

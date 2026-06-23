// Audit service — the single shared log. Every action (human or agent, live or sim) lands here
// with the identical AuditEvent shape (the "golden rule").
import type { AuditEvent } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { now } from '../lib/clock.js';
import { nextId } from '../lib/ids.js';

export function emit(event: Omit<AuditEvent, 'id' | 'created_at'>): AuditEvent {
  const full: AuditEvent = { ...event, id: nextId('auditEvents', 'ae_', 6), created_at: now() };
  return getRepos().repo<AuditEvent>('auditEvents').insert(full);
}

export interface AuditFilter {
  entity_id?: string;
  action_type?: string;
}

export function list(filter: AuditFilter = {}): AuditEvent[] {
  return getRepos()
    .repo<AuditEvent>('auditEvents')
    .getAll()
    .filter((e) => (!filter.entity_id || e.entity_id === filter.entity_id))
    .filter((e) => (!filter.action_type || e.action_type === filter.action_type))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // newest first
}

// The watch report for the switch-over (build plan M7: "failed sign-ins are watched for a week"). Counts only: no
// email, address, name or account id appears in it, so it can be pasted into a status update.
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { auditEvents, accounts, legacyLinks, productSignIns } from './db/cell-schema.ts';
import type { Cells } from './accounts.ts';

export interface DayRow { day: string; signIns: number; failed: number; created: number; confirmed: number; resets: number }
export interface Report {
  days: DayRow[];
  /** Imported from Health: how many, how many confirmed their email, how many have signed in to Health since. */
  imported: { total: number; confirmed: number; signedInToHealth: number };
  /** Failed sign-ins as a share of all attempts over the period, 0 when there were none. */
  failureRate: number;
}

export async function buildReport(dbs: Cells, daysBack: number, now = new Date()): Promise<Report> {
  const since = new Date(now.getTime() - daysBack * 86_400_000);
  const byDay = new Map<string, DayRow>();
  for (let i = daysBack - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    byDay.set(day, { day, signIns: 0, failed: 0, created: 0, confirmed: 0, resets: 0 });
  }
  const imported = { total: 0, confirmed: 0, signedInToHealth: 0 };

  for (const { db } of dbs.cells.values()) {
    const day = sql<string>`to_char(${auditEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const rows = await db.select({ day, kind: auditEvents.kind, n: sql<number>`count(*)::int` })
      .from(auditEvents).where(gte(auditEvents.createdAt, since)).groupBy(day, auditEvents.kind);
    for (const r of rows) {
      const row = byDay.get(r.day);
      if (!row) continue;
      if (r.kind === 'sign_in') row.signIns += r.n;
      else if (r.kind === 'sign_in_failed') row.failed += r.n;
      else if (r.kind === 'account_created') row.created += r.n;
      else if (r.kind === 'email_verified') row.confirmed += r.n;
      else if (r.kind === 'password_reset') row.resets += r.n;
    }
    const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(legacyLinks).where(eq(legacyLinks.product, 'health'));
    const [confirmed] = await db.select({ n: sql<number>`count(*)::int` }).from(legacyLinks)
      .innerJoin(accounts, eq(accounts.id, legacyLinks.accountId))
      .where(and(eq(legacyLinks.product, 'health'), isNotNull(accounts.emailVerifiedAt)));
    const [signedIn] = await db.select({ n: sql<number>`count(*)::int` }).from(legacyLinks)
      .innerJoin(productSignIns, and(eq(productSignIns.accountId, legacyLinks.accountId), eq(productSignIns.product, 'health')))
      .where(eq(legacyLinks.product, 'health'));
    imported.total += total.n;
    imported.confirmed += confirmed.n;
    imported.signedInToHealth += signedIn.n;
  }
  const days = [...byDay.values()];
  const attempts = days.reduce((a, d) => a + d.signIns + d.failed, 0);
  const failed = days.reduce((a, d) => a + d.failed, 0);
  return { days, imported, failureRate: attempts ? failed / attempts : 0 };
}

export function formatReport(r: Report): string {
  const lines = ['day         sign-ins  failed  new  confirmed  resets'];
  for (const d of r.days) {
    lines.push(`${d.day}  ${String(d.signIns).padStart(8)}  ${String(d.failed).padStart(6)}  ${String(d.created).padStart(3)}  ${String(d.confirmed).padStart(9)}  ${String(d.resets).padStart(6)}`);
  }
  lines.push('', `Failed sign-ins: ${(r.failureRate * 100).toFixed(1)}% of attempts.`);
  lines.push(`Imported from Health: ${r.imported.total}; confirmed their email: ${r.imported.confirmed}; signed in to Health since: ${r.imported.signedInToHealth}.`);
  return lines.join('\n');
}

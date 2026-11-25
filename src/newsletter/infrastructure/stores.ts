import type { Issue, Stop, Subscriber, SubscriberStatus } from "../domain/newsletter.ts";
import type { IssueStore, SendStatus, SendStore, SubscriberStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const SUBSCRIBER = "id, email, email_hash, name, stop, status, source, confirmed_at, unsubscribed_at, created_at";
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function toSubscriber(row: Record<string, unknown>): Subscriber {
  return {
    id: row["id"] as Id,
    email: text(row["email"]),
    emailHash: String(row["email_hash"]),
    name: text(row["name"]),
    stop: row["stop"] as Stop,
    status: row["status"] as SubscriberStatus,
    source: row["source"] as Subscriber["source"],
    confirmedAt: text(row["confirmed_at"]),
    unsubscribedAt: text(row["unsubscribed_at"]),
    createdAt: String(row["created_at"]),
  };
}

export function sqliteSubscriberStore(db: Database): SubscriberStore {
  const insert = db.prepare(`insert into newsletter_subscriber (${SUBSCRIBER}, confirm_hash, confirm_expires_at, unsubscribe_token, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const get = db.prepare(`select ${SUBSCRIBER} from newsletter_subscriber where id = ?`);
  const byHash = db.prepare(`select ${SUBSCRIBER} from newsletter_subscriber where email_hash = ?`);
  const byConfirm = db.prepare(`select ${SUBSCRIBER}, confirm_expires_at from newsletter_subscriber where confirm_hash = ?`);
  const byUnsubscribe = db.prepare(`select ${SUBSCRIBER} from newsletter_subscriber where unsubscribe_token = ?`);
  const tokenOf = db.prepare("select unsubscribe_token from newsletter_subscriber where id = ?");
  const save = db.prepare("update newsletter_subscriber set email = ?, name = ?, stop = ?, status = ?, confirmed_at = ?, unsubscribed_at = ?, updated_at = ? where id = ?");
  const setConfirm = db.prepare("update newsletter_subscriber set confirm_hash = ?, confirm_expires_at = ?, updated_at = ? where id = ?");
  const remove = db.prepare("delete from newsletter_subscriber where id = ?");
  const current = db.prepare(`select ${SUBSCRIBER} from newsletter_subscriber where status <> 'unsubscribed' order by created_at desc`);
  const counts = db.prepare("select status, count(*) as n from newsletter_subscriber group by status");
  const subscribed = db.prepare(`select ${SUBSCRIBER} from newsletter_subscriber where status = 'subscribed' order by created_at`);
  return {
    insert(subscriber, tokens) {
      insert.run(subscriber.id, subscriber.email, subscriber.emailHash, subscriber.name, subscriber.stop, subscriber.status, subscriber.source, subscriber.confirmedAt, subscriber.unsubscribedAt, subscriber.createdAt, tokens.confirmHash, tokens.confirmExpiresAt, tokens.unsubscribeToken, subscriber.createdAt);
    },
    get(id) {
      const row = get.get(id);
      return row ? toSubscriber(row) : null;
    },
    byEmailHash(hash) {
      const row = byHash.get(hash);
      return row ? toSubscriber(row) : null;
    },
    byConfirmHash(hash) {
      const row = byConfirm.get(hash);
      return row && row["confirm_expires_at"] ? { subscriber: toSubscriber(row), expiresAt: String(row["confirm_expires_at"]) } : null;
    },
    byUnsubscribeToken(token) {
      const row = byUnsubscribe.get(token);
      return row ? toSubscriber(row) : null;
    },
    unsubscribeTokenOf(id) {
      const row = tokenOf.get(id);
      return row ? String(row["unsubscribe_token"]) : null;
    },
    save(subscriber, at) {
      save.run(subscriber.email, subscriber.name, subscriber.stop, subscriber.status, subscriber.confirmedAt, subscriber.unsubscribedAt, at, subscriber.id);
    },
    setConfirm(id, confirm, at) {
      setConfirm.run(confirm?.hash ?? null, confirm?.expiresAt ?? null, at, id);
    },
    remove(id) {
      remove.run(id);
    },
    listCurrent: () => current.all().map(toSubscriber),
    countsByStatus() {
      const found: Record<SubscriberStatus, number> = { pending: 0, subscribed: 0, unsubscribed: 0 };
      for (const row of counts.all()) found[row["status"] as SubscriberStatus] = Number(row["n"]);
      return found;
    },
    subscribedIn(stops) {
      const all = subscribed.all().map(toSubscriber);
      return stops.length === 0 ? all : all.filter((one) => stops.includes(one.stop));
    },
  };
}

const ISSUE = "id, subject, body, stops, status, created_by, started_at, finished_at";

function toIssue(row: Record<string, unknown>): Issue {
  return {
    id: row["id"] as Id,
    subject: String(row["subject"]),
    body: String(row["body"]),
    stops: JSON.parse(String(row["stops"])) as Stop[],
    status: row["status"] as Issue["status"],
    createdBy: row["created_by"] as Id,
    startedAt: text(row["started_at"]),
    finishedAt: text(row["finished_at"]),
  };
}

export function sqliteIssueStore(db: Database): IssueStore {
  const insert = db.prepare(`insert into newsletter_issue (${ISSUE}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update newsletter_issue set subject = ?, body = ?, stops = ?, status = ?, started_at = ?, finished_at = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${ISSUE} from newsletter_issue where id = ?`);
  const remove = db.prepare("delete from newsletter_issue where id = ?");
  const list = db.prepare(`select ${ISSUE} from newsletter_issue order by created_at desc`);
  const sending = db.prepare(`select ${ISSUE} from newsletter_issue where status = 'sending' order by started_at`);
  return {
    insert(issue, at) {
      insert.run(issue.id, issue.subject, issue.body, JSON.stringify(issue.stops), issue.status, issue.createdBy, issue.startedAt, issue.finishedAt, at, at);
    },
    save(issue, at) {
      save.run(issue.subject, issue.body, JSON.stringify(issue.stops), issue.status, issue.startedAt, issue.finishedAt, at, issue.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toIssue(row) : null;
    },
    remove(id) {
      remove.run(id);
    },
    list: () => list.all().map(toIssue),
    sending: () => sending.all().map(toIssue),
  };
}

export function sqliteSendStore(db: Database): SendStore {
  const add = db.prepare("insert into newsletter_send (issue_id, subscriber_id, status, queued_at) values (?, ?, 'pending', ?) on conflict do nothing");
  const pending = db.prepare("select subscriber_id from newsletter_send where issue_id = ? and status = 'pending' order by queued_at, subscriber_id limit ?");
  const mark = db.prepare("update newsletter_send set status = ?, done_at = ? where issue_id = ? and subscriber_id = ?");
  const counts = db.prepare("select status, count(*) as n from newsletter_send where issue_id = ? group by status");
  return {
    addAll(issueId, subscriberIds, at) {
      for (const one of subscriberIds) add.run(issueId, one, at);
    },
    pending: (issueId, limit) => pending.all(issueId, limit).map((row) => row["subscriber_id"] as Id),
    mark(issueId, subscriberId, status, at) {
      mark.run(status, at, issueId, subscriberId);
    },
    counts(issueId) {
      const found: Record<SendStatus, number> = { pending: 0, sent: 0, failed: 0, skipped: 0 };
      for (const row of counts.all(issueId)) found[row["status"] as SendStatus] = Number(row["n"]);
      return found;
    },
  };
}

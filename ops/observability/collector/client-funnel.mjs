import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const visitPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const clicksPattern = /^(0|[1-9][0-9]{0,8})(?![\s\S])/;
const activityPattern = /^[0-9a-f]{16}(?![\s\S])/;
const categoryPattern = /^[a-z][a-z_]{0,31}(?![\s\S])/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 2;

const PLAYERS_TABLE = `
  environment TEXT NOT NULL COLLATE BINARY,
  activity_id TEXT NOT NULL COLLATE BINARY CHECK (length(activity_id) = 16),
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  match_requested_at INTEGER,
  game_started_at INTEGER,
  recorded_clicks INTEGER NOT NULL DEFAULT 0 CHECK (recorded_clicks >= 0),
  acquisition TEXT,
  match_source TEXT,
  PRIMARY KEY (environment, activity_id),
  CHECK (game_started_at IS NULL OR match_requested_at IS NOT NULL)
`;
const COHORTS_TABLE = `
  environment TEXT NOT NULL,
  cohort_day TEXT NOT NULL,
  acquisition TEXT NOT NULL,
  match_source TEXT NOT NULL,
  players INTEGER NOT NULL,
  requested INTEGER NOT NULL,
  started INTEGER NOT NULL,
  clicks_0_4 INTEGER NOT NULL,
  clicks_5_9 INTEGER NOT NULL,
  clicks_10_19 INTEGER NOT NULL,
  clicks_20_49 INTEGER NOT NULL,
  clicks_50_plus INTEGER NOT NULL,
  PRIMARY KEY (environment, cohort_day, acquisition, match_source)
`;
const PLAYER_COLUMNS = [
  "environment",
  "activity_id",
  "first_observed_at",
  "last_observed_at",
  "match_requested_at",
  "game_started_at",
  "recorded_clicks",
  "acquisition",
  "match_source",
];
const COHORT_COLUMNS = [
  "environment",
  "cohort_day",
  "acquisition",
  "match_source",
  "players",
  "requested",
  "started",
  "clicks_0_4",
  "clicks_5_9",
  "clicks_10_19",
  "clicks_20_49",
  "clicks_50_plus",
];

function category(value) {
  return typeof value === "string" && categoryPattern.test(value) ? value : null;
}

// Grafana must only read the snapshot: a reader on this file would block the synchronous writer.
export class ClientFunnel {
  constructor(stateDirectory, { retentionDays = 90 } = {}) {
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1)
      throw new Error("Invalid funnel retention");
    this.retentionMs = retentionDays * DAY_MS;
    this.filename = path.join(stateDirectory, "client-funnel.db");
    this.snapshotDirectory = path.join(stateDirectory, "grafana");
    this.dirty = true;
    const db = new DatabaseSync(this.filename);
    try {
      chmodSync(this.filename, 0o600);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 0;
      `);
      if (db.prepare("PRAGMA user_version").get().user_version < SCHEMA_VERSION)
        db.exec(`
          DROP TABLE IF EXISTS client_funnel_visits;
          DROP TABLE IF EXISTS client_funnel_players;
        `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS client_funnel_players (${PLAYERS_TABLE}) STRICT, WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS client_funnel_players_last_observed
          ON client_funnel_players (last_observed_at);
        CREATE INDEX IF NOT EXISTS client_funnel_players_cohort
          ON client_funnel_players (first_observed_at);
        CREATE TABLE IF NOT EXISTS client_funnel_visits (
          environment TEXT NOT NULL COLLATE BINARY,
          activity_id TEXT NOT NULL COLLATE BINARY,
          visit_id TEXT NOT NULL COLLATE BINARY,
          clicks INTEGER NOT NULL CHECK (clicks BETWEEN 0 AND 999999999),
          PRIMARY KEY (environment, activity_id, visit_id),
          FOREIGN KEY (environment, activity_id)
            REFERENCES client_funnel_players (environment, activity_id) ON DELETE CASCADE
        ) STRICT, WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS client_funnel_cohorts (${COHORTS_TABLE}) STRICT, WITHOUT ROWID;
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
      for (const file of [`${this.filename}-wal`, `${this.filename}-shm`]) {
        try {
          chmodSync(file, 0o600);
        } catch {
          continue;
        }
      }
      this.db = db;
      this.player = db.prepare(`
        SELECT game_started_at FROM client_funnel_players
        WHERE environment = ? AND activity_id = ?
      `);
      this.insertPlayer = db.prepare(`
        INSERT INTO client_funnel_players
          (environment, activity_id, first_observed_at, last_observed_at, acquisition)
        VALUES (?, ?, ?, ?, ?)
      `);
      this.visit = db.prepare(`
        SELECT clicks FROM client_funnel_visits
        WHERE environment = ? AND activity_id = ? AND visit_id = ?
      `);
      this.updateVisit = db.prepare(`
        INSERT INTO client_funnel_visits (environment, activity_id, visit_id, clicks)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (environment, activity_id, visit_id) DO UPDATE SET
          clicks = max(clicks, excluded.clicks)
      `);
      this.updatePlayer = db.prepare(`
        UPDATE client_funnel_players SET
          recorded_clicks = recorded_clicks + :added,
          last_observed_at = max(last_observed_at, :now),
          acquisition = coalesce(acquisition, :acquisition),
          match_source = CASE WHEN :stage = 'match_requested' AND :source IS NOT NULL
            THEN :source ELSE match_source END,
          match_requested_at = CASE WHEN :stage IN ('match_requested', 'game_started')
            THEN coalesce(match_requested_at, :now) ELSE match_requested_at END,
          game_started_at = CASE WHEN :stage = 'game_started' THEN :now ELSE NULL END
        WHERE environment = :environment AND activity_id = :id AND game_started_at IS NULL
      `);
      this.deleteVisits = db.prepare(`
        DELETE FROM client_funnel_visits WHERE environment = ? AND activity_id = ?
      `);
      this.expire = db.prepare(`DELETE FROM client_funnel_players WHERE last_observed_at < ?`);
      this.erase = db.prepare(`DELETE FROM client_funnel_players WHERE activity_id = ?`);
      this.clearCohorts = db.prepare(`DELETE FROM client_funnel_cohorts WHERE cohort_day >= ?`);
      this.buildCohorts = db.prepare(`
        INSERT INTO client_funnel_cohorts
        SELECT
          environment,
          strftime('%Y-%m-%d', first_observed_at / 1000, 'unixepoch'),
          coalesce(acquisition, 'unknown'),
          coalesce(match_source, 'none'),
          count(*),
          count(match_requested_at),
          count(game_started_at),
          sum(game_started_at IS NOT NULL AND recorded_clicks < 5),
          sum(game_started_at IS NOT NULL AND recorded_clicks BETWEEN 5 AND 9),
          sum(game_started_at IS NOT NULL AND recorded_clicks BETWEEN 10 AND 19),
          sum(game_started_at IS NOT NULL AND recorded_clicks BETWEEN 20 AND 49),
          sum(game_started_at IS NOT NULL AND recorded_clicks >= 50)
        FROM client_funnel_players
        WHERE first_observed_at >= ?
        GROUP BY 1, 2, 3, 4
      `);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  record(records) {
    const checkpoints = records.filter(
      (record) =>
        record.event_name === "first_game_funnel" &&
        typeof record.context_user_id === "string" &&
        activityPattern.test(record.context_user_id) &&
        ["production", "staging", "development"].includes(record.app_environment) &&
        ["observed", "match_requested", "game_started"].includes(record.event_stage) &&
        typeof record.event_visit_id === "string" &&
        visitPattern.test(record.event_visit_id) &&
        typeof record.event_clicks === "string" &&
        clicksPattern.test(record.event_clicks),
    );
    if (!checkpoints.length) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of checkpoints) {
        const environment = record.app_environment;
        const id = record.context_user_id;
        const player = this.player.get(environment, id);
        if (player?.game_started_at != null) continue;
        const now = Date.now();
        const acquisition = category(record.event_acquisition);
        if (!player) this.insertPlayer.run(environment, id, now, now, acquisition);
        const previous = this.visit.get(environment, id, record.event_visit_id)?.clicks ?? 0;
        const clicks = Number(record.event_clicks);
        this.updateVisit.run(environment, id, record.event_visit_id, clicks);
        this.updatePlayer.run({
          added: Math.max(0, clicks - previous),
          now,
          acquisition,
          stage: record.event_stage,
          source: category(record.event_source),
          environment,
          id,
        });
        if (record.event_stage === "game_started") this.deleteVisits.run(environment, id);
      }
      this.db.exec("COMMIT");
      this.dirty = true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // Only whole cohort days younger than the retention window are rebuilt: every player in
  // them is still present, because last_observed_at >= first_observed_at. Older days stay frozen.
  rollup(now = Date.now()) {
    const firstWholeDay = Math.ceil((now - this.retentionMs) / DAY_MS) * DAY_MS;
    const day = new Date(firstWholeDay).toISOString().slice(0, 10);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.clearCohorts.run(day);
      this.buildCohorts.run(firstWholeDay);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.dirty = true;
  }

  sweep(now = Date.now()) {
    const { changes } = this.expire.run(now - this.retentionMs);
    if (changes) this.dirty = true;
    return Number(changes);
  }

  eraseActivityId(activityId) {
    if (!activityPattern.test(activityId)) throw new Error("Invalid activity ID");
    const { changes } = this.erase.run(activityId);
    if (changes) this.dirty = true;
    return Number(changes);
  }

  snapshot() {
    if (!this.dirty) return false;
    if (!this.snapshotDb) {
      mkdirSync(this.snapshotDirectory, { recursive: true, mode: 0o755 });
      const filename = path.join(this.snapshotDirectory, "client-funnel.db");
      const db = new DatabaseSync(filename);
      chmodSync(filename, 0o644);
      db.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 0;
        DROP TABLE IF EXISTS client_funnel_players;
        CREATE TABLE client_funnel_players (${PLAYERS_TABLE}) STRICT, WITHOUT ROWID;
        CREATE INDEX client_funnel_players_cohort
          ON client_funnel_players (environment, first_observed_at);
        CREATE TABLE IF NOT EXISTS client_funnel_cohorts (${COHORTS_TABLE}) STRICT, WITHOUT ROWID;
      `);
      this.snapshotDb = db;
      this.snapshotTables = [
        ["client_funnel_players", PLAYER_COLUMNS],
        ["client_funnel_cohorts", COHORT_COLUMNS],
      ].map(([table, columns]) => ({
        table,
        read: this.db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`),
        write: db.prepare(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ),
        columns,
      }));
    }
    try {
      this.snapshotDb.exec("BEGIN IMMEDIATE");
    } catch {
      return false;
    }
    try {
      for (const { table, read, write, columns } of this.snapshotTables) {
        this.snapshotDb.exec(`DELETE FROM ${table}`);
        for (const row of read.iterate()) write.run(...columns.map((column) => row[column]));
      }
      this.snapshotDb.exec("COMMIT");
    } catch {
      this.snapshotDb.exec("ROLLBACK");
      return false;
    }
    this.dirty = false;
    return true;
  }

  close() {
    this.snapshotDb?.close();
    this.db.close();
  }
}

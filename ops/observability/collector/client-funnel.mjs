import { chmodSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const visitPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const clicksPattern = /^(0|[1-9][0-9]{0,8})(?![\s\S])/;

export class ClientFunnel {
  constructor(stateDirectory) {
    const filename = path.join(stateDirectory, "client-funnel.db");
    const db = new DatabaseSync(filename);
    try {
      chmodSync(filename, 0o644);
      db.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 1000;
        CREATE TABLE IF NOT EXISTS client_funnel_players (
          environment TEXT NOT NULL COLLATE BINARY,
          relay_username TEXT NOT NULL COLLATE BINARY,
          first_observed_at INTEGER NOT NULL,
          last_observed_at INTEGER NOT NULL,
          match_requested_at INTEGER,
          game_started_at INTEGER,
          recorded_clicks INTEGER NOT NULL DEFAULT 0 CHECK (recorded_clicks >= 0),
          PRIMARY KEY (environment, relay_username),
          CHECK (game_started_at IS NULL OR match_requested_at IS NOT NULL)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS client_funnel_players_cohort
          ON client_funnel_players (environment, first_observed_at);
        CREATE TABLE IF NOT EXISTS client_funnel_visits (
          environment TEXT NOT NULL COLLATE BINARY,
          relay_username TEXT NOT NULL COLLATE BINARY,
          visit_id TEXT NOT NULL COLLATE BINARY,
          clicks INTEGER NOT NULL CHECK (clicks BETWEEN 0 AND 999999999),
          first_observed_at INTEGER NOT NULL,
          last_observed_at INTEGER NOT NULL,
          PRIMARY KEY (environment, relay_username, visit_id),
          FOREIGN KEY (environment, relay_username)
            REFERENCES client_funnel_players (environment, relay_username) ON DELETE CASCADE
        ) STRICT;
      `);
      this.db = db;
      this.player = db.prepare(`
        SELECT game_started_at FROM client_funnel_players
        WHERE environment = ? AND relay_username = ?
      `);
      this.insertPlayer = db.prepare(`
        INSERT INTO client_funnel_players
          (environment, relay_username, first_observed_at, last_observed_at)
        VALUES (?, ?, ?, ?)
      `);
      this.visit = db.prepare(`
        SELECT clicks FROM client_funnel_visits
        WHERE environment = ? AND relay_username = ? AND visit_id = ?
      `);
      this.updateVisit = db.prepare(`
        INSERT INTO client_funnel_visits
          (environment, relay_username, visit_id, clicks, first_observed_at, last_observed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (environment, relay_username, visit_id) DO UPDATE SET
          clicks = max(clicks, excluded.clicks),
          last_observed_at = max(last_observed_at, excluded.last_observed_at)
      `);
      this.updatePlayer = db.prepare(`
        UPDATE client_funnel_players SET
          recorded_clicks = recorded_clicks + ?,
          last_observed_at = max(last_observed_at, ?),
          match_requested_at = CASE WHEN ? IN ('match_requested', 'game_started')
            THEN coalesce(match_requested_at, ?) ELSE match_requested_at END,
          game_started_at = CASE WHEN ? = 'game_started' THEN ? ELSE NULL END
        WHERE environment = ? AND relay_username = ? AND game_started_at IS NULL
      `);
      this.deleteVisits = db.prepare(`
        DELETE FROM client_funnel_visits WHERE environment = ? AND relay_username = ?
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
        record.context_user_id.length > 0 &&
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
        const handle = record.context_user_id;
        const player = this.player.get(environment, handle);
        if (player?.game_started_at != null) continue;
        const now = Date.now();
        if (!player) this.insertPlayer.run(environment, handle, now, now);
        const previous = this.visit.get(environment, handle, record.event_visit_id)?.clicks ?? 0;
        const clicks = Number(record.event_clicks);
        this.updateVisit.run(environment, handle, record.event_visit_id, clicks, now, now);
        this.updatePlayer.run(
          Math.max(0, clicks - previous),
          now,
          record.event_stage,
          now,
          record.event_stage,
          now,
          environment,
          handle,
        );
        if (record.event_stage === "game_started") this.deleteVisits.run(environment, handle);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

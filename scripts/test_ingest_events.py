import contextlib
import importlib.util
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = Path(__file__).with_name("ingest-events.py")
MIGRATIONS = ROOT / "manabrew-rs" / "crates" / "manabrew-hub" / "migrations"


def load_ingester():
    spec = importlib.util.spec_from_file_location("ingest_events", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def migration_version(path: Path) -> int:
    return int(path.name.split("_", 1)[0])


def create_migrated_hub(path: Path):
    db = sqlite3.connect(path)
    migrations = sorted(MIGRATIONS.glob("*.sql"), key=migration_version)
    for migration in migrations:
        version = migration_version(migration)
        if version in (4, 13, 15):
            db.execute("PRAGMA foreign_keys=OFF")
        db.executescript(migration.read_text())
        db.execute("UPDATE schema_version SET version = ? WHERE id = 1", (version,))
        db.commit()
        if version in (4, 13, 15):
            db.execute("PRAGMA foreign_keys=ON")
    db.close()


class HubAnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.hub_path = self.root / "hub.db"
        self.events_path = self.root / "events.db"
        create_migrated_hub(self.hub_path)
        self.ingester = load_ingester()
        self.events = self.ingester.open_db(self.events_path)
        self.addCleanup(self.events.close)

    def test_refreshes_from_freshly_migrated_hub(self):
        self.assertTrue(
            self.ingester.refresh_hub_analytics(self.events, self.hub_path)
        )
        sync = self.events.execute(
            "SELECT schema_version FROM hub_sync_state WHERE id = 1"
        ).fetchone()
        latest_version = max(map(migration_version, MIGRATIONS.glob("*.sql")))
        self.assertEqual(sync, (latest_version,))
        metrics = {
            row[0]
            for row in self.events.execute(
                "SELECT DISTINCT metric FROM hub_metric_snapshots"
            )
        }
        self.assertIn("accounts", metrics)
        self.assertIn("table_rows", metrics)

    def test_one_missing_table_does_not_block_other_metrics(self):
        hub = sqlite3.connect(self.hub_path)
        hub.execute("DROP TABLE oauth_states")
        hub.commit()
        hub.close()

        with contextlib.redirect_stderr(io.StringIO()):
            self.assertTrue(
                self.ingester.refresh_hub_analytics(self.events, self.hub_path)
            )

        accounts = self.events.execute(
            """SELECT value FROM hub_metric_snapshots
               WHERE metric = 'accounts' AND dimension = ''"""
        ).fetchone()
        missing = self.events.execute(
            """SELECT value FROM hub_metric_snapshots
               WHERE metric = 'table_rows' AND dimension = 'oauth_states'"""
        ).fetchone()
        self.assertEqual(accounts, (0.0,))
        self.assertIsNone(missing)

    def test_engine_reports_arrive_from_both_routes_once(self):
        hub = sqlite3.connect(self.hub_path)
        hub.execute(
            """INSERT INTO engine_play_stats
               (id, reported_at, engine, client_version, platform, format, seats,
                multiplayer, duration_s, end_reason, decisions, turnaround_p50,
                turnaround_p90, turnaround_max, engine_p50, engine_p90,
                engine_max, by_type)
               VALUES ('offline-1', '2026-08-30T04:27:49Z', 'forge-wasm', '3.23.0',
                       'web', 'standard', 2, 0, 252, 'gameOver', 91, 74, 279, 727,
                       40, 90, 300, '[]')"""
        )
        hub.commit()
        hub.close()

        relayed = json.dumps(
            {
                "event": "engine_stats",
                "ts": "2026-08-30T10:33:15.887Z",
                "room_id": "room-1",
                "username": "player",
                "report_id": "relayed-1",
                "game_id": "game-1",
                "engine": "forge-hosted",
                "client_version": "3.23.0",
                "platform": "web",
                "format": "commander",
                "seats": 2,
                "multiplayer": True,
                "duration_s": 400,
                "end_reason": "gameOver",
                "decisions": 180,
                "turnaround_p50": 46,
                "turnaround_p90": 78,
                "turnaround_max": 320,
            }
        )
        for _ in range(2):
            self.ingester.ingest_line(self.events, relayed)
            self.assertTrue(
                self.ingester.refresh_hub_analytics(self.events, self.hub_path)
            )

        rows = self.events.execute(
            "SELECT report_id, source, engine, turnaround_p50 FROM engine_stats ORDER BY report_id"
        ).fetchall()
        self.assertEqual(
            rows,
            [
                ("offline-1", "hub", "forge-wasm", 74),
                ("relayed-1", "relay", "forge-hosted", 46),
            ],
        )


if __name__ == "__main__":
    unittest.main()

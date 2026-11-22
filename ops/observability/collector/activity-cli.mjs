import { activityId, loadActivityKey } from "./activity-key.mjs";
import { ClientFunnel } from "./client-funnel.mjs";
import {
  analyticsReport,
  formatReport,
  loadLokiEvents,
  readRelayStats,
} from "./activity-report.mjs";

const ENVIRONMENTS = ["production", "staging", "development"];
const [command, environment, ...rest] = process.argv.slice(2);
const usage = () => {
  console.error(
    [
      "usage:",
      "  node activity.mjs id <environment> <relay handle>",
      "  node activity.mjs erase <environment> <relay handle>",
      "  node activity.mjs report <environment> [--days N] [--json] [--relay-stats]",
      "",
      "--relay-stats reads TSV lines from stdin: handle, games, first_game_ms, last_game_ms.",
      "Handles are hashed in memory; only aggregates are printed.",
    ].join("\n"),
  );
  process.exit(2);
};
if (!["id", "erase", "report"].includes(command) || !ENVIRONMENTS.includes(environment)) usage();
const stateDirectory = process.env.FARO_STATE_DIR ?? "/var/lib/faro/state";
const key = loadActivityKey(stateDirectory);

if (command === "id" || command === "erase") {
  const handle = rest[0];
  if (!handle) usage();
  const id = activityId(key, environment, handle);
  if (command === "id") {
    console.log(id);
  } else {
    const funnel = new ClientFunnel(stateDirectory);
    const removed = funnel.eraseActivityId(id);
    funnel.snapshot();
    funnel.close();
    console.log(`${id}: removed ${removed} funnel summary row(s)`);
  }
} else {
  const daysFlag = rest.indexOf("--days");
  const days = daysFlag >= 0 ? Number(rest[daysFlag + 1]) : 14;
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) usage();
  const until = Date.now();
  const since = until - days * 24 * 60 * 60 * 1000;
  const funnel = new ClientFunnel(stateDirectory);
  const players = funnel.db
    .prepare(
      `SELECT activity_id, first_observed_at, match_requested_at, game_started_at,
              recorded_clicks, acquisition, match_source
       FROM client_funnel_players WHERE environment = ? AND first_observed_at >= ?`,
    )
    .all(environment, since);
  funnel.close();
  const events = await loadLokiEvents(
    process.env.LOKI_URL ?? "http://loki:3100",
    environment,
    since,
    until,
  );
  const relay = rest.includes("--relay-stats")
    ? await readRelayStats(process.stdin, (handle) => activityId(key, environment, handle))
    : undefined;
  const report = analyticsReport({ environment, days, players, events, relay });
  console.log(rest.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
}

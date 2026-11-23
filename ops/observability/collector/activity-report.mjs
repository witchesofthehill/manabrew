import { createInterface } from "node:readline";

const MIN_GROUP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const GROUPS = ["browsed", "requested", "played"];
const PAGE = 5000;

export async function loadLokiEvents(loki, environment, since, until) {
  const query = `{app="manabrew-client",environment="${environment}",source="analytics"} | json | kind="event"`;
  const events = [];
  let start = BigInt(since) * 1_000_000n;
  const end = BigInt(until) * 1_000_000n;
  for (;;) {
    const url = new URL("/loki/api/v1/query_range", loki);
    url.search = new URLSearchParams({
      query,
      start: start.toString(),
      end: end.toString(),
      limit: String(PAGE),
      direction: "forward",
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Loki query failed: ${response.status}`);
    const values = (await response.json()).data.result.flatMap((stream) => stream.values);
    if (!values.length) break;
    let last = start;
    for (const [timestamp, line] of values) {
      const ns = BigInt(timestamp);
      if (ns > last) last = ns;
      try {
        const record = JSON.parse(line);
        if (typeof record.context_user_id === "string")
          events.push({ ...record, at: Number(ns / 1_000_000n) });
      } catch {
        continue;
      }
    }
    if (values.length < PAGE) break;
    start = last + 1n;
  }
  return events.sort((a, b) => a.at - b.at);
}

export async function readRelayStats(input, hash) {
  const stats = new Map();
  for await (const line of createInterface({ input })) {
    const [handle, games, firstGame, lastGame] = line.split("\t");
    if (!handle || !Number.isSafeInteger(Number(games))) continue;
    stats.set(hash(handle), {
      games: Number(games),
      firstGame: Number(firstGame),
      lastGame: Number(lastGame),
    });
  }
  return stats;
}

function median(values) {
  if (values.length < MIN_GROUP) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function share(part, whole) {
  return whole >= MIN_GROUP ? Math.round((1000 * part) / whole) / 10 : null;
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= MIN_GROUP).sort((a, b) => b[1] - a[1]);
}

function screenOf(event) {
  try {
    const path = new URL(event.event_url).pathname.slice(1);
    return path.startsWith(`${event.event_screen}/`) && !path.includes(":id")
      ? path
      : event.event_screen;
  } catch {
    return event.event_screen;
  }
}

const VISIT_DURATIONS = ["under-10s", "10-60s", "1-10m", "10-60m", "1h-plus"];
const VISIT_KINDS = [
  "automated",
  "no_exit_signal",
  "bounced",
  "open_in_background",
  "open_untouched",
  "interacted",
];
const INPUTS = ["none", "passive", "active"];

function visitKind(signals) {
  if (!signals.length) return "no_exit_signal";
  if (signals.some((event) => event.event_automation && event.event_automation !== "none"))
    return "automated";
  const rank = (values, key) => Math.max(...signals.map((event) => values.indexOf(event[key])));
  const age = rank(VISIT_DURATIONS, "event_age");
  const visible = rank(VISIT_DURATIONS, "event_visible");
  const input = rank(INPUTS, "event_input");
  if (input > 0) return "interacted";
  if (age < 2) return "bounced";
  if (age >= 3 && visible < 2) return "open_in_background";
  return "open_untouched";
}

function visitKinds(events) {
  const visits = new Map();
  for (const event of events) {
    if (!event.event_visit_id) continue;
    if (!visits.has(event.event_visit_id)) visits.set(event.event_visit_id, []);
    if (event.event_name === "visit_signal") visits.get(event.event_visit_id).push(event);
  }
  return [...visits.values()].map(visitKind);
}

function profile(player, events) {
  const cutoff = player.game_started_at ?? Infinity;
  const before = events.filter((event) => event.at < cutoff);
  const screens = before.filter((event) => event.event_name === "screen_view");
  const firstVisit = before.find((event) => event.event_visit_id)?.event_visit_id;
  const opening = [];
  for (const event of screens) {
    if (firstVisit && event.event_visit_id !== firstVisit) continue;
    if (opening.at(-1) !== screenOf(event)) opening.push(screenOf(event));
    if (opening.length === 3) break;
  }
  const actions = new Set();
  const stepClicks = new Map();
  for (const event of before) {
    if (event.event_name === "ui_action" && !stepClicks.has(event.event_action))
      stepClicks.set(event.event_action, Number(event.event_clicks));
    if (event.event_name === "feature_used") actions.add(event.event_feature);
    if (event.event_name === "deck_import") actions.add(`import_${event.event_outcome}`);
    if (event.event_name === "lobby_wait") actions.add(`lobby_${event.event_outcome}`);
  }
  return {
    screens: new Set(screens.map(screenOf)),
    opening: opening.join(" > "),
    lastScreen: screens.at(-1) && screenOf(screens.at(-1)),
    actions,
    stepClicks,
    visits: new Set(before.map((event) => event.event_visit_id).filter(Boolean)).size,
    visitKinds: visitKinds(before),
  };
}

export function analyticsReport({ environment, days, players, events, relay }) {
  const byId = new Map(players.map((player) => [player.activity_id, []]));
  for (const event of events) byId.get(event.context_user_id)?.push(event);
  const rows = players.map((player) => ({
    ...player,
    group: player.game_started_at ? "played" : player.match_requested_at ? "requested" : "browsed",
    profile: profile(player, byId.get(player.activity_id)),
    relay: relay?.get(player.activity_id),
  }));
  const grouped = Object.fromEntries(
    GROUPS.map((group) => [group, rows.filter((row) => row.group === group)]),
  );
  const played = grouped.played;
  const reach = (pick) =>
    [...new Set(rows.flatMap((row) => [...pick(row)]))]
      .map((value) => ({
        value,
        ...Object.fromEntries(
          GROUPS.map((group) => [
            group,
            share(
              grouped[group].filter((row) => pick(row).has(value)).length,
              grouped[group].length,
            ),
          ]),
        ),
      }))
      .filter((row) => rows.filter((item) => pick(item).has(row.value)).length >= MIN_GROUP)
      .sort((a, b) => (b.played ?? 0) - (a.played ?? 0));
  const segment = (key) =>
    countBy(rows, key).map(([value, ids]) => {
      const members = rows.filter((row) => key(row) === value);
      return {
        value,
        ids,
        requested: share(members.filter((row) => row.match_requested_at).length, ids),
        played: share(members.filter((row) => row.game_started_at).length, ids),
      };
    });
  const report = {
    environment,
    days,
    minimumGroup: MIN_GROUP,
    cohort: {
      ids: rows.length,
      ...Object.fromEntries(GROUPS.map((group) => [group, grouped[group].length])),
      medianClicksToFirstMatch: median(played.map((row) => row.recorded_clicks)),
      medianHoursToFirstMatch: median(
        played.map((row) => Math.round((row.game_started_at - row.first_observed_at) / 36e5)),
      ),
    },
    byAcquisition: segment((row) => row.acquisition ?? "unknown"),
    bySource: countBy(played, (row) => row.match_source ?? "none").map(([value, ids]) => ({
      value,
      ids,
      medianClicks: median(
        played
          .filter((row) => (row.match_source ?? "none") === value)
          .map((row) => row.recorded_clicks),
      ),
    })),
    screensBeforeFirstMatch: reach((row) => row.profile.screens),
    actionsBeforeFirstMatch: reach((row) => row.profile.actions),
    setupSteps: [...new Set(rows.flatMap((row) => [...row.profile.stepClicks.keys()]))]
      .map((value) => {
        const reached = rows.filter((row) => row.profile.stepClicks.has(value));
        return {
          value,
          ids: reached.length,
          ...Object.fromEntries(
            GROUPS.map((group) => [
              group,
              share(
                grouped[group].filter((row) => row.profile.stepClicks.has(value)).length,
                grouped[group].length,
              ),
            ]),
          ),
          medianClicksAtFirst: median(reached.map((row) => row.profile.stepClicks.get(value))),
        };
      })
      .filter((row) => row.ids >= MIN_GROUP)
      .sort((a, b) => (a.medianClicksAtFirst ?? Infinity) - (b.medianClicksAtFirst ?? Infinity)),
    lastScreenOfNonPlayers: countBy(
      grouped.browsed.filter((row) => row.profile.lastScreen),
      (row) => row.profile.lastScreen,
    ).map(([value, ids]) => ({ value, ids, share: share(ids, grouped.browsed.length) })),
    openingPaths: Object.fromEntries(
      GROUPS.map((group) => [
        group,
        countBy(
          grouped[group].filter((row) => row.profile.opening),
          (row) => row.profile.opening,
        )
          .slice(0, 8)
          .map(([value, ids]) => ({ value, ids })),
      ]),
    ),
    visitKinds: VISIT_KINDS.map((value) => ({
      value,
      ...Object.fromEntries(
        GROUPS.map((group) => {
          const kinds = grouped[group].flatMap((row) => row.profile.visitKinds);
          const count = kinds.filter((kind) => kind === value).length;
          return [group, count >= MIN_GROUP ? count : null];
        }),
      ),
    })).filter((row) => GROUPS.some((group) => row[group] !== null)),
    medianVisitsBeforeFirstMatch: Object.fromEntries(
      GROUPS.map((group) => [group, median(grouped[group].map((row) => row.profile.visits))]),
    ),
  };
  if (relay) {
    const now = Date.now();
    const existing = rows.filter((row) => row.relay && row.relay.firstGame < row.first_observed_at);
    const fresh = played.filter((row) => !existing.includes(row));
    const matured = fresh.filter((row) => now - row.game_started_at >= 7 * DAY_MS);
    const retained = (members) =>
      share(
        members.filter((row) => row.relay && row.relay.lastGame >= row.game_started_at + 7 * DAY_MS)
          .length,
        members.length,
      );
    const after = (key) =>
      countBy(matured, key).map(([value, ids]) => ({
        value,
        ids,
        returnedAfter7Days: retained(matured.filter((row) => key(row) === value)),
      }));
    report.relay = {
      matchedIds: rows.filter((row) => row.relay).length,
      existingPlayers: existing.length,
      existingByGroup: Object.fromEntries(
        GROUPS.map((group) => [group, existing.filter((row) => row.group === group).length]),
      ),
      newPlayers: fresh.length,
      medianRelayGames: median(fresh.filter((row) => row.relay).map((row) => row.relay.games)),
      maturedNewPlayers: matured.length,
      returnedAfter7Days: retained(matured),
      bySource: after((row) => row.match_source ?? "none"),
      byAcquisition: after((row) => row.acquisition ?? "unknown"),
    };
  }
  return report;
}

function table(title, rows, columns) {
  if (!rows.length) return `${title}\n  (no group reaches ${MIN_GROUP} IDs)\n`;
  const cells = rows.map((row) => columns.map((column) => String(row[column] ?? "-")));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((line) => line[index].length)),
  );
  const line = (values) =>
    `  ${values.map((value, index) => value.padEnd(widths[index])).join("  ")}`;
  return [title, line(columns), ...cells.map(line), ""].join("\n");
}

export function formatReport(report) {
  const { cohort } = report;
  const out = [
    `Client analytics: ${report.environment}, IDs first seen in the last ${report.days} days`,
    `Groups smaller than ${report.minimumGroup} are suppressed. Percentages are of each group.`,
    "",
    `Cohort: ${cohort.ids} IDs. browsed only ${cohort.browsed}, requested a match ${cohort.requested}, played ${cohort.played}.`,
    `Median clicks to first match ${cohort.medianClicksToFirstMatch ?? "-"}, median hours ${cohort.medianHoursToFirstMatch ?? "-"}.`,
    "",
    table("By acquisition (% requested / % played)", report.byAcquisition, [
      "value",
      "ids",
      "requested",
      "played",
    ]),
    table("First match source (played)", report.bySource, ["value", "ids", "medianClicks"]),
    table("Screens seen before first match (% of group)", report.screensBeforeFirstMatch, [
      "value",
      ...GROUPS,
    ]),
    table("Actions before first match (% of group)", report.actionsBeforeFirstMatch, [
      "value",
      ...GROUPS,
    ]),
    table(
      "Steps before first match (% of group reaching it, median clicks when first reached)",
      report.setupSteps,
      ["value", "ids", ...GROUPS, "medianClicksAtFirst"],
    ),
    table("Last screen of IDs that never requested a match", report.lastScreenOfNonPlayers, [
      "value",
      "ids",
      "share",
    ]),
    ...GROUPS.map((group) =>
      table(`Opening path of first visit: ${group}`, report.openingPaths[group], ["value", "ids"]),
    ),
    table("Visits before first match by kind (visit counts)", report.visitKinds, [
      "value",
      ...GROUPS,
    ]),
    `Median visits before first match: ${GROUPS.map((group) => `${group} ${report.medianVisitsBeforeFirstMatch[group] ?? "-"}`).join(", ")}`,
    "",
  ];
  if (report.relay) {
    const relay = report.relay;
    out.push(
      `Relay join: ${relay.matchedIds} IDs matched relay games. ${relay.existingPlayers} had played before they were first seen here (browsed ${relay.existingByGroup.browsed}, requested ${relay.existingByGroup.requested}, played ${relay.existingByGroup.played}).`,
      `New players who played: ${relay.newPlayers}, median relay games ${relay.medianRelayGames ?? "-"}. Of ${relay.maturedNewPlayers} with 7+ days since first match, ${relay.returnedAfter7Days ?? "-"}% played again 7+ days later.`,
      "",
      table("Return after 7 days by first match source", relay.bySource, [
        "value",
        "ids",
        "returnedAfter7Days",
      ]),
      table("Return after 7 days by acquisition", relay.byAcquisition, [
        "value",
        "ids",
        "returnedAfter7Days",
      ]),
    );
  }
  return out.join("\n");
}

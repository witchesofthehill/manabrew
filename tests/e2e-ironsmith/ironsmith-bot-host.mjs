import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = await readFile(
  new URL("../../manabrew-rs/crates/manabrew-relay-protocol/Cargo.toml", import.meta.url),
  "utf8",
);
const protocolVersion = Number(manifest.match(/^version = "(\d+)\./m)[1]);
const url = `ws://${process.env.RELAY_HOST || "localhost"}:${process.env.RELAY_PORT || "9443"}`;
const sockets = [];

async function connect(label) {
  const username = `BotHost${label}${Date.now().toString(36)}`;
  const socket = new WebSocket(url);
  sockets.push(socket);
  const messages = [];
  socket.addEventListener("message", ({ data }) => messages.push(JSON.parse(data)));
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = (message) => socket.send(JSON.stringify(message));
  const wait = async (predicate) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      const error = messages.find((message) => message.type === "Error");
      if (error) throw new Error(JSON.stringify(error));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out for ${username}: ${JSON.stringify(messages)}`);
  };
  send({ type: "Authenticate", username, password: process.env.RELAY_PW || "forge" });
  assert.equal((await wait((message) => message.type === "AuthResult")).success, true);
  return { username, send, wait };
}

try {
  const host = await connect("Host");
  const bot = await connect("Bot");
  const guest = await connect("Guest");
  host.send({
    type: "CreateRoom",
    room_name: host.username,
    max_players: 3,
    format: "Vintage",
    engine: "Ironsmith",
    protocol_version: protocolVersion,
  });
  const { room_id: roomId } = await host.wait((message) => message.type === "RoomCreated");
  bot.send({ type: "JoinRoom", room_id: roomId, as_bot: true });
  await bot.wait((message) => message.type === "RoomUpdate");
  guest.send({ type: "JoinRoom", room_id: roomId });
  await guest.wait((message) => message.type === "RoomUpdate");
  host.send({ type: "LeaveRoom" });
  const handoff = await bot.wait(
    (message) => message.type === "RoomUpdate" && message.room.host === guest.username,
  );
  assert.equal(
    handoff.room.players.find((player) => player.username === bot.username).is_bot,
    true,
  );
  guest.send({ type: "LeaveRoom" });
  const alone = await bot.wait(
    (message) => message.type === "RoomUpdate" && message.room.players.length === 1,
  );
  assert.notEqual(alone.room.host, bot.username, "The final human handed hosting to a bot");
  bot.send({ type: "LeaveRoom" });
  console.log(
    "PASS: relay skips a bot when handing off to a human and never hosts on a bot-only seat",
  );
} catch (error) {
  console.error("FAIL:", error);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
}

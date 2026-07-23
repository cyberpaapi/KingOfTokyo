import { getD1 } from "../../../../db";

type Room = { code: string; host_token: string; status: string; game_state: string | null; revision: number };
type Member = { token: string; player_id: number; name: string; monster: number };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" };
const json = (data: unknown, init?: ResponseInit) => Response.json(data, { ...init, headers: cors });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

async function roomView(code: string, token: string) {
  const db = getD1();
  const room = await db.prepare("SELECT code, host_token, status, game_state, revision FROM game_rooms WHERE code = ?").bind(code).first<Room>();
  if (!room) return null;
  const members = await db.prepare("SELECT token, player_id, name, monster FROM room_players WHERE room_code = ? ORDER BY player_id").bind(code).all<Member>();
  const caller = members.results.find((member) => member.token === token);
  if (!caller) return false;
  return {
    code: room.code,
    status: room.status,
    revision: room.revision,
    gameState: room.game_state ? JSON.parse(room.game_state) : null,
    playerId: caller.player_id,
    host: room.host_token === token,
    players: members.results.map(({ player_id, name, monster }) => ({ id: player_id, name, monster })),
  };
}

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const roomCode = code.toUpperCase();
  const params = new URL(request.url).searchParams;
  const token = params.get("token") ?? "";
  const since = Math.max(-1, Number(params.get("since") ?? -1));
  const waitMs = Math.min(15_000, Math.max(0, Number(params.get("wait") ?? 0)));
  let view = await roomView(roomCode, token);
  if (view === null) return json({ error: "Room not found" }, { status: 404 });
  if (view === false) return json({ error: "Invalid room token" }, { status: 403 });
  const deadline = Date.now() + waitMs;
  while (waitMs > 0 && view.revision <= since && Date.now() < deadline) {
    await pause(300);
    const latest = await getD1().prepare("SELECT revision FROM game_rooms WHERE code = ?").bind(roomCode).first<{ revision: number }>();
    if (!latest) return json({ error: "Room not found" }, { status: 404 });
    if (latest.revision > since) {
      view = await roomView(roomCode, token);
      if (!view || view === false) return json({ error: "Room unavailable" }, { status: 403 });
      break;
    }
  }
  return json(view);
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const roomCode = code.toUpperCase();
  const { name = "Player", monster = 0 } = await request.json() as { name?: string; monster?: number };
  const db = getD1();
  const room = await db.prepare("SELECT host_token, status, revision FROM game_rooms WHERE code = ?").bind(roomCode).first<{ host_token: string; status: string; revision: number }>();
  if (!room) return json({ error: "Room not found" }, { status: 404 });
  const playerName = String(name).slice(0, 22).trim() || "Player";
  const returning = await db.prepare("SELECT token, player_id, name, monster FROM room_players WHERE room_code = ? AND lower(name) = lower(?)").bind(roomCode, playerName).first<Member>();
  if (returning) {
    const token = crypto.randomUUID();
    const statements = [
      db.prepare("UPDATE room_players SET token = ?, monster = ? WHERE room_code = ? AND player_id = ?").bind(token, Number(monster) % 9, roomCode, returning.player_id),
      db.prepare("UPDATE game_rooms SET revision = revision + 1, updated_at = ? WHERE code = ?").bind(new Date().toISOString(), roomCode),
    ];
    if (room.host_token === returning.token) statements.push(db.prepare("UPDATE game_rooms SET host_token = ? WHERE code = ?").bind(token, roomCode));
    await db.batch(statements);
    const view = await roomView(roomCode, token);
    if (!view || view === false) return json({ error: "Could not resume room" }, { status: 500 });
    return json({ ...view, token, resumed: true });
  }
  if (room.status !== "lobby") return json({ error: "Match already started. Rejoin with the same player name." }, { status: 409 });
  const count = await db.prepare("SELECT COUNT(*) AS total FROM room_players WHERE room_code = ?").bind(roomCode).first<{ total: number }>();
  if ((count?.total ?? 0) >= 6) return json({ error: "Room is full" }, { status: 409 });
  const token = crypto.randomUUID();
  const playerId = count?.total ?? 0;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO room_players (token, room_code, player_id, name, monster, joined_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(token, roomCode, playerId, playerName, Number(monster) % 9, now),
    db.prepare("UPDATE game_rooms SET revision = revision + 1, updated_at = ? WHERE code = ?").bind(now, roomCode),
  ]);
  const view = await roomView(roomCode, token);
  if (!view || view === false) return json({ error: "Could not join room" }, { status: 500 });
  return json({ ...view, token, resumed: false });
}

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const roomCode = code.toUpperCase();
  const body = await request.json() as { token?: string; action?: string; state?: unknown; revision?: number };
  const db = getD1();
  const room = await db.prepare("SELECT host_token, status, revision, game_state FROM game_rooms WHERE code = ?").bind(roomCode).first<{ host_token: string; status: string; revision: number; game_state: string | null }>();
  if (!room) return json({ error: "Room not found" }, { status: 404 });
  const member = await db.prepare("SELECT player_id FROM room_players WHERE room_code = ? AND token = ?").bind(roomCode, body.token ?? "").first<{ player_id: number }>();
  if (!member) return json({ error: "Not a member" }, { status: 403 });
  if (body.action === "start" && room.host_token !== body.token) return json({ error: "Only the host can start" }, { status: 403 });
  if (Number(body.revision) !== room.revision) return json({ error: "State changed", revision: room.revision }, { status: 409 });
  const previous = room.game_state ? JSON.parse(room.game_state) as { currentId?: number; pendingYield?: { targetId?: number } | null } : null;
  if (body.action !== "start" && previous && previous.currentId !== member.player_id && previous.pendingYield?.targetId !== member.player_id) {
    return json({ error: "It is not your turn" }, { status: 403 });
  }
  const nextRevision = room.revision + 1;
  const updated = await db.prepare("UPDATE game_rooms SET status = ?, game_state = ?, revision = ?, updated_at = ? WHERE code = ? AND revision = ?")
    .bind(body.action === "start" ? "active" : room.status, JSON.stringify(body.state), nextRevision, new Date().toISOString(), roomCode, room.revision).run();
  if (!updated.meta.changes) return json({ error: "State changed", revision: room.revision }, { status: 409 });
  return json({ revision: nextRevision });
}

import { getD1 } from "../../../../db";

type Room = { code: string; host_token: string; status: string; game_state: string | null; revision: number };
type Member = { token: string; player_id: number; name: string; monster: number };

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
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const view = await roomView(code.toUpperCase(), token);
  if (view === null) return Response.json({ error: "Room not found" }, { status: 404 });
  if (view === false) return Response.json({ error: "Invalid room token" }, { status: 403 });
  return Response.json(view);
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const roomCode = code.toUpperCase();
  const { name = "Player", monster = 0 } = await request.json() as { name?: string; monster?: number };
  const db = getD1();
  const room = await db.prepare("SELECT status FROM game_rooms WHERE code = ?").bind(roomCode).first<{ status: string }>();
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  if (room.status !== "lobby") return Response.json({ error: "Match already started" }, { status: 409 });
  const count = await db.prepare("SELECT COUNT(*) AS total FROM room_players WHERE room_code = ?").bind(roomCode).first<{ total: number }>();
  if ((count?.total ?? 0) >= 6) return Response.json({ error: "Room is full" }, { status: 409 });
  const token = crypto.randomUUID();
  const playerId = count?.total ?? 0;
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO room_players (token, room_code, player_id, name, monster, joined_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(token, roomCode, playerId, String(name).slice(0, 22), Number(monster) % 9, now).run();
  return Response.json({ code: roomCode, token, playerId, host: false });
}

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const roomCode = code.toUpperCase();
  const body = await request.json() as { token?: string; action?: string; state?: unknown; revision?: number };
  const db = getD1();
  const room = await db.prepare("SELECT host_token, status, revision, game_state FROM game_rooms WHERE code = ?").bind(roomCode).first<{ host_token: string; status: string; revision: number; game_state: string | null }>();
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  const member = await db.prepare("SELECT player_id FROM room_players WHERE room_code = ? AND token = ?").bind(roomCode, body.token ?? "").first<{ player_id: number }>();
  if (!member) return Response.json({ error: "Not a member" }, { status: 403 });
  if (body.action === "start" && room.host_token !== body.token) return Response.json({ error: "Only the host can start" }, { status: 403 });
  if (Number(body.revision) !== room.revision) return Response.json({ error: "State changed", revision: room.revision }, { status: 409 });
  const previous = room.game_state ? JSON.parse(room.game_state) as { currentId?: number; pendingYield?: { targetId?: number } | null } : null;
  if (body.action !== "start" && previous && previous.currentId !== member.player_id && previous.pendingYield?.targetId !== member.player_id) {
    return Response.json({ error: "It is not your turn" }, { status: 403 });
  }
  const nextRevision = room.revision + 1;
  await db.prepare("UPDATE game_rooms SET status = ?, game_state = ?, revision = ?, updated_at = ? WHERE code = ?")
    .bind(body.action === "start" ? "active" : room.status, JSON.stringify(body.state), nextRevision, new Date().toISOString(), roomCode).run();
  return Response.json({ revision: nextRevision });
}

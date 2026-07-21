import { getD1 } from "../../../db";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => alphabet[n % alphabet.length]).join("");

export async function POST(request: Request) {
  const { name = "Player", monster = 0 } = await request.json() as { name?: string; monster?: number };
  const db = getD1();
  let roomCode = code();
  while (await db.prepare("SELECT 1 FROM game_rooms WHERE code = ?").bind(roomCode).first()) roomCode = code();
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO game_rooms (code, host_token, status, revision, created_at, updated_at) VALUES (?, ?, 'lobby', 0, ?, ?)").bind(roomCode, token, now, now),
    db.prepare("INSERT INTO room_players (token, room_code, player_id, name, monster, joined_at) VALUES (?, ?, 0, ?, ?, ?)").bind(token, roomCode, String(name).slice(0, 22), Number(monster) % 9, now),
  ]);
  return Response.json({ code: roomCode, token, playerId: 0, host: true });
}

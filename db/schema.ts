import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gameRooms = sqliteTable("game_rooms", {
  code: text("code").primaryKey(),
  hostToken: text("host_token").notNull(),
  status: text("status").notNull().default("lobby"),
  gameState: text("game_state"),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const roomPlayers = sqliteTable("room_players", {
  token: text("token").primaryKey(),
  roomCode: text("room_code").notNull(),
  playerId: integer("player_id").notNull(),
  name: text("name").notNull(),
  monster: integer("monster").notNull(),
  joinedAt: text("joined_at").notNull(),
});

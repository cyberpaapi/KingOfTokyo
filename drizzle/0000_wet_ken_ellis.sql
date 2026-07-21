CREATE TABLE `game_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_token` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`game_state` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_players` (
	`token` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`player_id` integer NOT NULL,
	`name` text NOT NULL,
	`monster` integer NOT NULL,
	`joined_at` text NOT NULL
);

CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`lock_token` text,
	`lock_until` integer DEFAULT 0 NOT NULL
);

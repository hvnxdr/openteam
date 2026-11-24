CREATE TABLE `command_receipts` (
	`key` text PRIMARY KEY,
	`command` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`response_status` integer NOT NULL,
	`event_seq` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_command_receipts_event_seq_events_seq_fk` FOREIGN KEY (`event_seq`) REFERENCES `events`(`seq`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`cursor` text NOT NULL UNIQUE,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `foundation_probes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL UNIQUE,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	`event_seq` integer NOT NULL,
	CONSTRAINT `fk_foundation_probes_event_seq_events_seq_fk` FOREIGN KEY (`event_seq`) REFERENCES `events`(`seq`),
	CONSTRAINT "foundation_probes_message_length" CHECK(length("message") between 1 and 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_receipts_event_seq_unique` ON `command_receipts` (`event_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `foundation_probes_event_seq_unique` ON `foundation_probes` (`event_seq`);
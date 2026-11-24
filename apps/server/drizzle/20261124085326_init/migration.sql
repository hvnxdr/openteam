CREATE TABLE `schema_version` (
	`version` text PRIMARY KEY,
	`artifact_hash` text NOT NULL,
	`applied_at` text NOT NULL
);

ALTER TABLE "agent_runtime_state" ADD COLUMN "total_cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "cost_micros" bigint DEFAULT 0 NOT NULL;
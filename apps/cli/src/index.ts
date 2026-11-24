import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Command, Flag } from "effect/cli";
import { Effect } from "effect";
import { createClient } from "@openteam/client";

const baseUrl = Flag.String("base-url").pipe(
  Flag.withDefault("http://127.0.0.1:3000"),
  Flag.withDescription("OpenTeam server URL"),
);

const health = Command.make("health", { baseUrl }, ({ baseUrl }) =>
  Effect.gen(function* () {
    const client = createClient({ baseUrl });
    yield* Effect.logInfo(`OpenTeam remote client targets ${client.baseUrl}`);
  }),
);

const cli = Command.make("openteam").pipe(Command.withSubcommands([health]));

cli.pipe(Command.run({ version: "0.0.0" }), Effect.provide(BunServices.layer), BunRuntime.runMain);

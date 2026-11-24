import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

/** Server entry point; HTTP and persistence services are composed by later slices. */
const program = Effect.log("OpenTeam server workspace is ready");

BunRuntime.runMain(program);

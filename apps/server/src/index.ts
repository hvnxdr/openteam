import { BunRuntime } from "@effect/platform-bun";
import { serverProgram } from "./runtime.ts";

BunRuntime.runMain(serverProgram(), { disableErrorReporting: true });

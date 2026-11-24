import { Command } from "commander";

import { registerInit } from "./commands/init.js";
import { registerRun } from "./commands/run.js";
import { loadEnvFiles } from "./lib/env.js";
import { fail } from "./lib/log.js";

// Replaced at build time by tsup's `define`; the fallback only shows under tsx.
declare const __DATARECIPE_VERSION__: string;
const VERSION = typeof __DATARECIPE_VERSION__ !== "undefined" ? __DATARECIPE_VERSION__ : "0.0.0-dev";

loadEnvFiles();

const program = new Command()
  .name("datarecipe")
  .description("Turn hundreds of websites into a clean dataset with one recipe file. Powered by Olostep.")
  .version(VERSION, "-V, --version", "show version")
  .helpOption("-h, --help", "show help")
  .showHelpAfterError();

registerInit(program);
registerRun(program);

program.parseAsync(process.argv).catch(fail);

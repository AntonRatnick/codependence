#!/usr/bin/env node

import { program } from "commander";
import { cosmiconfigSync } from "cosmiconfig";
import gradient from "gradient-string";
import { script } from "./scripts";
import { DEBUG_NAME } from "./constants";
import { Options, ConfigResult } from "./types";

const explorer = cosmiconfigSync("codependence");

export async function action(options: Options = {}): Promise<void> {
  try {
    const { config } = (
      options?.config ? explorer.load(options.config) : explorer.search() || {}
    ) as ConfigResult;
    if (options?.isTestingCLI) {
      console.info({ config, options });
      return;
    }
    const updatedConfig = {
      ...(config?.codependence ? { ...config.codependence } : config),
      ...options,
      isCLI: true,
    };
    const { config: usedConfig, ...updatedOptions } = updatedConfig;
    if (!updatedOptions.codependencies) throw '"codependencies" is required';
    await script(updatedOptions);
  } catch (err) {
    console.error(
      `${gradient.passion(`${DEBUG_NAME}cli:error:`)}\n   🤼‍♀️ => ${err}`
    );
  }
}

program
  .description(
    "Codependency, for code dependency. Checks `coDependencies` in package.json files to ensure dependencies are up-to-date"
  )
  .option("-t, --isTestingCLI", "enables CLI testing, no scripts are run")
  .option(
    "--isTesting",
    "enables running integration tests w/o overwritting package.json's"
  )
  .option("-f, --files [files...]", "file glob pattern")
  .option("-u, --update", "update dependencies based on check")
  .option("-r, --rootDir <rootDir>", "root directory to start search")
  .option("-i, --ignore [ignore...]", "ignore glob pattern")
  .option("--debug", "enable debugging")
  .option("--silent", "enable mainly silent logging")
  .option(
    "-cds, --codependencies [codependencies...]",
    "a path to a file with a codependenies object"
  )
  .option("-c, --config <config>", "accepts a path to a config file")
  .action(action)
  .parse(process.argv);

export { program };

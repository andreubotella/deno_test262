#!/usr/bin/env -S deno run --allow-read --allow-run --unstable --import-map=import_map.json

import { assert } from "std/testing/asserts.ts";
import { blue, bold, green, red } from "std/fmt/colors.ts";
import { fromFileUrl, relative } from "std/path/mod.ts";
import { walk } from "std/fs/mod.ts";
import { parse as parseYaml } from "std/encoding/yaml.ts";

const TEST262_ROOT = new URL("./test262/", import.meta.url);
const TEST_DIR = new URL("./test/", TEST262_ROOT);
const SETUP_SCRIPT = new URL("./util/setup.js", import.meta.url);

async function runTest(
  test: string,
  { errorType, includes, addUseStrict, isModule, isAsync }: {
    errorType: string | undefined;
    includes: string[];
    addUseStrict: boolean;
    isModule: boolean;
    isAsync: boolean;
  },
): Promise<boolean> {
  const env: Record<string, string> = {
    "TEST_FILE": test,
  };
  if (errorType !== undefined) env["ERROR_TYPE"] = errorType;
  if (includes) env["INCLUDES"] = includes.join(",");
  if (addUseStrict) env["USE_STRICT"] = "";
  if (isModule) env["IS_MODULE"] = "";
  if (isAsync) env["IS_ASYNC"] = "";

  const proc = Deno.run({
    cmd: [
      "deno",
      "run",
      "--allow-read",
      "--allow-env",
      fromFileUrl(SETUP_SCRIPT),
    ],
    env,
    stdout: "null",
    stderr: "piped",
    stdin: "null",
  });

  const stderr = new TextDecoder().decode(await proc.stderrOutput());
  const { success } = await proc.status();

  console.log(
    "%s (%s) ... %s",
    test,
    isModule ? "module" : addUseStrict ? "strict" : "non-strict",
    success ? green("ok") : red("failed"),
  );
  if (!success) {
    console.error(stderr);
  }

  return success;
}

async function processTest(test: string, failures: string[]) {
  const testFile = await Deno.readTextFile(new URL(test, TEST_DIR));
  const frontMatterMatch = testFile.match(/\/\*---(.*?)---\*\//s);
  assert(frontMatterMatch !== null, "WTF: No front matter found.");

  type FrontMatterFlag =
    | "onlyStrict"
    | "noStrict"
    | "module"
    | "raw"
    | "async"
    | "generated"
    | "CanBlockIsFalse"
    | "CanBlockIsTrue"
    | "non-deterministic";

  interface FrontMatter {
    negative?: {
      phase: "parse" | "resolution" | "runtime";
      type: string;
    };
    includes?: string[];
    flags?: FrontMatterFlag[];
    locale?: string[];
  }

  const frontMatter = parseYaml(frontMatterMatch[1]) as FrontMatter;
  const flags = frontMatter.flags ?? [];

  // By default we must run each test wice, one with an additional "use strict"
  // declaration, and one without. If `addUseStrict` is true, this instance of
  // the test will be run with an additional strict declaration, regardless of
  // whether the test would be strict anyway.
  const instancesFailed = [];
  let numTotalInstances = 0;
  for (const addUseStrict of [true, false]) {
    if (
      (addUseStrict && flags.includes("noStrict")) ||
      (addUseStrict && flags.includes("module")) ||
      (addUseStrict && flags.includes("raw")) ||
      (!addUseStrict && flags.includes("onlyStrict"))
    ) {
      continue;
    }

    numTotalInstances++;

    const success = await runTest(test, {
      errorType: frontMatter.negative?.type,
      includes: frontMatter.includes ?? [],
      addUseStrict,
      isModule: flags.includes("module"),
      isAsync: flags.includes("async"),
    });
    if (!success) {
      instancesFailed.push(addUseStrict);
    }
  }

  // If there were two instances of this test (with and without "use strict"),
  // and both fail, just report the test as failing. Same if there was only one
  // instance. But if one instance succeeds and the other fails, note which one
  // fails.
  if (instancesFailed.length === numTotalInstances) {
    failures.push(test);
  } else if (instancesFailed.length !== 0) {
    assert(instancesFailed.length === 1);
    failures.push(
      `${test} (${instancesFailed[0] ? "strict" : "non-strict"})`,
    );
  }
}

async function main() {
  const failures: string[] = [];

  for await (const entry of walk(fromFileUrl(TEST_DIR))) {
    if (entry.isDirectory || entry.name.includes("_FIXTURE")) {
      continue;
    }

    const relativePath = relative(fromFileUrl(TEST_DIR), entry.path);

    console.log(`${blue("-".repeat(40))}\n${bold(relativePath)}\n`);

    await processTest(relativePath, failures);
  }

  console.log();
  console.log("The following tests failed:");
  for (const failure of failures) {
    console.log("\t%s", failure);
  }
}

main();

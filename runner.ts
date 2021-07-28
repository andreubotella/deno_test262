#!/usr/bin/env -S deno run --allow-read --allow-run --unstable --import-map=import_map.json

import { Args as FlagArgs, parse as parseFlags } from "std/flags/mod.ts";
import { assert } from "std/testing/asserts.ts";
import { blue, bold, green, red, yellow } from "std/fmt/colors.ts";
import { fromFileUrl, relative } from "std/path/mod.ts";
import { walk } from "std/fs/mod.ts";
import { parse as parseYaml } from "std/encoding/yaml.ts";

// -----------------------------------------------------------------------------

interface ExpectationFolder {
  [file: string]: ExpectationFolder | boolean;
}

type DifferenceRecord = {
  unexpectedFailures: string[];
  unexpectedSuccesses: string[];
};

// -----------------------------------------------------------------------------

const TEST262_ROOT = new URL("./test262/", import.meta.url);
const TEST_DIR = new URL("./test/", TEST262_ROOT);
const SETUP_SCRIPT = new URL("./util/setup.js", import.meta.url);
const EXPECTATION_FILE = new URL("./expectations.json", import.meta.url);

// Returns whether the test result succeeded, not whether it matched the
// expectation.
async function runTest(
  test: string,
  { errorType, includes, addUseStrict, isModule, isAsync }: {
    errorType: string | undefined;
    includes: string[];
    addUseStrict: boolean;
    isModule: boolean;
    isAsync: boolean;
  },
): Promise<{ success: boolean; stderr: string }> {
  const proc = Deno.run({
    cmd: [
      "deno",
      "run",
      "--allow-read",
      "--allow-env",
      fromFileUrl(SETUP_SCRIPT),
    ],
    env: {
      "TEST_FILE": test,
      "ERROR_TYPE": errorType ?? "",
      "INCLUDES": includes.join(","),
      "USE_STRICT": addUseStrict ? "1" : "",
      "IS_MODULE": isModule ? "1" : "",
      "IS_ASYNC": isAsync ? "1" : "",
    },
    stdout: "null",
    stderr: "piped",
    stdin: "null",
  });

  const stderr = new TextDecoder().decode(await proc.stderrOutput());
  const { success } = await proc.status();
  return { success, stderr };
}

async function processTest(
  test: string,
  expected: boolean,
  differences: DifferenceRecord,
  outputFlags: { quiet: boolean; onlyPrintFailures: boolean },
) {
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

    const { success, stderr } = await runTest(test, {
      errorType: frontMatter.negative?.type,
      includes: frontMatter.includes ?? [],
      addUseStrict,
      isModule: flags.includes("module"),
      isAsync: flags.includes("async"),
    });

    if (
      !outputFlags.quiet &&
      (!outputFlags.onlyPrintFailures || success !== expected)
    ) {
      const instanceName = flags.includes("module")
        ? "module"
        : addUseStrict
        ? "strict"
        : "non-strict";
      const successOutput = success
        ? (expected ? green("ok") : red("ok (expected fail)"))
        : (expected ? red("failed") : yellow("failed (expected)"));
      console.log("%s (%s) ... %s", test, instanceName, successOutput);

      if (success !== expected) {
        console.error(stderr);
      }
    }

    if (success != expected) {
      instancesFailed.push(addUseStrict);
    }
  }

  // If there were two instances of this test (with and without "use strict"),
  // and both fail, just report the test as failing. Same if there was only one
  // instance. But if one instance succeeds and the other fails, note which one
  // fails.
  const failures = expected
    ? differences.unexpectedFailures
    : differences.unexpectedSuccesses;
  if (instancesFailed.length === numTotalInstances) {
    (failures).push(test);
  } else if (instancesFailed.length !== 0) {
    assert(instancesFailed.length === 1);
    failures.push(
      `${test} (${instancesFailed[0] ? "strict" : "non-strict"})`,
    );
  }
}

async function main() {
  const { ["--"]: filters, quiet, ["only-print-failures"]: onlyPrintFailures } =
    parseFlags(Deno.args, {
      "--": true,
      boolean: ["quiet", "only-print-failures"],
    }) as
      & FlagArgs
      & { ["--"]: string[]; quiet: boolean; ["only-print-failures"]: boolean };

  const expectations: ExpectationFolder = JSON.parse(
    await Deno.readTextFile(EXPECTATION_FILE),
  );

  const differences = { unexpectedFailures: [], unexpectedSuccesses: [] };

  for await (const entry of walk(fromFileUrl(TEST_DIR))) {
    if (entry.isDirectory || entry.name.includes("_FIXTURE")) {
      continue;
    }

    const relativePath = relative(fromFileUrl(TEST_DIR), entry.path);

    if (
      filters.length !== 0 &&
      !filters.find((filter) => relativePath.startsWith(filter))
    ) {
      continue;
    }

    if (!quiet && !onlyPrintFailures) {
      console.log(`${blue("-".repeat(40))}\n${bold(relativePath)}\n`);
    }

    const components = relativePath.split("/");
    let folderExpectations: ExpectationFolder | undefined = expectations;
    for (const component of components.slice(0, -1)) {
      const newFolderExpectations: ExpectationFolder | boolean | undefined =
        folderExpectations?.[component];
      assert(typeof newFolderExpectations !== "boolean");
      folderExpectations = newFolderExpectations;
    }

    const expected = folderExpectations?.[components.at(-1)!] ?? true;
    assert(typeof expected === "boolean");

    await processTest(relativePath, expected, differences, {
      quiet,
      onlyPrintFailures,
    });
  }

  if (differences.unexpectedFailures.length !== 0) {
    console.log();
    console.log("The following tests failed:");
    for (const failure of differences.unexpectedFailures) {
      console.log("\t%s", failure);
    }
  }

  if (differences.unexpectedSuccesses.length !== 0) {
    console.log();
    console.log("The following tests succeeded unexpectedly:");
    for (const success of differences.unexpectedSuccesses) {
      console.log("\t%s", success);
    }
  }

  if (
    differences.unexpectedFailures.length !== 0 ||
    differences.unexpectedSuccesses.length !== 0
  ) {
    Deno.exit(1);
  }
}

main();

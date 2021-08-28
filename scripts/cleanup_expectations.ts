#!/usr/bin/env -S deno run --unstable --allow-read --allow-write --allow-env --import-map=import_map.json

import { fromFileUrl, join } from "std/path/mod.ts";
import { exists } from "std/fs/mod.ts";
import type {
  FileExpectation,
  FolderExpectation,
} from "../expectation_types.d.ts";

const TEST262_DIR = fromFileUrl(new URL("../test262/test", import.meta.url));

function walkExpectations(
  prefix: string,
  expectation: FolderExpectation | FileExpectation,
  tests: Set<string>,
): void {
  if (typeof prefix !== "object") {
    tests.add(prefix);
  } else {
    for (const [key, value] of Object.entries(expectation)) {
      walkExpectations(join(prefix, key), value, tests);
    }
  }
}

function cleanupExpectation<
  T extends FolderExpectation | FileExpectation,
>(
  prefix: string | null,
  expectation: T,
  testsRemoved: Set<string>,
): Promise<T> {
  if (typeof expectation !== "object") {
    return Promise.resolve(expectation);
  }

  type Entry = [string, FolderExpectation | FileExpectation];

  const promises: Promise<Entry | undefined>[] = [];
  for (const [key, value] of Object.entries(expectation)) {
    const path = prefix === null ? key : join(prefix, key);
    const promise = (async (): Promise<Entry | undefined> => {
      // Does the path exist?
      if (!await exists(join(TEST262_DIR, path))) {
        // Log all the tests that we're removing.
        walkExpectations(path, value, testsRemoved);
        return;
      }

      let newValue;
      if (typeof value === "object") {
        // If this is a directory, run `cleanupExpectation` recursively, and
        // remove it if there are no failures.
        newValue = await cleanupExpectation(path, value, testsRemoved);
        if (Object.entries(newValue).length === 0) return;
      } else {
        newValue = value;
      }

      return [key, newValue];
    })();
    promises.push(promise);
  }

  return Promise.all(promises).then((entries) =>
    Object.fromEntries(
      entries.filter((entry): entry is Entry => entry !== undefined),
    ) as T
  );
}

async function main() {
  const EXPECTATIONS_FILE = new URL("../expectations.json", import.meta.url);

  const originalExpectations = JSON.parse(
    await Deno.readTextFile(EXPECTATIONS_FILE),
  );
  const testsRemoved: Set<string> = new Set();
  const cleanedUpExpectations = await cleanupExpectation(
    null,
    originalExpectations,
    testsRemoved,
  );

  if (testsRemoved.size === 0) {
    console.log("The expectations file needed no changes!");
  } else {
    await Deno.writeTextFile(
      EXPECTATIONS_FILE,
      JSON.stringify(cleanedUpExpectations, null, 2),
    );

    console.log(
      "The following tests were removed from the expectations because they no longer exist:",
    );
    for (const test of testsRemoved) {
      console.log("\t/%s", test);
    }
  }
}

main();

export {};

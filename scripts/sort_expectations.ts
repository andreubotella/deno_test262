#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --import-map=import_map.json

import { parse as parseFlags } from "std/flags/mod.ts";
import type {
  FileExpectation,
  FolderExpectation,
} from "../expectation_types.d.ts";

function sortExpectation<T extends FolderExpectation | FileExpectation>(
  expectation: T,
): T {
  if (typeof expectation !== "object") {
    return expectation;
  }

  const entries = Object.entries(expectation).map(
    ([key, value]) => [key, sortExpectation(value)],
  );
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return Object.fromEntries(entries);
}

async function main() {
  const check = parseFlags(Deno.args, { boolean: ["check"] }).check as boolean;

  const EXPECTATIONS_FILE = new URL("../expectations.json", import.meta.url);

  const originalExpectations = JSON.parse(
    await Deno.readTextFile(EXPECTATIONS_FILE),
  );
  const sortedExpectations = sortExpectation(originalExpectations);

  // We compare a new stringification of the original expectations so we can
  // ensure the indents match up.
  const originalJson = JSON.stringify(originalExpectations, null, 2);
  const sortedJson = JSON.stringify(sortedExpectations, null, 2);

  if (originalJson === sortedJson) {
    console.log("The expectations file was sorted!");
  } else {
    console.log("The expectations file was not sorted.");
    if (check) {
      console.log(
        "Make sure to run `./scripts/sort_expectations.ts` without the --check flag.",
      );
      if (Deno.env.get("CI") === "true") {
        console.log(
          "::error file=expectations.json::Expectations file is not sorted.",
        );
      }
      Deno.exit(1);
    } else {
      console.log("Sorting it!");
      await Deno.writeTextFile(EXPECTATIONS_FILE, sortedJson);
    }
  }
}

main();

export {};

(() => {
  // Make sure we control the only output.
  const { Deno, console } = globalThis;
  delete globalThis.Deno;
  delete globalThis.console;

  // ---------------------------------------------------------------------------

  // Parse environment variables

  /**
   *
   * @param {string} key
   * @param {boolean} canBeNull
   * @returns {string | null}
   */
  function parseEnvVar(key, mustExist = false) {
    const trimmed = Deno.env.get(key)?.trim();
    const ret = trimmed === "" || trimmed === undefined ? null : trimmed;
    if (ret === null && mustExist) {
      throw new Error(`Expected envvar ${key} not to be null.`);
    }
    return ret;
  }

  /** @type {string | null} */
  const errorType = parseEnvVar("ERROR_TYPE");
  /** @type {boolean} */
  const addUseStrict = parseEnvVar("USE_STRICT") !== null;
  /** @type {boolean} */
  const isModule = parseEnvVar("IS_MODULE") !== null;
  /** @type {boolean} */
  const isAsync = parseEnvVar("IS_ASYNC") !== null;

  /** @type {Set<string>} */
  const includes = new Set(["assert.js", "sta.js"]);
  if (isAsync) {
    includes.add("doneprintHandle.js");
  }
  for (const include of parseEnvVar("INCLUDES")?.split(",") ?? []) {
    includes.add(include);
  }

  /** @type {string} */
  const testFile = parseEnvVar("TEST_FILE", true);

  // ---------------------------------------------------------------------------

  const test262Root = new URL("../test262/", import.meta.url);

  for (const includedFile of includes) {
    const url = new URL(includedFile, new URL("./harness/", test262Root));
    const script = Deno.readTextFileSync(url);

    const err = Deno.core.evalContext(script, url.href)[1];
    if (err !== null) {
      console.error(
        "Error thrown from included file harness/%s:",
        includedFile,
      );
      console.error(err.thrown);
      Deno.exit(1);
    }
  }

  // TODO: async, module

  const mainScriptUrl = new URL(testFile, new URL("./test/", test262Root));
  let mainScript = Deno.readTextFileSync(mainScriptUrl);
  if (addUseStrict) {
    mainScript = `"use strict";\n${mainScript}`;
  }

  const err = Deno.core.evalContext(mainScript, mainScriptUrl.href)[1];
  if (err !== null && errorType !== null) {
    // TODO: Can we use err.isNativeError and err.isCompileError to check the
    // phase in which the error was thrown?
    const error = err.thrown;
    if (typeof error !== "object") {
      console.error(
        "Test threw %o with type %s, expected %s error.",
        error,
        typeof error,
        errorType,
      );
      Deno.exit(1);
    } else if (err === null) {
      console.error("Test threw null, expected %s error.", errorType);
      Deno.exit(1);
    } else if (typeof error.constructor !== "function") {
      console.error(
        "Test threw %o, whose constructor is type %s; expected %s error.",
        error,
        typeof error.constructor,
        errorType,
      );
      Deno.exit(1);
    } else if (error.constructor.name !== errorType) {
      console.error(
        "Test threw %s error, expected %s error.",
        error.constructor.name,
        errorType,
      );
      Deno.exit(1);
    }
  } else if (errorType !== null) {
    console.error("Expected test to throw %s error.", errorType);
    Deno.exit(1);
  } else if (err !== null) {
    console.error("Test threw an unexpected error:");
    console.error(err.thrown);
    Deno.exit(1);
  }
})();

export {};

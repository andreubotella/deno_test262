(() => {
  // Make sure we control the only output.
  const { Deno, console, URL, setTimeout } = globalThis;
  delete globalThis.Deno;
  delete globalThis.console;
  delete globalThis.URL;

  const liftThis = (fn) => fn.call.bind(fn);

  // Primordials
  const Promise = globalThis.Promise;
  const PromiseReject = Promise.reject.bind(Promise);
  const PromiseResolve = Promise.resolve.bind(Promise);
  const PromisePrototypeThen = liftThis(Promise.prototype.then);
  const structuredClone = globalThis.structuredClone;

  // ---------------------------------------------------------------------------

  // Parse environment variables

  /**
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

  let printPromise;
  if (isAsync) {
    const SUCCESS_MESSAGE = "Test262:AsyncTestComplete";
    const FAILURE_PREFIX = "Test262:AsyncTestFailure:";

    printPromise = new Promise((resolve, reject) => {
      let alreadyResolved = false;
      globalThis.print = function print(string) {
        if (alreadyResolved) {
          throw new Error("Test printed when the promise is already resolved.");
        }
        alreadyResolved = true;

        if (string === SUCCESS_MESSAGE) {
          resolve();
        } else if (string.startsWith(FAILURE_PREFIX)) {
          const message = string.slice(FAILURE_PREFIX.length).trim();
          reject(message);
        }
      };
    });
  }

  const agents = [];

  globalThis.$262 = {
    detachArrayBuffer(buffer) {
      structuredClone(undefined, { transfer: [buffer] });
    },
    evalScript(script) {
      const [ret, err] = Deno.core.evalContext(script);
      if (err !== null) {
        throw err.thrown;
      }
      return ret;
    },
    agent: {
      start(script) {
        const worker = new Worker(
          new URL("./agent-setup.js", import.meta.url),
          { type: "module", deno: true },
        );
        agents.push(worker);

        const lock = new Int32Array(new SharedArrayBuffer(4));
        worker.postMessage({
          type: "start",
          script: String(script),
          lock,
        });
        Atomics.wait(lock, 0, 0);
      },
      broadcast(sab, number) {
        const semaphore = new Int32Array(new SharedArrayBuffer(4));

        for (const agent of agents) {
          agent.postMessage({ type: "broadcast", semaphore, sab, number });
        }

        Atomics.wait(semaphore, 0, 0);

        while (true) {
          const load = Atomics.load(semaphore, 0);
          if (load >= agents.length) break;
          Atomics.wait(semaphore, 0, load);
        }
      },
    },
  };

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

  const testUrl = new URL(testFile, new URL("./test/", test262Root));

  let resultPromise;

  if (!isModule) {
    let testScript = Deno.readTextFileSync(testUrl);
    if (addUseStrict) {
      testScript = `"use strict";\n${testScript}`;
    }

    const errorInfo = Deno.core.evalContext(testScript, testUrl.href)[1];

    // TODO: Can we use err.isNativeError and err.isCompileError to check the
    // phase in which the error was thrown?
    resultPromise = (errorInfo === null)
      ? PromiseResolve()
      : PromiseReject(errorInfo.thrown);
  } else {
    resultPromise = import(testUrl.href);
  }

  PromisePrototypeThen(
    resultPromise,
    () => {
      // Test succeeded.
      if (errorType !== null) {
        console.error("Expected test to throw %s error.", errorType);
        Deno.exit(1);
      }

      if (isAsync) {
        const timeoutHandle = setTimeout(() => {
          console.error("Asynchronous test timed out.");
          Deno.exit(1);
        }, 10 * 1000);
        PromisePrototypeThen(
          printPromise,
          () => clearTimeout(timeoutHandle),
          (message) => {
            console.error("Test failed asynchronously with:");
            console.error(message);
            Deno.exit(1);
          },
        );
      }
    },
    (error) => {
      // Test failed with `error`.
      if (errorType !== null) {
        if (typeof error !== "object") {
          console.error(
            "Test threw %o with type %s, expected %s error.",
            error,
            typeof error,
            errorType,
          );
          Deno.exit(1);
        } else if (error === null) {
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
      } else {
        console.error("Test threw an unexpected error:");
        console.error(error);
        Deno.exit(1);
      }
    },
  );
})();

export {};

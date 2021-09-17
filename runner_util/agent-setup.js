(() => {
  const { Deno } = globalThis;
  delete globalThis.Deno;
  delete globalThis.console;
  delete globalThis.URL;

  globalThis.$262 = {};

  globalThis.addEventListener("message", (evt) => {
    const { script, lock } = evt.data;

    Atomics.store(lock, 0, 1);
    Atomics.notify(lock, 0, 1);

    const err = Deno.core.evalContext(script)[1];
    if (err !== null) {
      throw err.thrown;
    }
  });
})();

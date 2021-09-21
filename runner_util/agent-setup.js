(() => {
  const { Deno } = globalThis;
  delete globalThis.Deno;
  delete globalThis.console;
  delete globalThis.URL;

  let broadcastListener = null;

  globalThis.$262 = {
    agent: {
      receiveBroadcast(callback) {
        broadcastListener = callback;
      },
    },
  };

  globalThis.addEventListener("message", (evt) => {
    if (evt.data.type === "start") {
      const { script, lock } = evt.data;

      Atomics.store(lock, 0, 1);
      Atomics.notify(lock, 0, 1);

      const err = Deno.core.evalContext(script)[1];
      if (err !== null) {
        throw err.thrown;
      }
    } else if (evt.data.type === "broadcast") {
      const { semaphore, sab, number } = evt.data;

      Atomics.add(semaphore, 0, 1);
      Atomics.notify(semaphore, 0, 1);

      broadcastListener(sab, number);
    } else {
      throw new Error(`Unkwnown message received: ${evt.data.type}`);
    }
  });
})();

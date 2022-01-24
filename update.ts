const failedTests = (await Deno.readTextFile("./what")).split("\n").filter(
  (a) => a !== "",
);

const expectations = JSON.parse(await Deno.readTextFile("./expectations.json"));

for (const failedTest of failedTests) {
  const segments = failedTest.split("/");

  let node = expectations;
  for (const segment of segments.slice(0, -1)) {
    if (!Object.hasOwn(node, segment)) {
      node[segment] = {};
    }
    node = node[segment];
  }

  node[segments.at(-1)!] = false;
}

await Deno.writeTextFile(
  "./expectations.json",
  JSON.stringify(expectations, null, 2),
);

import { readFile } from "node:fs/promises";

// AgentLens never renders script tags or preinitializes external JavaScript.
// Remove these unused React DOM capabilities rather than disguising scanner matches.
// Fail closed if a React upgrade changes the audited implementation.
export function restrictReactScripts(source) {
  let calls = 0;
  source = source.replace(/(?:ownerDocument|hoistableRoot)\.createElement\("script"\)/g, () => {
    calls++;
    return 'agentlensDenyScript()';
  });
  const inert = /nextResource = ownerDocument\.createElement\("div"\);\s*nextResource\.innerHTML = "<script>\\x3c\/script>";\s*nextResource = nextResource\.removeChild\(\s*nextResource\.firstChild\s*\);/;
  if (calls !== 3 || !inert.test(source)) throw new Error("React DOM changed: audit script capability restrictions before upgrading.");
  source = source.replace(inert, 'nextResource = agentlensDenyScript();');
  return 'function agentlensDenyScript() { throw new Error("AgentLens does not support runtime script elements."); }\n' + source;
}

export const reactNoScripts = {
  name: "agentlens-no-runtime-scripts",
  setup(build) {
    build.onLoad({ filter: /react-dom-client\.production\.js$/ }, async ({ path }) => ({
      contents: restrictReactScripts(await readFile(path, "utf8")), loader: "js"
    }));
  }
};

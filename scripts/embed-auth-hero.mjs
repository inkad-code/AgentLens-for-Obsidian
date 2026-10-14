import { readFile, writeFile } from "node:fs/promises";

/** Keep the original design image in portable CSS rather than the mobile JS bundle. */
export async function embedAuthHero() {
  const image = await readFile(new URL("../src/ui/workbench/assets/auth-hero.png", import.meta.url));
  const stylesheet = new URL("../styles.css", import.meta.url);
  const current = await readFile(stylesheet, "utf8");
  const block = `/* BEGIN GENERATED AUTH HERO: src/ui/workbench/assets/auth-hero.png */\n.agentlens-auth-hero { background-image: url("data:image/png;base64,${image.toString("base64")}"); }\n/* END GENERATED AUTH HERO */`;
  const pattern = /\/\* BEGIN GENERATED AUTH HERO:[\s\S]*?\/\* END GENERATED AUTH HERO \*\//;
  const next = pattern.test(current) ? current.replace(pattern, block) : `${current}\n${block}\n`;
  if (next !== current) await writeFile(stylesheet, next);
}

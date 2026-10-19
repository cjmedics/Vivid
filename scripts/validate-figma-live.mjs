import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
let temporary;
try {
  if (!process.env.FIGMA_ACCESS_TOKEN?.trim()) throw new Error("Save the FIGMA_ACCESS_TOKEN repository secret before starting live validation.");
  const token = process.env.FIGMA_ACCESS_TOKEN.trim();
  if (token !== process.env.FIGMA_ACCESS_TOKEN) console.log("Removed surrounding whitespace from the saved token before use.");
  const frame = new URL(process.env.FIGMA_FRAME_URL ?? "");
  if (frame.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(frame.hostname) || !/^\/(design|file)\/[^/]+/.test(frame.pathname) || !frame.searchParams.get("node-id")) {
    throw new Error("Set FIGMA_FRAME_URL to a Figma frame link with node-id.");
  }
  temporary = mkdtempSync(resolve(tmpdir(), "vivid-live-"));
  const briefPath = resolve(temporary, "brief.json");
  writeFileSync(briefPath, JSON.stringify({ productName: "Import validation", description: "Validation of an authorized Figma frame.", category: "Design", headline: "Your design in motion", subtext: "Live import validation", cta: "Explore the design" }));
  const output = resolve(temporary, "production");
  const created = spawnSync(process.execPath, ["--import", "tsx", "apps/create/src/main.ts", "--figma", frame.href, "--brand", "fixtures/design.brand.json", "--brief", briefPath, "--planner", "rules", "--out", output, "--render"], {
    cwd: root, env: { ...process.env, FIGMA_ACCESS_TOKEN: token }, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024,
  });
  // Never forward renderer output, node names, URLs, tokens, or provider responses to public logs.
  if (created.error || created.status !== 0) {
    const detail = created.stderr ?? "";
    const diagnostic = detail.match(/Figma diagnostic: HTTP (\d{3}); stage=(nodes|export); reason=(invalid-token|expired-token|scope|file-access|unspecified)\./);
    if (diagnostic) console.log(`Figma API diagnostic: HTTP ${diagnostic[1]}; stage=${diagnostic[2]}; reason=${diagnostic[3]}.`);
    if (detail.includes("Figma access denied.")) throw new Error("Figma denied access. Check the token, file_content:read scope, and access to the selected file.");
    if (detail.includes("Figma rate limit reached.")) throw new Error("Figma API quota reached. Wait for the provider quota reset before another attempt.");
    throw new Error("Live import or render failed. No raw design data or process logs were published.");
  }
  const manifest = JSON.parse(readFileSync(resolve(output, "production.json"), "utf8"));
  if (manifest.inputMode !== "live-figma" || manifest.status !== "rendered") throw new Error("Live import did not produce a completed render.");
  const verified = spawnSync(process.execPath, ["scripts/verify-video.mjs", resolve(output, "render-props.json"), resolve(output, "video.mp4"), resolve(output, "probe.json")], {
    cwd: root, stdio: "ignore", timeout: 120000,
  });
  if (verified.error || verified.status !== 0) throw new Error("MP4 metadata or full-frame decode verification failed.");
  const probe = JSON.parse(readFileSync(resolve(output, "probe.json"), "utf8"));
  const stream = probe.streams[0];
  // Only numeric media metadata is logged. All design assets remain temporary.
  console.log(`Live Figma import and H.264 render passed: ${Number(stream.width)}x${Number(stream.height)}, ${Number(stream.nb_read_frames)} frames, ${Number(probe.format.duration)} seconds. Full decode passed.`);
} catch (error) {
  // URL parsing can include user input in its error; do not forward that exception.
  console.error(error?.code === "ERR_INVALID_URL" ? "Set FIGMA_FRAME_URL to a valid Figma frame link." : error.message);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}

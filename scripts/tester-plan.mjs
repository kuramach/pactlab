#!/usr/bin/env node
// Daily tester plan generator (T-151). Reads git and GitHub state; writes only docs/testing/plans/YYYY-MM-DD.md
// (and the .watermark beside it). Usage: node scripts/tester-plan.mjs [YYYY-MM-DD]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "docs/testing");
const plansDir = join(dir, "plans");
const watermarkFile = join(plansDir, ".watermark");

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryRun = (cmd, args) => { try { return run(cmd, args); } catch { return null; } };

const arg = process.argv[2];
if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) { console.error("usage: tester-plan.mjs [YYYY-MM-DD]"); process.exit(2); }
const date = arg ?? new Date().toISOString().slice(0, 10);
const day = new Date(`${date}T00:00:00Z`);
const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day.getUTCDay()];

// --- what changed
const mainRef = tryRun("git", ["rev-parse", "--verify", "-q", "origin/main"]) ? "origin/main" : "main";
const head = run("git", ["rev-parse", "--short", mainRef]);
const watermark = existsSync(watermarkFile) ? readFileSync(watermarkFile, "utf8").trim() : "";
const since = watermark && tryRun("git", ["cat-file", "-e", `${watermark}^{commit}`]) !== null ? [`${watermark}..${mainRef}`] : [mainRef, "--since=24 hours ago"];
const log = run("git", ["log", "--first-parent", "--merges", "--format=%h%x09%cs%x09%s", ...since]);
const merges = log ? log.split("\n").map((l) => l.split("\t")) : [];
const prTitle = (n) => tryRun("gh", ["pr", "view", n, "--json", "title", "--jq", ".title"]);
const changed = merges.length
  ? merges.map(([sha, d, subject]) => {
      const n = /#(\d+)/.exec(subject)?.[1];
      const title = (n && prTitle(n)) || subject.replace(/^Merge pull request #\d+ from \S+/, "").trim() || subject;
      return `- [ ] ${n ? `PR #${n}` : sha} (${d}, \`${sha}\`): ${title}. On dev, exercise the changed behaviour and one neighbouring path; note anything the automated suite would not see.`;
    }).join("\n")
  : "- No merges since the last plan. Re-run any section 2 check that failed yesterday, then spend the time on section 3.";

// --- rotation
const packs = readFileSync(join(dir, "pack-rotation.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const isoWeek = Math.floor((day.getTime() / 86400000 + 3) / 7); // weeks since a Monday epoch
const pack = (offset) => packs[(2 * isoWeek + offset) % packs.length];
const packWalk = (p, label) => `Deep-dive the **${p}** pack (${label}). Walk it end to end on dev: create a pact, import its evidence, review findings and citations, run the valuation scenario, open the pack's report. Check empty, error and stale states, and that every finding resolves to a source citation.`;
const rotations = {
  1: ["Core platform", "Sign-up and sign-in, organizations and roles, pact creation, evidence upload, findings review and approval, valuation scenarios, reports and exports, search and list pagination, audit trail visibility."],
  2: [`Pack deep-dive A: ${pack(0)}`, packWalk(pack(0), "A")],
  3: ["Money path: bridge, personas, confidentiality walls", "Walk the bridge from findings to valuation to proposed terms as each buyer persona. Confirm numbers are consistent across screens and exports. Confirm the confidentiality walls: a target contributor, guest or rival bidder must never see buyer-only findings, valuation or negotiation terms. Any leak is S1. Stripe test mode and BoldSign sandbox recipients only."],
  4: [`Pack deep-dive B: ${pack(1)} and integrations`, `${packWalk(pack(1), "B")}\n\nThen one integration walk-through in sandbox or fixture mode: connect, test the connection, import, disconnect. Confirm failures read clearly and nothing is left half-connected.`],
  5: ["Retest sweep, cross-browser and mobile, free-range", "Finish section 5 first. Then repeat the smoke path in Firefox and Safari and on a phone-sized viewport; look for layout breaks, unreachable controls and broken uploads. Spend the rest on a free-range charter: whatever worried you most this week."],
};
const [focus, rotation] = rotations[day.getUTCDay()] ?? ["Weekend: no scheduled plan", "Nothing scheduled. If you are testing anyway, use the Monday focus."];

// --- retests
const issues = tryRun("gh", ["issue", "list", "--label", "tester-bug", "--state", "closed", "--limit", "100", "--json", "number,title,labels,url"]);
let retests = "- Could not read GitHub issues (is `gh` signed in?). Check closed `tester-bug` issues without `retest-passed` by hand.";
if (issues !== null) {
  const open = JSON.parse(issues).filter((i) => !i.labels.some((l) => l.name === "retest-passed"));
  retests = open.length ? open.map((i) => `- [ ] #${i.number} ${i.title} (${i.url}): repeat the original steps on dev; expect the fix.`).join("\n") : "- No fixed bugs waiting for a retest.";
}

// --- charters
const generic = [
  "Try to break the main flow of today's focus area with unexpected input: empty, very long, special characters, pasted formatting.",
  "Go back, refresh and open in a second tab mid-flow; check state stays consistent.",
];
const digestFile = join(dir, "triage-digest/latest.md");
const digest = existsSync(digestFile)
  ? readFileSync(digestFile, "utf8").split("\n").filter((l) => /^(#{2,3}|[-*]) /.test(l)).map((l) => l.replace(/^(#{2,3}|[-*]) /, "").trim()).filter(Boolean).slice(0, 5)
  : [];
const charters = [...digest.map((c) => `- [ ] Live-error cluster: ${c}. Explore what could trigger it on dev; note any reproduction.`), ...generic.map((c) => `- [ ] ${c}`)].join("\n");

// --- fill
mkdirSync(plansDir, { recursive: true });
const values = { DATE: date, WEEKDAY: weekday, FOCUS: focus, GENERATED_AT: new Date().toISOString(), HEAD: head, WHAT_CHANGED: changed, ROTATION: rotation, CHARTERS: charters, RETESTS: retests };
const out = readFileSync(join(dir, "daily-plan.template.md"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);
writeFileSync(join(plansDir, `${date}.md`), out);
writeFileSync(watermarkFile, `${run("git", ["rev-parse", mainRef])}\n`);
console.log(`wrote docs/testing/plans/${date}.md (${merges.length} merges, focus: ${focus})`);

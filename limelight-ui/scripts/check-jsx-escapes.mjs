/* A \uXXXX escape is only an escape inside a string or template literal. Sitting
   in JSX text it is eight literal characters on the screen, which is how
   "Bar 0·4" and "4 rooms · 3" reached the UI.

   Scanning needs a stack rather than a single quote flag: a template literal can
   hold ${ } whose expression can hold another template, and a scanner that
   closes on the first backtick it meets reports the outer template's contents
   as bare text. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["app", "components", "lib"];
const bad = [];

function blankStrings(src) {
  const out = [];
  const stack = [];
  const top = () => stack[stack.length - 1];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const state = top();

    if (state === '"' || state === "'" || state === "`") {
      if (c === "\\") { out.push(" ", " "); i++; continue; }
      if (c === state) { stack.pop(); out.push(" "); continue; }
      if (state === "`" && c === "$" && src[i + 1] === "{") {
        stack.push("${"); out.push(" ", " "); i++; continue;
      }
      out.push(c === "\n" ? "\n" : " ");
      continue;
    }

    if (c === '"' || c === "'" || c === "`") { stack.push(c); out.push(" "); continue; }
    if (state === "${" && c === "}") { stack.pop(); out.push(" "); continue; }
    if (state === "${" && c === "{") { stack.push("${"); out.push(" "); continue; }
    out.push(c);
  }
  return out.join("");
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules" && name !== ".next") walk(p);
      continue;
    }
    if (!/\.tsx$/.test(name)) continue;
    const src = readFileSync(p, "utf8");
    const lines = src.split("\n");
    blankStrings(src).split("\n").forEach((line, i) => {
      if (/\\u[0-9a-fA-F]{4}/.test(line)) {
        bad.push(`${p}:${i + 1}  ${(lines[i] ?? "").trim().slice(0, 78)}`);
      }
    });
  }
}

for (const r of roots) walk(r);

if (bad.length) {
  console.error("\\uXXXX outside a string literal renders as literal text:\n");
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log("ok: no \\uXXXX in JSX text");

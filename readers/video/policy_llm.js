// Not written yet. Present so edit.js fails with a sentence rather than a stack
// trace, and so the policy list has one obvious place to grow.
"use strict";
function run() {
  throw new Error("policy_llm is not implemented yet -- use --policy rules or naive");
}
module.exports = { run: run, id: "llm", label: "LLM-authored creative intent" };

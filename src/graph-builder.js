/**
 * Transform analyzer output into USER FLOWS.
 * Instead of abstract call-graphs, we trace what happens
 * step-by-step when a user triggers each entry point.
 */

function buildGraph(analysisResult) {
  const { files, functions, calls } = analysisResult;

  // Build lookup maps
  const fnMap = {};
  for (const fn of functions) {
    fnMap[fn.id] = fn;
  }

  // Build call adjacency: fnId -> [{ targetId, callName }]
  const callAdj = {};
  for (const c of calls) {
    if (!c.resolvedTo) continue;
    if (!callAdj[c.from]) callAdj[c.from] = [];
    // Deduplicate within same function
    if (!callAdj[c.from].some((e) => e.targetId === c.resolvedTo)) {
      callAdj[c.from].push({ targetId: c.resolvedTo, crossFile: c.crossFile });
    }
  }

  // Find entry points: exported functions, or functions not called by anything
  const calledIds = new Set(calls.filter((c) => c.resolvedTo).map((c) => c.resolvedTo));
  const entryPoints = functions.filter(
    (fn) => fn.exported || !calledIds.has(fn.id)
  );

  // Build flows: for each entry point, trace the full chain
  const flows = [];
  for (const entry of entryPoints) {
    const flow = traceFlow(entry.id, fnMap, callAdj);
    if (flow.steps.length > 0) {
      flows.push(flow);
    }
  }

  // Sort: longest flows first (most interesting)
  flows.sort((a, b) => b.steps.length - a.steps.length);

  return {
    flows,
    stats: {
      totalFiles: files.length,
      totalFunctions: functions.length,
      totalFlows: flows.length,
      totalSteps: flows.reduce((s, f) => s + f.steps.length, 0),
    },
  };
}

/**
 * Trace a single user flow from an entry point.
 * Returns a tree of steps (linear + branches for conditionals).
 */
function traceFlow(entryId, fnMap, callAdj, visited = new Set()) {
  const fn = fnMap[entryId];
  if (!fn) return { id: entryId, label: "?", steps: [] };

  visited.add(entryId);

  const steps = [];

  // Add the entry point as step 0
  steps.push({
    id: fn.id,
    label: fn.name,
    file: fn.filePath,
    type: categorizeFunction(fn),
    icon: iconForFunction(fn),
    params: fn.params,
    async: fn.async,
    exported: fn.exported,
    controlFlow: fn.controlFlow,
    depth: 0,
  });

  // Walk the call chain
  walkCalls(entryId, fnMap, callAdj, steps, visited, 1);

  return {
    id: fn.id,
    label: humanizeFlowName(fn.name),
    entryPoint: fn.name,
    file: fn.filePath,
    steps,
  };
}

function walkCalls(fnId, fnMap, callAdj, steps, visited, depth) {
  const targets = callAdj[fnId] || [];

  for (const { targetId, crossFile } of targets) {
    if (visited.has(targetId)) continue;
    visited.add(targetId);

    const targetFn = fnMap[targetId];
    if (!targetFn) continue;

    steps.push({
      id: targetFn.id,
      label: targetFn.name,
      file: targetFn.filePath,
      type: categorizeFunction(targetFn),
      icon: iconForFunction(targetFn),
      params: targetFn.params,
      async: targetFn.async,
      crossFile,
      controlFlow: targetFn.controlFlow,
      depth,
    });

    // Recurse into this function's calls
    walkCalls(targetId, fnMap, callAdj, steps, visited, depth + 1);
  }
}

/**
 * Categorize a function by what it DOES for the user.
 */
function categorizeFunction(fn) {
  const name = fn.name.toLowerCase();

  if (/^handle|^on[A-Z]|^route|^endpoint|^api/.test(fn.name)) return "endpoint";
  if (/valid|check|verify|assert|ensure/.test(name)) return "validation";
  if (/auth|login|logout|register|signup|signin/.test(name)) return "auth";
  if (/find|get|fetch|load|read|query|list|search/.test(name)) return "data-read";
  if (/save|create|insert|write|update|delete|remove|destroy/.test(name)) return "data-write";
  if (/hash|encrypt|decrypt|token|secret|sign/.test(name)) return "security";
  if (/format|transform|convert|parse|serialize|sanitize|clean/.test(name)) return "transform";
  if (/send|emit|notify|email|push|dispatch/.test(name)) return "output";
  if (/session|cookie|cache|store/.test(name)) return "session";
  if (/log|track|analytics|metric/.test(name)) return "logging";
  if (/error|fail|throw/.test(name)) return "error";
  if (/config|setup|init|connect/.test(name)) return "setup";

  return "logic";
}

/**
 * Emoji icon per category — instant visual scanning.
 */
function iconForFunction(fn) {
  const type = categorizeFunction(fn);
  const icons = {
    endpoint: "\u{1F310}",    // 🌐
    validation: "\u{2705}",   // ✅
    auth: "\u{1F512}",        // 🔒
    "data-read": "\u{1F4D6}", // 📖
    "data-write": "\u{1F4BE}",// 💾
    security: "\u{1F6E1}",    // 🛡️
    transform: "\u{1F504}",   // 🔄
    output: "\u{1F4E4}",      // 📤
    session: "\u{1F4AC}",     // 💬 - session/state
    logging: "\u{1F4CA}",     // 📊
    error: "\u{26A0}",        // ⚠️
    setup: "\u{2699}",        // ⚙️
    logic: "\u{1F9E9}",       // 🧩
  };
  return icons[type] || "\u{1F9E9}";
}

/**
 * Turn function names into human-readable flow names.
 * handleLogin → "Login"
 * handleGetProfile → "Get Profile"
 */
function humanizeFlowName(name) {
  // Remove common prefixes
  let clean = name
    .replace(/^handle/, "")
    .replace(/^on/, "")
    .replace(/^api/, "")
    .replace(/^route/, "");

  // camelCase → words
  clean = clean.replace(/([A-Z])/g, " $1").trim();

  // Capitalize first letter
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function computeComplexity(controlFlow) {
  if (!controlFlow || controlFlow.length === 0) return 1;
  let complexity = 1;
  for (const node of controlFlow) {
    switch (node.type) {
      case "condition":
        complexity++;
        for (const branch of node.branches || []) {
          complexity += computeComplexity(branch.flow) - 1;
        }
        break;
      case "loop":
        complexity++;
        complexity += computeComplexity(node.flow) - 1;
        break;
      case "switch":
        complexity += (node.cases?.length || 1) - 1;
        for (const c of node.cases || []) {
          complexity += computeComplexity(c.flow) - 1;
        }
        break;
      case "try-catch":
        complexity++;
        complexity += computeComplexity(node.tryFlow) - 1;
        complexity += computeComplexity(node.catchFlow) - 1;
        break;
    }
  }
  return complexity;
}

module.exports = { buildGraph, computeComplexity };

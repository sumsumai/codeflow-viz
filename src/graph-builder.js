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
    description: describeFunction(fn),
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
      description: describeFunction(targetFn),
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
 * Emoji icon per category.
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
    session: "\u{1F4AC}",     // 💬
    logging: "\u{1F4CA}",     // 📊
    error: "\u{26A0}",        // ⚠️
    setup: "\u{2699}",        // ⚙️
    logic: "\u{1F9E9}",       // 🧩
  };
  return icons[type] || "\u{1F9E9}";
}

/**
 * Generate a plain-English description of what a function does.
 * This is what a non-technical person sees.
 */
function describeFunction(fn) {
  const name = fn.name.toLowerCase();
  const type = categorizeFunction(fn);

  // Try specific pattern matches first
  if (/^handle/.test(fn.name) || /^on[A-Z]/.test(fn.name)) {
    const action = humanizeFlowName(fn.name);
    return `Start the ${action.toLowerCase()} process`;
  }

  // Auth patterns
  if (/^login$/i.test(fn.name)) return "Verify credentials and sign the user in";
  if (/^logout$/i.test(fn.name)) return "Sign the user out";
  if (/^register$/i.test(fn.name) || /^signup$/i.test(fn.name)) return "Create a new user account";
  if (/^signin$/i.test(fn.name)) return "Sign the user in";

  // Validation
  if (/validateemail/i.test(fn.name)) return "Check if the email address is valid";
  if (/validate/i.test(fn.name)) return "Check if the input is valid";
  if (/verifypassword/i.test(fn.name)) return "Check if the password is correct";
  if (/verify/i.test(fn.name)) return "Verify the data is correct";
  if (/check/i.test(fn.name)) return "Run a check on the data";

  // Data operations
  if (/finduserbyemail/i.test(fn.name)) return "Look up the user by their email";
  if (/finduserbyid/i.test(fn.name)) return "Look up the user by their ID";
  if (/finduser/i.test(fn.name)) return "Look up the user";
  if (/^find/i.test(fn.name)) return "Look up " + humanizeCamel(fn.name.replace(/^find/i, ""));
  if (/^get/i.test(fn.name)) return "Get " + humanizeCamel(fn.name.replace(/^get/i, ""));
  if (/^fetch/i.test(fn.name)) return "Fetch " + humanizeCamel(fn.name.replace(/^fetch/i, ""));
  if (/^load/i.test(fn.name)) return "Load " + humanizeCamel(fn.name.replace(/^load/i, ""));
  if (/^list/i.test(fn.name)) return "List all " + humanizeCamel(fn.name.replace(/^list/i, ""));
  if (/^search/i.test(fn.name)) return "Search for " + humanizeCamel(fn.name.replace(/^search/i, ""));
  if (/^query/i.test(fn.name)) return "Query " + humanizeCamel(fn.name.replace(/^query/i, ""));
  if (/^read/i.test(fn.name)) return "Read " + humanizeCamel(fn.name.replace(/^read/i, ""));

  // Write operations
  if (/^createuser$/i.test(fn.name)) return "Save the new user to the database";
  if (/^createsession$/i.test(fn.name)) return "Start a new session for the user";
  if (/^create/i.test(fn.name)) return "Create " + humanizeCamel(fn.name.replace(/^create/i, ""));
  if (/^save/i.test(fn.name)) return "Save " + humanizeCamel(fn.name.replace(/^save/i, ""));
  if (/^insert/i.test(fn.name)) return "Add " + humanizeCamel(fn.name.replace(/^insert/i, ""));
  if (/^update/i.test(fn.name)) return "Update " + humanizeCamel(fn.name.replace(/^update/i, ""));
  if (/^delete/i.test(fn.name) || /^remove/i.test(fn.name)) return "Delete " + humanizeCamel(fn.name.replace(/^(delete|remove)/i, ""));
  if (/^destroy/i.test(fn.name)) return "Remove " + humanizeCamel(fn.name.replace(/^destroy/i, ""));

  // Security
  if (/hashpassword/i.test(fn.name)) return "Securely encrypt the password";
  if (/^hash/i.test(fn.name)) return "Encrypt the data";
  if (/^encrypt/i.test(fn.name)) return "Encrypt the data";
  if (/^decrypt/i.test(fn.name)) return "Decrypt the data";

  // Transform
  if (/sanitize/i.test(fn.name)) return "Clean up the data for output";
  if (/format/i.test(fn.name)) return "Format the data for display";
  if (/transform/i.test(fn.name)) return "Transform the data";
  if (/convert/i.test(fn.name)) return "Convert the data";
  if (/parse/i.test(fn.name)) return "Parse the input";
  if (/clean/i.test(fn.name)) return "Clean up " + humanizeCamel(fn.name.replace(/^clean/i, ""));

  // Session
  if (/destroysession/i.test(fn.name)) return "End the user's session";
  if (/getsession/i.test(fn.name)) return "Check if the user is logged in";
  if (/session/i.test(fn.name)) return "Manage the user session";

  // Output
  if (/^send/i.test(fn.name)) return "Send " + humanizeCamel(fn.name.replace(/^send/i, ""));
  if (/^emit/i.test(fn.name)) return "Emit " + humanizeCamel(fn.name.replace(/^emit/i, ""));
  if (/^notify/i.test(fn.name)) return "Send a notification";

  // Generate
  if (/generateid/i.test(fn.name)) return "Generate a unique ID";
  if (/^generate/i.test(fn.name)) return "Generate " + humanizeCamel(fn.name.replace(/^generate/i, ""));

  // Fallback: humanize the function name
  return humanizeCamel(fn.name);
}

function humanizeCamel(name) {
  if (!name) return "";
  const words = name.replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Turn function names into human-readable flow names.
 */
function humanizeFlowName(name) {
  let clean = name
    .replace(/^handle/, "")
    .replace(/^on/, "")
    .replace(/^api/, "")
    .replace(/^route/, "");

  clean = clean.replace(/([A-Z])/g, " $1").trim();
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

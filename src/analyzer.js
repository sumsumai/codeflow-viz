const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const fs = require("fs");
const path = require("path");
const { glob } = require("glob");

/**
 * Analyze a directory of JS/TS files and extract the call graph + control flow.
 */
async function analyzeDirectory(targetDir, options = {}) {
  const ignore = options.ignore || [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
    "**/*.min.js",
    "**/*.bundle.js",
  ];

  const files = await glob("**/*.{js,jsx,ts,tsx,mjs,cjs}", {
    cwd: targetDir,
    ignore,
    absolute: true,
  });

  const result = {
    files: [],
    functions: [],
    calls: [],
    modules: [],
  };

  for (const filePath of files) {
    try {
      const fileResult = analyzeFile(filePath, targetDir);
      result.files.push(fileResult.file);
      result.functions.push(...fileResult.functions);
      result.calls.push(...fileResult.calls);
      result.modules.push(...fileResult.modules);
    } catch (err) {
      // Skip files that can't be parsed
      result.files.push({
        path: path.relative(targetDir, filePath),
        error: err.message,
      });
    }
  }

  // Resolve call targets across files
  resolveCrossFileCalls(result);

  return result;
}

function analyzeFile(filePath, rootDir) {
  const code = fs.readFileSync(filePath, "utf-8");
  const relativePath = path.relative(rootDir, filePath);
  const fileId = relativePath.replace(/[\/\\\.]/g, "_");

  const ast = parser.parse(code, {
    sourceType: "module",
    plugins: [
      "jsx",
      "typescript",
      "decorators-legacy",
      "classProperties",
      "optionalChaining",
      "nullishCoalescingOperator",
      "dynamicImport",
      "exportDefaultFrom",
    ],
    errorRecovery: true,
  });

  const functions = [];
  const calls = [];
  const modules = [];
  const scopeStack = [];

  function currentScope() {
    return scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null;
  }

  function makeFnId(name) {
    return `${fileId}::${name}`;
  }

  function extractControlFlow(bodyNode) {
    const flow = [];
    if (!bodyNode) return flow;

    const statements =
      bodyNode.type === "BlockStatement" ? bodyNode.body : [bodyNode];

    for (const stmt of statements) {
      switch (stmt.type) {
        case "IfStatement":
          flow.push({
            type: "condition",
            label: codeSummary(stmt.test, code),
            loc: stmt.loc,
            branches: [
              {
                label: "true",
                flow: extractControlFlow(stmt.consequent),
              },
              stmt.alternate
                ? {
                    label: "false",
                    flow: extractControlFlow(stmt.alternate),
                  }
                : null,
            ].filter(Boolean),
          });
          break;
        case "ForStatement":
        case "ForInStatement":
        case "ForOfStatement":
        case "WhileStatement":
        case "DoWhileStatement":
          flow.push({
            type: "loop",
            label: loopLabel(stmt, code),
            loc: stmt.loc,
            flow: extractControlFlow(stmt.body),
          });
          break;
        case "SwitchStatement":
          flow.push({
            type: "switch",
            label: codeSummary(stmt.discriminant, code),
            loc: stmt.loc,
            cases: stmt.cases.map((c) => ({
              label: c.test ? codeSummary(c.test, code) : "default",
              flow: extractControlFlow({ type: "BlockStatement", body: c.consequent }),
            })),
          });
          break;
        case "TryStatement":
          flow.push({
            type: "try-catch",
            loc: stmt.loc,
            tryFlow: extractControlFlow(stmt.block),
            catchFlow: stmt.handler
              ? extractControlFlow(stmt.handler.body)
              : [],
            finallyFlow: stmt.finalizer
              ? extractControlFlow(stmt.finalizer)
              : [],
          });
          break;
        case "ReturnStatement":
          flow.push({
            type: "return",
            label: stmt.argument ? codeSummary(stmt.argument, code) : "void",
            loc: stmt.loc,
          });
          break;
        case "ThrowStatement":
          flow.push({
            type: "throw",
            label: codeSummary(stmt.argument, code),
            loc: stmt.loc,
          });
          break;
        case "ExpressionStatement":
          if (
            stmt.expression.type === "CallExpression" ||
            stmt.expression.type === "AwaitExpression"
          ) {
            flow.push({
              type: "call",
              label: codeSummary(stmt.expression, code),
              loc: stmt.loc,
            });
          }
          break;
        case "VariableDeclaration":
          flow.push({
            type: "assignment",
            label: codeSummary(stmt, code),
            loc: stmt.loc,
          });
          break;
      }
    }
    return flow;
  }

  traverse(ast, {
    // Track imports for cross-file resolution
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      const specifiers = nodePath.node.specifiers.map((s) => ({
        local: s.local.name,
        imported:
          s.type === "ImportDefaultSpecifier"
            ? "default"
            : s.type === "ImportNamespaceSpecifier"
            ? "*"
            : s.imported?.name || s.local.name,
      }));
      modules.push({
        fileId,
        filePath: relativePath,
        source,
        specifiers,
        type: "import",
      });
    },

    // Require calls
    CallExpression(nodePath) {
      const node = nodePath.node;
      if (
        node.callee.name === "require" &&
        node.arguments[0]?.type === "StringLiteral"
      ) {
        // Extract destructured names: const { a, b } = require("./x")
        const specifiers = [];
        const parent = nodePath.parent;
        if (parent?.type === "VariableDeclarator") {
          if (parent.id?.type === "ObjectPattern") {
            for (const prop of parent.id.properties) {
              if (prop.type === "ObjectProperty" && prop.key?.name) {
                specifiers.push({
                  local: prop.value?.name || prop.key.name,
                  imported: prop.key.name,
                });
              }
            }
          } else if (parent.id?.type === "Identifier") {
            specifiers.push({
              local: parent.id.name,
              imported: "default",
            });
          }
        }
        modules.push({
          fileId,
          filePath: relativePath,
          source: node.arguments[0].value,
          specifiers,
          type: "require",
        });
      }

      // Track function calls
      const scope = currentScope();
      if (scope) {
        const callName = getCallName(node.callee);
        if (callName) {
          calls.push({
            from: scope,
            to: callName,
            fromFile: fileId,
            loc: node.loc,
            args: node.arguments.length,
          });
        }
      }
    },

    // Function declarations
    FunctionDeclaration: {
      enter(nodePath) {
        const node = nodePath.node;
        const name = node.id?.name || "<anonymous>";
        const fnId = makeFnId(name);
        scopeStack.push(fnId);
        const fn = {
          id: fnId,
          name,
          fileId,
          filePath: relativePath,
          type: "function",
          async: node.async,
          generator: node.generator,
          params: node.params.map((p) => paramName(p)),
          loc: node.loc,
          controlFlow: extractControlFlow(node.body),
          exported: isExported(nodePath),
        };
        functions.push(fn);
      },
      exit() {
        scopeStack.pop();
      },
    },

    // Arrow functions and function expressions assigned to variables
    VariableDeclarator: {
      enter(nodePath) {
        const node = nodePath.node;
        const init = node.init;
        if (
          init &&
          (init.type === "ArrowFunctionExpression" ||
            init.type === "FunctionExpression")
        ) {
          const name = node.id?.name || "<anonymous>";
          const fnId = makeFnId(name);
          scopeStack.push(fnId);
          const fn = {
            id: fnId,
            name,
            fileId,
            filePath: relativePath,
            type: init.type === "ArrowFunctionExpression" ? "arrow" : "function",
            async: init.async,
            generator: init.generator || false,
            params: init.params.map((p) => paramName(p)),
            loc: node.loc,
            controlFlow: extractControlFlow(init.body),
            exported: isExported(nodePath),
          };
          functions.push(fn);
        }
      },
      exit(nodePath) {
        const init = nodePath.node.init;
        if (
          init &&
          (init.type === "ArrowFunctionExpression" ||
            init.type === "FunctionExpression")
        ) {
          scopeStack.pop();
        }
      },
    },

    // Class methods
    ClassMethod: {
      enter(nodePath) {
        const node = nodePath.node;
        const className = nodePath.parent?.id?.name || "Class";
        const methodName = node.key?.name || node.key?.value || "<method>";
        const name = `${className}.${methodName}`;
        const fnId = makeFnId(name);
        scopeStack.push(fnId);
        functions.push({
          id: fnId,
          name,
          fileId,
          filePath: relativePath,
          type: "method",
          async: node.async,
          generator: node.generator,
          static: node.static,
          kind: node.kind,
          params: node.params.map((p) => paramName(p)),
          loc: node.loc,
          controlFlow: extractControlFlow(node.body),
          exported: false,
        });
      },
      exit() {
        scopeStack.pop();
      },
    },

    // Export default function
    ExportDefaultDeclaration(nodePath) {
      const decl = nodePath.node.declaration;
      if (
        decl.type === "FunctionDeclaration" ||
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        const name = decl.id?.name || "default";
        const fnId = makeFnId(name);
        // Check if already tracked
        const existing = functions.find((f) => f.id === fnId);
        if (existing) {
          existing.exported = true;
          existing.exportType = "default";
        }
      }
    },
  });

  return {
    file: { path: relativePath, id: fileId },
    functions,
    calls,
    modules,
  };
}

function getCallName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") {
    const obj =
      callee.object.type === "Identifier"
        ? callee.object.name
        : callee.object.type === "ThisExpression"
        ? "this"
        : null;
    const prop = callee.property?.name || callee.property?.value;
    if (obj && prop) return `${obj}.${prop}`;
    if (prop) return prop;
  }
  return null;
}

function paramName(param) {
  if (param.type === "Identifier") return param.name;
  if (param.type === "AssignmentPattern" && param.left?.name)
    return `${param.left.name}=`;
  if (param.type === "RestElement" && param.argument?.name)
    return `...${param.argument.name}`;
  if (param.type === "ObjectPattern") return "{...}";
  if (param.type === "ArrayPattern") return "[...]";
  return "?";
}

function codeSummary(node, code) {
  if (!node || !node.start || !node.end) return "...";
  const snippet = code.slice(node.start, node.end);
  return snippet.length > 60 ? snippet.slice(0, 57) + "..." : snippet;
}

function loopLabel(stmt, code) {
  switch (stmt.type) {
    case "ForStatement":
      return `for (${codeSummary(stmt.init, code)}; ${codeSummary(stmt.test, code)}; ...)`;
    case "ForInStatement":
      return `for (... in ${codeSummary(stmt.right, code)})`;
    case "ForOfStatement":
      return `for (... of ${codeSummary(stmt.right, code)})`;
    case "WhileStatement":
      return `while (${codeSummary(stmt.test, code)})`;
    case "DoWhileStatement":
      return `do...while (${codeSummary(stmt.test, code)})`;
    default:
      return "loop";
  }
}

function isExported(nodePath) {
  const parent = nodePath.parentPath;
  if (!parent) return false;
  return (
    parent.node.type === "ExportNamedDeclaration" ||
    parent.node.type === "ExportDefaultDeclaration" ||
    (parent.node.type === "VariableDeclaration" &&
      parent.parentPath?.node?.type === "ExportNamedDeclaration")
  );
}

function resolveCrossFileCalls(result) {
  // Build a map of exported function names per file
  const exportMap = {};
  for (const fn of result.functions) {
    if (fn.exported) {
      if (!exportMap[fn.fileId]) exportMap[fn.fileId] = {};
      exportMap[fn.fileId][fn.name] = fn.id;
    }
  }

  // Build a map of imports: fileId -> { localName: { sourceFileId, importedName } }
  const importMap = {};
  for (const mod of result.modules) {
    const sourceFile = resolveModuleToFile(mod.source, mod.filePath, result.files);
    if (!sourceFile) continue;

    if (!importMap[mod.fileId]) importMap[mod.fileId] = {};
    for (const spec of mod.specifiers) {
      importMap[mod.fileId][spec.local] = {
        sourceFileId: sourceFile.id,
        importedName: spec.imported,
      };
    }
  }

  // Resolve call targets
  for (const call of result.calls) {
    const callName = call.to;
    const fileImports = importMap[call.fromFile] || {};

    // Check if this call is to an imported name
    const baseName = callName.split(".")[0];
    if (fileImports[baseName]) {
      const imp = fileImports[baseName];
      const targetExports = exportMap[imp.sourceFileId] || {};

      // Try to find the actual function
      const methodPart = callName.includes(".") ? callName.split(".").slice(1).join(".") : null;
      const lookupName = methodPart || imp.importedName;

      for (const fn of result.functions) {
        if (fn.fileId === imp.sourceFileId && (fn.name === lookupName || fn.name === callName)) {
          call.resolvedTo = fn.id;
          call.crossFile = true;
          break;
        }
      }
    }

    // Try same-file resolution
    if (!call.resolvedTo) {
      for (const fn of result.functions) {
        if (fn.fileId === call.fromFile && fn.name === callName) {
          call.resolvedTo = fn.id;
          break;
        }
      }
    }
  }
}

function resolveModuleToFile(source, fromFile, files) {
  if (source.startsWith(".")) {
    const fromDir = path.dirname(fromFile);
    const resolved = path.join(fromDir, source);
    // Try exact match and common extensions
    const candidates = [
      resolved,
      resolved + ".js",
      resolved + ".ts",
      resolved + ".jsx",
      resolved + ".tsx",
      resolved + "/index.js",
      resolved + "/index.ts",
    ];
    for (const candidate of candidates) {
      const normalized = candidate.replace(/\\/g, "/");
      const match = files.find(
        (f) => f.path === normalized || f.path === normalized.replace(/^\.\//, "")
      );
      if (match) return match;
    }
  }
  return null;
}

module.exports = { analyzeDirectory, analyzeFile };

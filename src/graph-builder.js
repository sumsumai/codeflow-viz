/**
 * Transform analyzer output into a graph structure for the frontend.
 * Two levels: file-level overview and function-level detail.
 */

function buildGraph(analysisResult) {
  const { files, functions, calls, modules } = analysisResult;

  // Group functions by file
  const fileGroups = {};
  for (const fn of functions) {
    if (!fileGroups[fn.fileId]) {
      const fileInfo = files.find((f) => f.id === fn.fileId);
      fileGroups[fn.fileId] = {
        id: fn.fileId,
        path: fileInfo?.path || fn.filePath,
        functions: [],
      };
    }
    fileGroups[fn.fileId].functions.push(fn);
  }

  // Build the top-level graph (functions as nodes, calls as edges)
  const nodes = functions.map((fn) => ({
    id: fn.id,
    label: fn.name,
    file: fn.filePath,
    fileId: fn.fileId,
    type: fn.type,
    async: fn.async,
    exported: fn.exported,
    params: fn.params,
    loc: fn.loc,
    controlFlow: fn.controlFlow,
    // Compute metrics
    complexity: computeComplexity(fn.controlFlow),
    callCount: calls.filter((c) => c.from === fn.id).length,
    calledByCount: calls.filter(
      (c) => c.resolvedTo === fn.id
    ).length,
  }));

  const edges = calls
    .filter((c) => c.resolvedTo)
    .map((c, i) => ({
      id: `edge_${i}`,
      source: c.from,
      target: c.resolvedTo,
      crossFile: c.crossFile || false,
    }));

  // Deduplicate edges (keep count)
  const edgeMap = {};
  for (const edge of edges) {
    const key = `${edge.source}::${edge.target}`;
    if (!edgeMap[key]) {
      edgeMap[key] = { ...edge, weight: 1 };
    } else {
      edgeMap[key].weight++;
    }
  }

  // Build file-level overview (files as nodes, imports as edges)
  const fileNodes = Object.values(fileGroups).map((fg) => ({
    id: fg.id,
    label: fg.path,
    functionCount: fg.functions.length,
    exportedCount: fg.functions.filter((f) => f.exported).length,
    totalComplexity: fg.functions.reduce(
      (sum, f) => sum + computeComplexity(f.controlFlow),
      0
    ),
  }));

  const fileEdges = [];
  const fileEdgeSet = new Set();
  for (const edge of Object.values(edgeMap)) {
    const sourceFile = functions.find((f) => f.id === edge.source)?.fileId;
    const targetFile = functions.find((f) => f.id === edge.target)?.fileId;
    if (sourceFile && targetFile && sourceFile !== targetFile) {
      const key = `${sourceFile}::${targetFile}`;
      if (!fileEdgeSet.has(key)) {
        fileEdgeSet.add(key);
        fileEdges.push({
          id: `file_edge_${fileEdges.length}`,
          source: sourceFile,
          target: targetFile,
        });
      }
    }
  }

  return {
    overview: {
      nodes: fileNodes,
      edges: fileEdges,
    },
    detail: {
      nodes,
      edges: Object.values(edgeMap),
      fileGroups: Object.values(fileGroups),
    },
    stats: {
      totalFiles: files.length,
      totalFunctions: functions.length,
      totalCalls: calls.length,
      resolvedCalls: calls.filter((c) => c.resolvedTo).length,
      unresolvedCalls: calls.filter((c) => !c.resolvedTo).length,
      crossFileCalls: calls.filter((c) => c.crossFile).length,
    },
  };
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

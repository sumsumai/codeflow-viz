(function () {
  "use strict";

  // ─── State ───
  let graphData = null;
  let currentView = "files"; // "files" | "functions"
  let selectedNode = null;
  let hoveredNode = null;
  let nodes = [];
  let edges = [];

  // Camera
  let cam = { x: 0, y: 0, zoom: 1 };
  let drag = { active: false, startX: 0, startY: 0, startCamX: 0, startCamY: 0 };
  let nodeDrag = { active: false, node: null, offsetX: 0, offsetY: 0 };

  // Canvas
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const minimapCanvas = document.getElementById("minimap-canvas");
  const minimapCtx = minimapCanvas.getContext("2d");

  // Layout constants
  const NODE_W = 220;
  const NODE_H = 56;
  const FILE_NODE_W = 240;
  const FILE_NODE_H = 72;
  const NODE_PADDING = 40;

  // Colors per file (generated)
  const fileColors = {};
  const palette = [
    "#58a6ff", "#3fb950", "#d29922", "#f85149",
    "#bc8cff", "#56d4dd", "#f778ba", "#79c0ff",
    "#7ee787", "#e3b341", "#ff7b72", "#d2a8ff",
  ];
  let colorIndex = 0;

  function getFileColor(fileId) {
    if (!fileColors[fileId]) {
      fileColors[fileId] = palette[colorIndex % palette.length];
      colorIndex++;
    }
    return fileColors[fileId];
  }

  // ─── Init ───
  function init() {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    setupInteraction();
    setupToolbar();
    loadData();
  }

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    minimapCanvas.width = 180 * devicePixelRatio;
    minimapCanvas.height = 120 * devicePixelRatio;
    minimapCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    render();
  }

  // ─── Data Loading ───
  async function loadData() {
    showLoading(true);
    try {
      const res = await fetch("/api/graph");
      graphData = await res.json();
      updateStats();
      setView(currentView);
      showLoading(false);
    } catch (err) {
      console.error("Failed to load graph:", err);
      showLoading(false);
    }
  }

  async function refreshData() {
    showLoading(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      graphData = await res.json();
      updateStats();
      setView(currentView);
      showLoading(false);
    } catch (err) {
      console.error("Refresh failed:", err);
      showLoading(false);
    }
  }

  function showLoading(show) {
    document.getElementById("loading").classList.toggle("hidden", !show);
  }

  function updateStats() {
    if (!graphData) return;
    const s = graphData.stats;
    document.getElementById("stats").innerHTML =
      `<span>${s.totalFiles} files</span> | ` +
      `<span>${s.totalFunctions} functions</span> | ` +
      `<span>${s.resolvedCalls} connections</span>`;
  }

  // ─── View Management ───
  function setView(view) {
    currentView = view;
    document.querySelectorAll(".toggle-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
    selectedNode = null;
    closeDetailPanel();

    if (view === "files") {
      buildFileNodes();
    } else {
      buildFunctionNodes();
    }

    layoutNodes();
    fitToScreen();
    render();
  }

  function buildFileNodes() {
    if (!graphData) return;
    const data = graphData.overview;
    nodes = data.nodes.map((n, i) => ({
      ...n,
      x: 0,
      y: 0,
      w: FILE_NODE_W,
      h: FILE_NODE_H,
      color: getFileColor(n.id),
      _type: "file",
    }));
    edges = data.edges.map((e) => ({
      ...e,
      _type: "file",
    }));
  }

  function buildFunctionNodes() {
    if (!graphData) return;
    const data = graphData.detail;
    nodes = data.nodes.map((n) => ({
      ...n,
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
      color: getFileColor(n.fileId),
      _type: "function",
    }));
    edges = data.edges.map((e) => ({
      ...e,
      _type: "function",
    }));
  }

  // ─── Layout (force-directed simplified) ───
  function layoutNodes() {
    if (nodes.length === 0) return;

    // Build adjacency for hierarchy detection
    const outgoing = {};
    const incoming = {};
    for (const e of edges) {
      if (!outgoing[e.source]) outgoing[e.source] = [];
      outgoing[e.source].push(e.target);
      if (!incoming[e.target]) incoming[e.target] = [];
      incoming[e.target].push(e.source);
    }

    // Find roots (nodes with no incoming edges)
    const roots = nodes.filter((n) => !incoming[n.id] || incoming[n.id].length === 0);

    // BFS to assign layers
    const layers = {};
    const visited = new Set();
    let queue = roots.map((n) => ({ id: n.id, layer: 0 }));
    if (queue.length === 0 && nodes.length > 0) {
      queue = [{ id: nodes[0].id, layer: 0 }];
    }

    while (queue.length > 0) {
      const { id, layer } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      layers[id] = layer;
      for (const target of outgoing[id] || []) {
        if (!visited.has(target)) {
          queue.push({ id: target, layer: layer + 1 });
        }
      }
    }

    // Assign layers to unvisited nodes
    for (const n of nodes) {
      if (!visited.has(n.id)) {
        layers[n.id] = 0;
      }
    }

    // Group by layer, then sort within each layer by file
    const layerGroups = {};
    for (const n of nodes) {
      const l = layers[n.id] || 0;
      if (!layerGroups[l]) layerGroups[l] = [];
      layerGroups[l].push(n);
    }

    const layerKeys = Object.keys(layerGroups).map(Number).sort((a, b) => a - b);
    const spacingX = (nodes[0]?.w || NODE_W) + NODE_PADDING;
    const spacingY = (nodes[0]?.h || NODE_H) + NODE_PADDING * 2;

    for (const layerKey of layerKeys) {
      const group = layerGroups[layerKey];
      // Sort by fileId for grouping
      group.sort((a, b) => (a.fileId || a.id).localeCompare(b.fileId || b.id));
      const totalWidth = group.length * spacingX;
      const startX = -totalWidth / 2;
      group.forEach((n, i) => {
        n.x = startX + i * spacingX;
        n.y = layerKey * spacingY;
      });
    }
  }

  function fitToScreen() {
    if (nodes.length === 0) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const bounds = getNodeBounds();
    const padding = 80;
    const contentW = bounds.maxX - bounds.minX + padding * 2;
    const contentH = bounds.maxY - bounds.minY + padding * 2;
    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    cam.zoom = Math.min(scaleX, scaleY, 1.5);
    cam.x = -(bounds.minX + bounds.maxX) / 2;
    cam.y = -(bounds.minY + bounds.maxY) / 2;
  }

  function getNodeBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    return { minX, minY, maxX, maxY };
  }

  // ─── Rendering ───
  function render() {
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;

    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // Apply camera transform
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(cam.x, cam.y);

    // Draw edges
    drawEdges();

    // Draw nodes
    for (const node of nodes) {
      drawNode(node);
    }

    ctx.restore();

    // Draw minimap
    drawMinimap(w, h);

    // Draw tooltip
    if (hoveredNode && !nodeDrag.active) {
      drawTooltip(hoveredNode);
    }

    requestAnimationFrame(render);
  }

  function drawEdges() {
    for (const edge of edges) {
      const source = nodes.find((n) => n.id === edge.source);
      const target = nodes.find((n) => n.id === edge.target);
      if (!source || !target) continue;

      const sx = source.x + source.w / 2;
      const sy = source.y + source.h;
      const tx = target.x + target.w / 2;
      const ty = target.y;

      const isCross = edge.crossFile;
      const isHighlighted =
        selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);

      ctx.beginPath();
      ctx.strokeStyle = isHighlighted
        ? "#58a6ff"
        : isCross
        ? "rgba(88, 166, 255, 0.25)"
        : "rgba(48, 70, 94, 0.5)";
      ctx.lineWidth = isHighlighted ? 2 : 1;

      // Bezier curve
      const midY = (sy + ty) / 2;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, midY, tx, midY, tx, ty);
      ctx.stroke();

      // Arrow head
      if (isHighlighted || cam.zoom > 0.5) {
        const angle = Math.atan2(ty - midY, tx - tx);
        const arrowSize = 6;
        ctx.beginPath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - arrowSize, ty - arrowSize);
        ctx.lineTo(tx + arrowSize, ty - arrowSize);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawNode(node) {
    const isSelected = selectedNode && selectedNode.id === node.id;
    const isHovered = hoveredNode && hoveredNode.id === node.id;
    const isConnected = selectedNode && isNodeConnected(node.id, selectedNode.id);
    const dimmed = selectedNode && !isSelected && !isConnected;

    const x = node.x;
    const y = node.y;
    const w = node.w;
    const h = node.h;
    const r = 8;

    // Background
    ctx.globalAlpha = dimmed ? 0.3 : 1;
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, r);

    ctx.fillStyle = isHovered ? "#243044" : "#1c2333";
    ctx.fill();

    // Border
    ctx.strokeStyle = isSelected
      ? node.color
      : isHovered
      ? "#58a6ff"
      : "rgba(48, 54, 61, 0.8)";
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Left accent bar
    ctx.fillStyle = node.color;
    ctx.beginPath();
    roundRect(ctx, x, y, 4, h, { tl: r, bl: r, tr: 0, br: 0 });
    ctx.fill();

    // Label
    ctx.fillStyle = isSelected || isHovered ? "#ffffff" : "#e6edf3";
    ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "middle";

    const label = node._type === "file" ? node.label : node.label;
    const maxTextW = w - 24;
    const truncated = truncateText(ctx, label, maxTextW);
    ctx.fillText(truncated, x + 14, y + (node._type === "file" ? 22 : h / 2 - 4));

    // Sub-label
    ctx.fillStyle = "#8b949e";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";

    if (node._type === "file") {
      ctx.fillText(`${node.functionCount} functions`, x + 14, y + 42);
      // Complexity indicator
      const cx = x + w - 40;
      const compVal = Math.min(node.totalComplexity / 20, 1);
      ctx.fillStyle = compVal > 0.7 ? "#f85149" : compVal > 0.4 ? "#d29922" : "#3fb950";
      ctx.fillText(`C:${node.totalComplexity}`, cx, y + 42);
    } else {
      // Function sub-label
      const subParts = [];
      if (node.async) subParts.push("async");
      if (node.exported) subParts.push("exported");
      if (node.params?.length) subParts.push(`(${node.params.join(", ")})`);
      const subLabel = truncateText(ctx, subParts.join(" "), maxTextW);
      ctx.fillText(subLabel, x + 14, y + h / 2 + 10);

      // Complexity dot
      const comp = node.complexity || 1;
      const compColor = comp > 10 ? "#f85149" : comp > 5 ? "#d29922" : "#3fb950";
      ctx.beginPath();
      ctx.arc(x + w - 16, y + h / 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = compColor;
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  function isNodeConnected(nodeId, selectedId) {
    return edges.some(
      (e) =>
        (e.source === selectedId && e.target === nodeId) ||
        (e.target === selectedId && e.source === nodeId)
    );
  }

  function drawMinimap(viewW, viewH) {
    if (nodes.length === 0) return;
    const mw = 180;
    const mh = 120;

    minimapCtx.clearRect(0, 0, mw, mh);
    minimapCtx.fillStyle = "#161b22";
    minimapCtx.fillRect(0, 0, mw, mh);

    const bounds = getNodeBounds();
    const pad = 20;
    const contentW = bounds.maxX - bounds.minX + pad * 2;
    const contentH = bounds.maxY - bounds.minY + pad * 2;
    const scale = Math.min(mw / contentW, mh / contentH);

    minimapCtx.save();
    minimapCtx.translate(mw / 2, mh / 2);
    minimapCtx.scale(scale, scale);
    minimapCtx.translate(
      -(bounds.minX + bounds.maxX) / 2,
      -(bounds.minY + bounds.maxY) / 2
    );

    // Draw nodes as dots
    for (const n of nodes) {
      minimapCtx.fillStyle = n.color;
      minimapCtx.globalAlpha = 0.6;
      minimapCtx.fillRect(n.x, n.y, n.w, n.h);
    }

    // Draw viewport rect
    minimapCtx.globalAlpha = 1;
    minimapCtx.strokeStyle = "#58a6ff";
    minimapCtx.lineWidth = 2 / scale;
    const vpW = viewW / cam.zoom;
    const vpH = viewH / cam.zoom;
    minimapCtx.strokeRect(-cam.x - vpW / 2, -cam.y - vpH / 2, vpW, vpH);

    minimapCtx.restore();
  }

  function drawTooltip(node) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const screenX = (node.x + node.w / 2 + cam.x) * cam.zoom + rect.width / 2;
    const screenY = (node.y + cam.y) * cam.zoom + rect.height / 2 - 10;

    let existing = document.querySelector(".tooltip");
    if (!existing) {
      existing = document.createElement("div");
      existing.className = "tooltip";
      document.getElementById("main").appendChild(existing);
    }

    if (node._type === "file") {
      existing.innerHTML = `
        <div class="tt-name">${node.label}</div>
        <div class="tt-file">${node.functionCount} functions, ${node.exportedCount || 0} exported</div>
      `;
    } else {
      existing.innerHTML = `
        <div class="tt-name">${node.label}</div>
        <div class="tt-file">${node.file || ""}</div>
        ${node.params?.length ? `<div class="tt-params">(${node.params.join(", ")})</div>` : ""}
      `;
    }

    existing.style.left = screenX + "px";
    existing.style.top = screenY - existing.offsetHeight + "px";
    existing.style.display = "block";
  }

  function hideTooltip() {
    const t = document.querySelector(".tooltip");
    if (t) t.style.display = "none";
  }

  // ─── Interaction ───
  function setupInteraction() {
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);
  }

  function screenToWorld(sx, sy) {
    const rect = canvas.parentElement.getBoundingClientRect();
    return {
      x: (sx - rect.width / 2) / cam.zoom - cam.x,
      y: (sy - rect.height / 2) / cam.zoom - cam.y,
    };
  }

  function hitTest(wx, wy) {
    // Reverse order for top-most first
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) {
        return n;
      }
    }
    return null;
  }

  function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = screenToWorld(mx, my);
    const hit = hitTest(world.x, world.y);

    if (hit) {
      // Start node drag
      nodeDrag.active = true;
      nodeDrag.node = hit;
      nodeDrag.offsetX = world.x - hit.x;
      nodeDrag.offsetY = world.y - hit.y;
      canvas.style.cursor = "grabbing";
    } else {
      // Start canvas drag
      drag.active = true;
      drag.startX = mx;
      drag.startY = my;
      drag.startCamX = cam.x;
      drag.startCamY = cam.y;
    }
  }

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (nodeDrag.active) {
      const world = screenToWorld(mx, my);
      nodeDrag.node.x = world.x - nodeDrag.offsetX;
      nodeDrag.node.y = world.y - nodeDrag.offsetY;
      return;
    }

    if (drag.active) {
      const dx = (mx - drag.startX) / cam.zoom;
      const dy = (my - drag.startY) / cam.zoom;
      cam.x = drag.startCamX + dx;
      cam.y = drag.startCamY + dy;
      return;
    }

    // Hover detection
    const world = screenToWorld(mx, my);
    const hit = hitTest(world.x, world.y);
    if (hit !== hoveredNode) {
      hoveredNode = hit;
      canvas.style.cursor = hit ? "pointer" : "grab";
      if (!hit) hideTooltip();
    }
  }

  function onMouseUp(e) {
    if (nodeDrag.active) {
      // Check if it was a click (not a drag)
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const world = screenToWorld(mx, my);
      const hit = hitTest(world.x, world.y);

      if (hit && hit === nodeDrag.node) {
        selectNode(hit);
      }

      nodeDrag.active = false;
      nodeDrag.node = null;
      canvas.style.cursor = "grab";
    }

    if (drag.active) {
      drag.active = false;
      canvas.style.cursor = "grab";
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.max(0.1, Math.min(3, cam.zoom * factor));

    // Zoom toward mouse position
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - rect.width / 2) / cam.zoom - cam.x;
    const wy = (my - rect.height / 2) / cam.zoom - cam.y;

    cam.zoom = newZoom;
    cam.x = (mx - rect.width / 2) / cam.zoom - wx;
    cam.y = (my - rect.height / 2) / cam.zoom - wy;
  }

  function onDoubleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = screenToWorld(mx, my);
    const hit = hitTest(world.x, world.y);

    if (hit) {
      if (hit._type === "file" && currentView === "files") {
        // Switch to functions view, filtered to this file
        setView("functions");
        // Center on this file's functions
        const fileNodes = nodes.filter((n) => n.fileId === hit.id);
        if (fileNodes.length > 0) {
          const avgX = fileNodes.reduce((s, n) => s + n.x + n.w / 2, 0) / fileNodes.length;
          const avgY = fileNodes.reduce((s, n) => s + n.y + n.h / 2, 0) / fileNodes.length;
          cam.x = -avgX;
          cam.y = -avgY;
          cam.zoom = 1;
        }
      } else if (hit._type === "function") {
        openDetailPanel(hit);
      }
    }
  }

  function selectNode(node) {
    if (selectedNode === node) {
      selectedNode = null;
      closeDetailPanel();
    } else {
      selectedNode = node;
      if (node._type === "function" && node.controlFlow?.length) {
        openDetailPanel(node);
      }
    }
  }

  // ─── Detail Panel ───
  function openDetailPanel(node) {
    const panel = document.getElementById("detail-panel");
    const title = document.getElementById("detail-title");
    const meta = document.getElementById("detail-meta");
    const flow = document.getElementById("detail-flow");

    title.textContent = node.label;

    // Meta tags
    const tags = [];
    if (node.async) tags.push('<span class="meta-tag async">async</span>');
    if (node.exported) tags.push('<span class="meta-tag exported">exported</span>');
    if (node.type === "method") tags.push('<span class="meta-tag method">method</span>');
    if (node.type === "arrow") tags.push('<span class="meta-tag arrow">arrow fn</span>');
    if (node.params?.length)
      tags.push(`<span class="meta-tag">(${node.params.join(", ")})</span>`);
    tags.push(`<span class="meta-tag">complexity: ${node.complexity || 1}</span>`);
    if (node.file) tags.push(`<span class="meta-tag">${node.file}</span>`);
    meta.innerHTML = tags.join("");

    // Control flow
    if (node.controlFlow?.length) {
      flow.innerHTML = renderControlFlow(node.controlFlow);
    } else {
      flow.innerHTML = '<p style="color: var(--text-dim); font-size: 12px;">No control flow extracted (simple function)</p>';
    }

    panel.classList.remove("hidden");
  }

  function closeDetailPanel() {
    document.getElementById("detail-panel").classList.add("hidden");
  }

  function renderControlFlow(flowNodes) {
    if (!flowNodes || flowNodes.length === 0) return "";

    return flowNodes
      .map((node) => {
        switch (node.type) {
          case "condition":
            return `
            <div class="flow-node">
              <div class="flow-label condition">if (${esc(node.label)})</div>
              ${(node.branches || [])
                .map(
                  (b) => `
                <div class="branch-label">${b.label}:</div>
                <div class="flow-block">${renderControlFlow(b.flow)}</div>
              `
                )
                .join("")}
            </div>`;

          case "loop":
            return `
            <div class="flow-node">
              <div class="flow-label loop">${esc(node.label)}</div>
              <div class="flow-block">${renderControlFlow(node.flow)}</div>
            </div>`;

          case "switch":
            return `
            <div class="flow-node">
              <div class="flow-label switch">switch (${esc(node.label)})</div>
              ${(node.cases || [])
                .map(
                  (c) => `
                <div class="branch-label">case ${esc(c.label)}:</div>
                <div class="flow-block">${renderControlFlow(c.flow)}</div>
              `
                )
                .join("")}
            </div>`;

          case "try-catch":
            return `
            <div class="flow-node">
              <div class="flow-label try-catch">try</div>
              <div class="flow-block">${renderControlFlow(node.tryFlow)}</div>
              ${
                node.catchFlow?.length
                  ? `<div class="flow-label try-catch">catch</div>
                     <div class="flow-block">${renderControlFlow(node.catchFlow)}</div>`
                  : ""
              }
              ${
                node.finallyFlow?.length
                  ? `<div class="flow-label try-catch">finally</div>
                     <div class="flow-block">${renderControlFlow(node.finallyFlow)}</div>`
                  : ""
              }
            </div>`;

          case "return":
            return `<div class="flow-node"><div class="flow-label return">return ${esc(node.label)}</div></div>`;

          case "throw":
            return `<div class="flow-node"><div class="flow-label throw">throw ${esc(node.label)}</div></div>`;

          case "call":
            return `<div class="flow-node"><div class="flow-label call">${esc(node.label)}</div></div>`;

          case "assignment":
            return `<div class="flow-node"><div class="flow-label assignment">${esc(node.label)}</div></div>`;

          default:
            return "";
        }
      })
      .join("");
  }

  function esc(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── Toolbar ───
  function setupToolbar() {
    document.getElementById("btn-files").addEventListener("click", () => setView("files"));
    document.getElementById("btn-functions").addEventListener("click", () => setView("functions"));
    document.getElementById("btn-refresh").addEventListener("click", refreshData);
    document.getElementById("btn-fit").addEventListener("click", () => {
      fitToScreen();
    });
    document.getElementById("detail-close").addEventListener("click", () => {
      selectedNode = null;
      closeDetailPanel();
    });
  }

  // ─── Helpers ───
  function roundRect(ctx, x, y, w, h, r) {
    if (typeof r === "number") {
      r = { tl: r, tr: r, br: r, bl: r };
    }
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    ctx.lineTo(x + r.bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    ctx.closePath();
  }

  function truncateText(ctx, text, maxW) {
    if (!text) return "";
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 0 && ctx.measureText(t + "...").width > maxW) {
      t = t.slice(0, -1);
    }
    return t + "...";
  }

  // ─── Start ───
  init();
})();

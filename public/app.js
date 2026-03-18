(function () {
  "use strict";

  let graphData = null;
  let activeFlowId = null;

  // ─── Init ───
  function init() {
    setupToolbar();
    loadData();
  }

  async function loadData() {
    showLoading(true);
    try {
      const res = await fetch("/api/graph");
      graphData = await res.json();
      updateStats();
      renderFlowList();

      // Auto-select first multi-step flow
      if (graphData.flows.length > 0) {
        selectFlow(graphData.flows[0].id);
      }

      showLoading(false);
    } catch (err) {
      console.error("Failed to load:", err);
      showLoading(false);
    }
  }

  async function refreshData() {
    showLoading(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      graphData = await res.json();
      updateStats();
      renderFlowList();
      if (graphData.flows.length > 0) {
        selectFlow(graphData.flows[0].id);
      }
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
    document.getElementById("stats").textContent =
      `${s.totalFlows} flows \u00b7 ${s.totalFunctions} functions \u00b7 ${s.totalFiles} files`;
  }

  // ─── Flow List (sidebar) ───
  function renderFlowList() {
    const container = document.getElementById("flow-items");
    container.innerHTML = "";

    // Only show flows with more than 1 step (real flows, not standalone functions)
    const meaningfulFlows = graphData.flows.filter((f) => f.steps.length > 1);
    const standaloneFlows = graphData.flows.filter((f) => f.steps.length === 1);

    for (const flow of meaningfulFlows) {
      container.appendChild(createFlowItem(flow));
    }

    if (standaloneFlows.length > 0) {
      const divider = document.createElement("div");
      divider.className = "flow-list-header";
      divider.textContent = "Standalone";
      divider.style.marginTop = "12px";
      container.appendChild(divider);

      for (const flow of standaloneFlows) {
        container.appendChild(createFlowItem(flow));
      }
    }
  }

  function createFlowItem(flow) {
    const el = document.createElement("div");
    el.className = "flow-item";
    el.dataset.flowId = flow.id;

    const firstStep = flow.steps[0];
    el.innerHTML = `
      <span class="flow-item-icon">${firstStep.icon}</span>
      <div class="flow-item-text">
        <div class="flow-item-name">${esc(flow.label)}</div>
        <div class="flow-item-meta">${flow.steps.length} step${flow.steps.length > 1 ? "s" : ""} \u00b7 ${esc(flow.file)}</div>
      </div>
    `;

    el.addEventListener("click", () => selectFlow(flow.id));
    return el;
  }

  function selectFlow(flowId) {
    activeFlowId = flowId;

    // Update sidebar active state
    document.querySelectorAll(".flow-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.flowId === flowId);
    });

    // Find the flow
    const flow = graphData.flows.find((f) => f.id === flowId);
    if (!flow) return;

    // Render it
    renderFlow(flow);
  }

  // ─── Flow Rendering ───
  function renderFlow(flow) {
    const container = document.getElementById("flow-container");
    const empty = document.getElementById("flow-empty");
    empty.classList.add("hidden");

    container.innerHTML = "";

    // Title
    const title = document.createElement("div");
    title.className = "flow-title";
    title.textContent = flow.label;
    container.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "flow-subtitle";
    subtitle.textContent = `${flow.steps.length} steps \u00b7 Entry: ${flow.entryPoint}() \u00b7 ${flow.file}`;
    container.appendChild(subtitle);

    // Steps
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const isLast = i === flow.steps.length - 1;
      container.appendChild(createStepElement(step, isLast));
    }
  }

  function createStepElement(step, isLast) {
    const el = document.createElement("div");
    el.className = "step";
    el.dataset.type = step.type;
    el.dataset.depth = Math.min(step.depth, 4);

    const hasControlFlow = step.controlFlow && step.controlFlow.length > 0;

    el.innerHTML = `
      <div class="step-connector">
        <div class="step-dot"></div>
        <div class="step-line"></div>
      </div>
      <div class="step-card" data-step-id="${esc(step.id)}">
        <div class="step-header">
          <span class="step-icon">${step.icon}</span>
          <div class="step-info">
            <div class="step-name">${esc(step.label)}${step.params?.length ? '(' + esc(step.params.join(', ')) + ')' : '()'}</div>
            <div class="step-description">
              <span class="step-badge">${formatType(step.type)}</span>
              ${step.async ? '<span class="step-badge" style="border-color: var(--cyan); color: var(--cyan);">async</span>' : ""}
              ${step.crossFile ? '<span class="step-file">\u2192 ' + esc(step.file) + '</span>' : '<span class="step-file">' + esc(step.file) + '</span>'}
            </div>
          </div>
          ${hasControlFlow ? '<span class="step-arrow">\u25B6</span>' : ""}
        </div>
      </div>
    `;

    // Click to expand control flow
    if (hasControlFlow) {
      const card = el.querySelector(".step-card");
      card.addEventListener("click", () => {
        const isExpanded = card.classList.contains("expanded");

        if (isExpanded) {
          // Collapse
          card.classList.remove("expanded");
          const existing = card.querySelector(".step-control-flow");
          if (existing) existing.remove();
        } else {
          // Expand
          card.classList.add("expanded");
          const cfDiv = document.createElement("div");
          cfDiv.className = "step-control-flow";
          cfDiv.innerHTML = renderControlFlow(step.controlFlow);
          card.appendChild(cfDiv);
        }
      });
    }

    return el;
  }

  function formatType(type) {
    const labels = {
      endpoint: "ENTRY",
      validation: "VALIDATE",
      auth: "AUTH",
      "data-read": "READ",
      "data-write": "WRITE",
      security: "SECURITY",
      transform: "TRANSFORM",
      output: "OUTPUT",
      session: "SESSION",
      logging: "LOG",
      error: "ERROR",
      setup: "SETUP",
      logic: "LOGIC",
    };
    return labels[type] || type.toUpperCase();
  }

  // ─── Control Flow Rendering ───
  function renderControlFlow(flowNodes) {
    if (!flowNodes || flowNodes.length === 0) return "";

    return flowNodes
      .map((node) => {
        switch (node.type) {
          case "condition":
            return `
            <div class="cf-node">
              <div class="cf-label condition">if (${esc(node.label)})</div>
              ${(node.branches || [])
                .map(
                  (b) => `
                <div class="cf-branch">${b.label}:</div>
                <div class="cf-block">${renderControlFlow(b.flow)}</div>
              `
                )
                .join("")}
            </div>`;

          case "loop":
            return `
            <div class="cf-node">
              <div class="cf-label loop">${esc(node.label)}</div>
              <div class="cf-block">${renderControlFlow(node.flow)}</div>
            </div>`;

          case "switch":
            return `
            <div class="cf-node">
              <div class="cf-label switch">switch (${esc(node.label)})</div>
              ${(node.cases || [])
                .map(
                  (c) => `
                <div class="cf-branch">case ${esc(c.label)}:</div>
                <div class="cf-block">${renderControlFlow(c.flow)}</div>
              `
                )
                .join("")}
            </div>`;

          case "try-catch":
            return `
            <div class="cf-node">
              <div class="cf-label try-catch">try</div>
              <div class="cf-block">${renderControlFlow(node.tryFlow)}</div>
              ${
                node.catchFlow?.length
                  ? `<div class="cf-label try-catch">catch</div>
                     <div class="cf-block">${renderControlFlow(node.catchFlow)}</div>`
                  : ""
              }
              ${
                node.finallyFlow?.length
                  ? `<div class="cf-label try-catch">finally</div>
                     <div class="cf-block">${renderControlFlow(node.finallyFlow)}</div>`
                  : ""
              }
            </div>`;

          case "return":
            return `<div class="cf-node"><div class="cf-label return">return ${esc(node.label)}</div></div>`;

          case "throw":
            return `<div class="cf-node"><div class="cf-label throw">throw ${esc(node.label)}</div></div>`;

          case "call":
            return `<div class="cf-node"><div class="cf-label call">${esc(node.label)}</div></div>`;

          case "assignment":
            return `<div class="cf-node"><div class="cf-label assignment">${esc(node.label)}</div></div>`;

          default:
            return "";
        }
      })
      .join("");
  }

  // ─── Toolbar ───
  function setupToolbar() {
    document.getElementById("btn-refresh").addEventListener("click", refreshData);
    document.getElementById("detail-close").addEventListener("click", () => {
      document.getElementById("detail-panel").classList.add("hidden");
    });
  }

  // ─── Helpers ───
  function esc(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── Start ───
  init();
})();

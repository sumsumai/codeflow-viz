(function () {
  "use strict";

  let graphData = null;
  let activeFlowId = null;

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
      `${s.totalFlows} flows \u00b7 ${s.totalFunctions} functions`;
  }

  // ─── Sidebar ───
  function renderFlowList() {
    const container = document.getElementById("flow-items");
    container.innerHTML = "";

    const meaningfulFlows = graphData.flows.filter((f) => f.steps.length > 1);
    const standaloneFlows = graphData.flows.filter((f) => f.steps.length === 1);

    for (const flow of meaningfulFlows) {
      container.appendChild(createFlowItem(flow));
    }

    if (standaloneFlows.length > 0) {
      const divider = document.createElement("div");
      divider.className = "flow-list-header";
      divider.textContent = "Helpers";
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
    const stepWord = flow.steps.length === 1 ? "step" : "steps";

    el.innerHTML = `
      <span class="flow-item-icon">${firstStep.icon}</span>
      <div class="flow-item-text">
        <div class="flow-item-name">${esc(flow.label)}</div>
        <div class="flow-item-meta">${flow.steps.length} ${stepWord}</div>
      </div>
    `;

    el.addEventListener("click", () => selectFlow(flow.id));
    return el;
  }

  function selectFlow(flowId) {
    activeFlowId = flowId;
    document.querySelectorAll(".flow-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.flowId === flowId);
    });
    const flow = graphData.flows.find((f) => f.id === flowId);
    if (flow) renderFlow(flow);
  }

  // ─── Flow Rendering ───
  function renderFlow(flow) {
    const container = document.getElementById("flow-container");
    document.getElementById("flow-empty").classList.add("hidden");
    container.innerHTML = "";

    // Title
    const title = document.createElement("div");
    title.className = "flow-title";
    title.textContent = flow.label;
    container.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "flow-subtitle";
    subtitle.textContent = `${flow.steps.length} steps in this flow`;
    container.appendChild(subtitle);

    // Steps
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const stepNum = i + 1;
      container.appendChild(createStepElement(step, stepNum, i === flow.steps.length - 1));
    }
  }

  function createStepElement(step, stepNum, isLast) {
    const el = document.createElement("div");
    el.className = "step";
    el.dataset.type = step.type;

    const hasDetails = (step.controlFlow && step.controlFlow.length > 0);

    el.innerHTML = `
      <div class="step-connector">
        <div class="step-num">${stepNum}</div>
        <div class="step-line"></div>
      </div>
      <div class="step-card" data-step-id="${esc(step.id)}">
        <div class="step-header">
          <span class="step-icon">${step.icon}</span>
          <div class="step-info">
            <div class="step-name">${esc(step.description)}</div>
            <div class="step-code">${esc(step.label)}()</div>
          </div>
          ${hasDetails ? '<span class="step-expand" title="Show code details">+</span>' : ""}
        </div>
      </div>
    `;

    if (hasDetails) {
      const card = el.querySelector(".step-card");
      const expandBtn = el.querySelector(".step-expand");
      card.addEventListener("click", () => {
        const isExpanded = card.classList.contains("expanded");
        if (isExpanded) {
          card.classList.remove("expanded");
          expandBtn.textContent = "+";
          const existing = card.querySelector(".step-details");
          if (existing) existing.remove();
        } else {
          card.classList.add("expanded");
          expandBtn.textContent = "\u2212";
          const details = document.createElement("div");
          details.className = "step-details";
          details.innerHTML = renderControlFlow(step.controlFlow);
          card.appendChild(details);
        }
      });
    }

    return el;
  }

  // ─── Control Flow (code details) ───
  function renderControlFlow(flowNodes) {
    if (!flowNodes || flowNodes.length === 0) return "";
    return flowNodes
      .map((node) => {
        switch (node.type) {
          case "condition":
            return `<div class="cf-node">
              <div class="cf-label condition">\u2753 If ${esc(simplifyCondition(node.label))}</div>
              ${(node.branches || []).map((b) => `
                <div class="cf-branch">${b.label === "true" ? "\u2714 Yes:" : "\u2716 No:"}</div>
                <div class="cf-block">${renderControlFlow(b.flow)}</div>
              `).join("")}
            </div>`;
          case "loop":
            return `<div class="cf-node">
              <div class="cf-label loop">\u{1F504} Repeat: ${esc(simplifyLoop(node.label))}</div>
              <div class="cf-block">${renderControlFlow(node.flow)}</div>
            </div>`;
          case "try-catch":
            return `<div class="cf-node">
              <div class="cf-label try-catch">\u{1F6E1} Try this:</div>
              <div class="cf-block">${renderControlFlow(node.tryFlow)}</div>
              ${node.catchFlow?.length
                ? `<div class="cf-label catch">\u26A0 If something goes wrong:</div>
                   <div class="cf-block">${renderControlFlow(node.catchFlow)}</div>`
                : ""}
            </div>`;
          case "return":
            return `<div class="cf-node"><div class="cf-label return">\u2705 Send back the result</div></div>`;
          case "throw":
            return `<div class="cf-node"><div class="cf-label throw">\u274C Stop with error</div></div>`;
          case "call":
            return `<div class="cf-node"><div class="cf-label call">\u27A1 ${esc(simplifyCall(node.label))}</div></div>`;
          case "assignment":
            return `<div class="cf-node"><div class="cf-label assignment">\u{1F4E6} ${esc(simplifyAssignment(node.label))}</div></div>`;
          case "switch":
            return `<div class="cf-node">
              <div class="cf-label switch">\u{1F500} Check different cases</div>
              ${(node.cases || []).map((c) => `
                <div class="cf-branch">${esc(c.label)}:</div>
                <div class="cf-block">${renderControlFlow(c.flow)}</div>
              `).join("")}
            </div>`;
          default:
            return "";
        }
      })
      .join("");
  }

  // ─── Simplifiers: make code readable ───
  function simplifyCondition(label) {
    if (!label) return "condition is met";
    return label
      .replace(/^!/, "not ")
      .replace(/===/g, " is ")
      .replace(/!==/g, " is not ")
      .replace(/==/g, " is ")
      .replace(/!=/g, " is not ")
      .replace(/&&/g, " and ")
      .replace(/\|\|/g, " or ")
      .replace(/\.length\s*<\s*(\d+)/, " is shorter than $1")
      .replace(/\.length\s*>\s*(\d+)/, " is longer than $1");
  }

  function simplifyLoop(label) {
    if (!label) return "for each item";
    if (label.includes("for (") && label.includes(" of ")) return "for each item in the list";
    if (label.includes("for (") && label.includes(" in ")) return "for each property";
    if (label.includes("while")) return "while condition is true";
    return "for each item";
  }

  function simplifyCall(label) {
    if (!label) return "Run next step";
    // Extract just the function name from call expressions
    const match = label.match(/(?:await\s+)?(\w+(?:\.\w+)*)\s*\(/);
    if (match) return `Run ${match[1]}`;
    return label;
  }

  function simplifyAssignment(label) {
    if (!label) return "Prepare data";
    if (label.includes("req.body")) return "Get data from the request";
    if (label.includes("req.params")) return "Get parameters from the URL";
    if (label.includes("req.query")) return "Get query parameters";
    if (label.startsWith("const ") || label.startsWith("let ") || label.startsWith("var ")) {
      const varMatch = label.match(/(?:const|let|var)\s+(\{[^}]+\}|\w+)/);
      if (varMatch) return `Prepare ${varMatch[1].replace(/[{}]/g, "").trim()}`;
    }
    return "Prepare data";
  }

  // ─── Toolbar ───
  function setupToolbar() {
    document.getElementById("btn-refresh").addEventListener("click", refreshData);
    document.getElementById("detail-close").addEventListener("click", () => {
      document.getElementById("detail-panel").classList.add("hidden");
    });
  }

  function esc(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  init();
})();

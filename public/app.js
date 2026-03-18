(function () {
  "use strict";

  let graphData = null;
  let currentView = "overview"; // "overview" | "detail"

  function init() {
    document.getElementById("btn-refresh").addEventListener("click", refreshData);
    document.getElementById("btn-back").addEventListener("click", showOverview);
    loadData();
  }

  async function loadData() {
    showLoading(true);
    try {
      const res = await fetch("/api/graph");
      graphData = await res.json();
      updateStats();
      showOverview();
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
      showOverview();
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
      `${s.totalFiles} files \u00b7 ${s.totalFunctions} functions`;
  }

  // ═══════════ OVERVIEW ═══════════
  function showOverview() {
    currentView = "overview";
    document.getElementById("btn-back").classList.add("hidden");
    document.getElementById("flow-detail").classList.add("hidden");
    document.getElementById("overview").classList.remove("hidden");

    // Health badge
    const badge = document.getElementById("health-badge");
    const s = graphData.stats;
    if (s.totalIssues === 0) {
      badge.className = "health-badge good";
      badge.textContent = "All good";
    } else if (s.errors > 0) {
      badge.className = "health-badge error";
      badge.textContent = `${s.totalIssues} issue${s.totalIssues > 1 ? "s" : ""} found`;
    } else {
      badge.className = "health-badge warning";
      badge.textContent = `${s.totalIssues} warning${s.totalIssues > 1 ? "s" : ""}`;
    }

    renderOverview();
  }

  function renderOverview() {
    const el = document.getElementById("overview");
    el.innerHTML = "";

    // Issues banner
    if (graphData.issues.length > 0) {
      el.appendChild(renderIssuesBanner());
    } else {
      const good = document.createElement("div");
      good.className = "issues-banner all-good";
      good.innerHTML = `
        <span class="issues-icon">\u2705</span>
        <div class="issues-text">
          <h2>Looking good</h2>
          <p>No issues detected in your codebase.</p>
        </div>
      `;
      el.appendChild(good);
    }

    // Flow cards
    const mainFlows = graphData.flows.filter((f) => f.steps.length > 1);
    const helpers = graphData.flows.filter((f) => f.steps.length === 1);

    if (mainFlows.length > 0) {
      const title = document.createElement("div");
      title.className = "flows-section-title";
      title.textContent = `Your app's flows (${mainFlows.length})`;
      el.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "flow-grid";
      for (const flow of mainFlows) {
        grid.appendChild(renderFlowCard(flow));
      }
      el.appendChild(grid);
    }

    if (helpers.length > 0) {
      const title = document.createElement("div");
      title.className = "flows-section-title";
      title.textContent = `Helper functions (${helpers.length})`;
      el.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "flow-grid";
      for (const flow of helpers) {
        grid.appendChild(renderFlowCard(flow));
      }
      el.appendChild(grid);
    }
  }

  function renderIssuesBanner() {
    const issues = graphData.issues;
    const hasErrors = issues.some((i) => i.severity === "error");

    const wrapper = document.createElement("div");

    // Header
    const banner = document.createElement("div");
    banner.className = `issues-banner ${hasErrors ? "has-errors" : ""}`;
    banner.innerHTML = `
      <span class="issues-icon">${hasErrors ? "\u{1F6A8}" : "\u26A0\uFE0F"}</span>
      <div class="issues-text">
        <h2>${issues.length} issue${issues.length > 1 ? "s" : ""} found</h2>
        <p>Here's what's wrong and how to fix it.</p>
      </div>
    `;
    wrapper.appendChild(banner);

    // Individual issue cards with summary + fix prompt
    const list = document.createElement("div");
    list.className = "issues-detail-list";

    for (const iss of issues) {
      const card = document.createElement("div");
      card.className = `issue-card ${iss.severity}`;
      card.innerHTML = `
        <div class="issue-card-header">
          <span class="issue-dot ${iss.severity}"></span>
          <span class="issue-card-title">${esc(iss.title)}</span>
          <span class="issue-card-file">${esc(iss.file || "")}</span>
        </div>
        <div class="issue-card-summary">${esc(iss.summary || iss.description)}</div>
        <div class="issue-card-fix">
          <div class="fix-header">
            <span>\u{1FA84} Fix it — copy this prompt:</span>
            <button class="copy-btn" data-prompt="${esc(iss.fix || "")}">Copy</button>
          </div>
          <div class="fix-prompt">${esc(iss.fix || "")}</div>
        </div>
      `;

      // Copy button
      const copyBtn = card.querySelector(".copy-btn");
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(iss.fix || "").then(() => {
          copyBtn.textContent = "Copied!";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.classList.remove("copied");
          }, 2000);
        });
      });

      // Click card to navigate to flow
      card.addEventListener("click", () => {
        const flow = graphData.flows.find((f) => f.steps.some((s) => s.id === iss.fnId));
        if (flow) showFlowDetail(flow.id);
      });

      list.appendChild(card);
    }

    wrapper.appendChild(list);
    return wrapper;
  }

  function renderFlowCard(flow) {
    const card = document.createElement("div");
    card.className = "flow-card";

    const firstStep = flow.steps[0];

    // Mini step dots
    const dotsHtml = flow.steps
      .map((s, i) => {
        const dot = `<span class="flow-mini-step ${s.type}"></span>`;
        const conn = i < flow.steps.length - 1 ? '<span class="flow-mini-connector"></span>' : "";
        return dot + conn;
      })
      .join("");

    card.innerHTML = `
      <div class="flow-card-health ${flow.health}"></div>
      <div class="flow-card-header">
        <span class="flow-card-icon">${firstStep.icon}</span>
        <span class="flow-card-name">${esc(flow.label)}</span>
      </div>
      <div class="flow-card-steps">${dotsHtml}</div>
      <div class="flow-card-meta">
        <span>${flow.steps.length} steps</span>
        ${flow.issues.length > 0 ? `<span style="color: var(--red)">\u00b7 ${flow.issues.length} issue${flow.issues.length > 1 ? "s" : ""}</span>` : ""}
      </div>
    `;

    card.addEventListener("click", () => showFlowDetail(flow.id));
    return card;
  }

  // ═══════════ FLOW DETAIL ═══════════
  function showFlowDetail(flowId) {
    const flow = graphData.flows.find((f) => f.id === flowId);
    if (!flow) return;

    currentView = "detail";
    document.getElementById("btn-back").classList.remove("hidden");
    document.getElementById("overview").classList.add("hidden");
    document.getElementById("flow-detail").classList.remove("hidden");

    renderFlowDetail(flow);
  }

  function renderFlowDetail(flow) {
    const el = document.getElementById("flow-detail");
    el.innerHTML = "";

    const title = document.createElement("div");
    title.className = "flow-title";
    title.textContent = flow.label;
    el.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "flow-subtitle";
    const issueText = flow.issues.length > 0
      ? ` \u00b7 ${flow.issues.length} issue${flow.issues.length > 1 ? "s" : ""}`
      : "";
    subtitle.textContent = `${flow.steps.length} steps${issueText}`;
    el.appendChild(subtitle);

    for (let i = 0; i < flow.steps.length; i++) {
      el.appendChild(createStepElement(flow.steps[i], i + 1));
    }
  }

  function createStepElement(step, stepNum) {
    const el = document.createElement("div");
    el.className = "step";
    el.dataset.type = step.type;

    const hasDetails = step.controlFlow && step.controlFlow.length > 0;
    const hasIssues = step.issues && step.issues.length > 0;

    el.innerHTML = `
      <div class="step-connector">
        <div class="step-num">${stepNum}</div>
        <div class="step-line"></div>
      </div>
      <div class="step-card${hasIssues ? " has-issues" : ""}">
        <div class="step-header">
          <span class="step-icon">${step.icon}</span>
          <div class="step-info">
            <div class="step-name">${esc(step.description)}</div>
            <div class="step-code">${esc(step.label)}()</div>
          </div>
          ${hasDetails ? '<span class="step-expand">+</span>' : ""}
        </div>
        ${hasIssues ? renderStepIssues(step.issues) : ""}
      </div>
    `;

    if (hasDetails) {
      const card = el.querySelector(".step-card");
      const btn = el.querySelector(".step-expand");
      card.addEventListener("click", () => {
        const expanded = card.classList.contains("expanded");
        if (expanded) {
          card.classList.remove("expanded");
          btn.textContent = "+";
          const d = card.querySelector(".step-details");
          if (d) d.remove();
        } else {
          card.classList.add("expanded");
          btn.textContent = "\u2212";
          const d = document.createElement("div");
          d.className = "step-details";
          d.innerHTML = renderControlFlow(step.controlFlow);
          card.appendChild(d);
        }
      });
    }

    return el;
  }

  function renderStepIssues(issues) {
    return `<div class="step-issues">${issues
      .map((i) => `<div class="step-issue ${i.severity}">\u26A0 ${esc(i.title)}</div>`)
      .join("")}</div>`;
  }

  // ─── Control Flow ───
  function renderControlFlow(nodes) {
    if (!nodes || !nodes.length) return "";
    return nodes.map((n) => {
      switch (n.type) {
        case "condition":
          return `<div class="cf-node"><div class="cf-label condition">\u2753 If ${esc(simplify(n.label))}</div>
            ${(n.branches||[]).map((b) => `<div class="cf-branch">${b.label==="true"?"\u2714 Yes:":"\u2716 No:"}</div>
            <div class="cf-block">${renderControlFlow(b.flow)}</div>`).join("")}</div>`;
        case "loop":
          return `<div class="cf-node"><div class="cf-label loop">\u{1F504} Repeat</div>
            <div class="cf-block">${renderControlFlow(n.flow)}</div></div>`;
        case "try-catch":
          return `<div class="cf-node"><div class="cf-label try-catch">\u{1F6E1} Try this:</div>
            <div class="cf-block">${renderControlFlow(n.tryFlow)}</div>
            ${n.catchFlow?.length?`<div class="cf-label catch">\u26A0 If it fails:</div>
            <div class="cf-block">${renderControlFlow(n.catchFlow)}</div>`:""}</div>`;
        case "return":
          return `<div class="cf-node"><div class="cf-label return">\u2705 Send back result</div></div>`;
        case "throw":
          return `<div class="cf-node"><div class="cf-label throw">\u274C Stop with error</div></div>`;
        case "call":
          return `<div class="cf-node"><div class="cf-label call">\u27A1 ${esc(simplifyCall(n.label))}</div></div>`;
        case "assignment":
          return `<div class="cf-node"><div class="cf-label assignment">\u{1F4E6} ${esc(simplifyAssign(n.label))}</div></div>`;
        case "switch":
          return `<div class="cf-node"><div class="cf-label switch">\u{1F500} Check cases</div>
            ${(n.cases||[]).map((c)=>`<div class="cf-branch">${esc(c.label)}:</div>
            <div class="cf-block">${renderControlFlow(c.flow)}</div>`).join("")}</div>`;
        default: return "";
      }
    }).join("");
  }

  function simplify(s) {
    if (!s) return "condition is met";
    return s.replace(/===/g," is ").replace(/!==/g," is not ").replace(/&&/g," and ").replace(/\|\|/g," or ").replace(/^!/,"not ").replace(/\.length\s*<\s*(\d+)/," is shorter than $1");
  }
  function simplifyCall(s) {
    if (!s) return "Run next step";
    const m = s.match(/(?:await\s+)?(\w+(?:\.\w+)*)\s*\(/);
    return m ? `Run ${m[1]}` : s;
  }
  function simplifyAssign(s) {
    if (!s) return "Prepare data";
    if (s.includes("req.body")) return "Get data from request";
    if (s.startsWith("const ")||s.startsWith("let ")) {
      const m = s.match(/(?:const|let)\s+(\{[^}]+\}|\w+)/);
      return m ? `Prepare ${m[1].replace(/[{}]/g,"").trim()}` : "Prepare data";
    }
    return "Prepare data";
  }

  function esc(s) {
    if (!s) return "";
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  init();
})();

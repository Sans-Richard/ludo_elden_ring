const DEMO_URL = "../input/knowledge-graph.json";

const state = { document: null, selectedQuest: null, graphLayout: "force", graphSeed: 0 };
const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function showError(message) {
  const banner = $("#error-banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function clearError() {
  $("#error-banner").classList.add("hidden");
}

function setText(selector, value) {
  $(selector).textContent = value;
}

const STATE_LABELS = {
  NOT_STARTED: "尚未开始",
  AVAILABLE: "可以推进",
  ACTIVE: "进行中",
  BLOCKED: "被阻塞",
  COMPLETED: "已完成",
  FAILED: "已失败",
  ABANDONED: "已放弃",
  CANCELLED: "已取消"
};

const ACTION_LABELS = {
  action_give_fingerslayer_blade: "把猎杀指头刀交给菈妮",
  action_complete_seluv_is: "完成赛尔维斯交代的任务",
  action_partner_ranni: "与菈妮结成伴侣",
  action_help_millicent: "帮助米莉森",
  action_kill_millicent: "杀害米莉森",
  action_give_twinned_set: "把孪生套交给 D 的弟弟",
  action_leave_fia: "不交出孪生套，保留菲雅支线"
};

function stateLabel(value) {
  return STATE_LABELS[value] ?? value;
}

function valueLabel(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  return String(value);
}

function variableLabel(variableId) {
  const labels = {
    ranni_partnered: "是否与菈妮结成伴侣",
    fingerslayer_blade_given: "是否已交出猎杀指头刀",
    seluv_is_alive: "赛尔维斯是否存活",
    seluv_is_work_done: "赛尔维斯的任务是否完成",
    miquella_needle_obtained: "是否获得米凯拉的针",
    fia_alive: "菲雅是否存活"
  };
  return labels[variableId] ?? variableId;
}

function actionLabel(action) {
  return ACTION_LABELS[action.action_id] ?? action.action_type;
}

function conditionLabel(condition) {
  const variable = variableLabel(condition.variable);
  const value = valueLabel(condition.value);
  if (condition.operator === "eq") return `${variable}为“${value}”`;
  if (condition.operator === "neq") return `${variable}不是“${value}”`;
  const operatorLabels = { in: "属于", not_in: "不属于", gt: "大于", gte: "至少为", lt: "小于", lte: "不超过" };
  return `${variable}${operatorLabels[condition.operator] ?? condition.operator}“${value}”`;
}

function transitionLabel(transition) {
  return `${stateLabel(transition.source_state)} → ${stateLabel(transition.target_state)}`;
}

function readableStep(step) {
  if (step.kind === "action") {
    const action = state.document.actions.find((item) => item.action_id === step.id);
    return action ? actionLabel(action) : step.description;
  }
  if (step.kind === "transition") {
    const transition = state.document.transitions.find((item) => item.transition_id === step.id);
    return transition ? transitionLabel(transition) : step.description;
  }
  return step.description;
}

const GRAPH_TYPE_LABELS = {
  local: "单节点 / 局部邻域",
  path: "路径",
  cycle: "环路",
  tree: "树",
  forest: "森林",
  dag: "DAG",
  general: "一般图",
  multi_graph: "多个子图"
};

function normalizeDocument(input) {
  if (!input || typeof input !== "object") throw new Error("输入必须是 JSON 对象");
  if (!input.graph && !input.nodes) throw new Error("输入不是知识图谱格式：缺少 graph.nodes 和 graph.edges");
  const graph = input.graph ?? input;
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const allowedTypes = new Set(["local", "path", "cycle", "tree", "forest", "dag", "general", "multi_graph"]);
  if (!allowedTypes.has(graph.graph_type)) throw new Error("输入不是知识图谱格式：graph.graph_type 无效");
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error("知识图谱必须包含 nodes 数组和 edges 数组");
  if (nodes.some((node) => !node.id || !node.type || !(node.label || node.name))) {
    throw new Error("知识图谱节点必须包含 id、type 和 label");
  }
  if (edges.some((edge) => !edge.from || !edge.to || !edge.relation)) {
    throw new Error("知识图谱边必须包含 from、to 和 relation");
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("知识图谱节点 id 必须唯一");
  if (edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
    throw new Error("知识图谱边的 from 和 to 必须引用已有节点");
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const graphEdgesFrom = (id, relation) => edges.filter(
    (edge) => edge.from === id && (!relation || edge.relation === relation)
  );
  const stateNodes = nodes.filter((node) => node.type === "state");
  const worldVariables = stateNodes.map((node) => ({
    id: node.id,
    display_name: node.label ?? node.id,
    initial: node.initial,
    reversibility: node.reversibility ?? "unknown",
    evidence: node.evidence ?? []
  }));
  const transitionNodes = nodes.filter((node) => node.type === "transition");
  const transitions = transitionNodes.map((node) => {
    const ownerEdge = edges.find((edge) => edge.to === node.id && edge.relation === "has_transition");
    const owner = ownerEdge ? nodeById.get(ownerEdge.from) : null;
    const [sourceState, targetState] = String(node.label ?? "").split(/\s*→\s*/);
    const guards = edges
      .filter((edge) => edge.to === node.id && edge.relation === "requires")
      .map((edge) => {
        const match = String(edge.label ?? "").match(/条件\s+(\w+)\s+(.+)/);
        return {
          variable: edge.from,
          operator: match?.[1] ?? "eq",
          value: parseGraphValue(match?.[2])
        };
      });
    return {
      transition_id: node.id,
      quest_id: owner?.id,
      source_state: sourceState || "AVAILABLE",
      target_state: targetState || "COMPLETED",
      guards,
      effects: [],
      evidence: node.evidence ?? []
    };
  }).filter((transition) => transition.quest_id);
  const actions = nodes.filter((node) => node.type === "action").map((node) => ({
    action_id: node.id,
    action_type: node.label ?? node.id,
    actor: node.actor ?? "player",
    preconditions: [],
    effects: graphEdgesFrom(node.id, "changes").map((edge) => ({
      variable: edge.to,
      value: parseGraphValue(String(edge.label ?? "").replace(/^修改为\s*/, ""))
    })),
    irreversible: Boolean(node.irreversible),
    affected_entities: graphEdgesFrom(node.id, "affects").map((edge) => edge.to),
    evidence: node.evidence ?? []
  }));
  const entities = nodes
    .filter((node) => ["entity", "character", "item", "location", "event"].includes(node.type))
    .map((node) => ({
      id: node.id,
      entity_type: ["character", "item", "location", "event"].includes(node.type) ? node.type : "event",
      display_name: node.label ?? node.name ?? node.id,
      evidence: node.evidence ?? []
    }));
  const quests = nodes
    .filter((node) => ["quest", "task", "subgraph"].includes(node.type))
    .map((node) => ({
      id: node.id,
      display_name: node.label ?? node.name ?? node.id,
      initial_state: node.initial_state ?? "AVAILABLE",
      terminal_states: node.terminal_states ?? ["COMPLETED", "FAILED"],
      stage_ids: [],
      evidence: node.evidence ?? []
    }));
  const evidence = nodes
    .filter((node) => ["evidence", "source", "claim"].includes(node.type))
    .map((node) => ({
      evidence_id: node.id,
      source_id: node.source_id ?? node.id,
      summary: node.description ?? node.label ?? node.name ?? node.id,
      certainty: node.certainty ?? "explicit",
      evidence_assessment: node.assessment ?? "unverified"
    }));
  const questIds = new Set(quests.map((quest) => quest.id));
  return {
    ...input,
    graph: { ...graph, nodes, edges },
    schema_version: input.schema_version ?? "knowledge-graph-1.0",
    game: input.game ?? { display_name: graph.name ?? "知识图谱" },
    entities, quests, evidence, actions,
    stages: input.stages ?? [], objectives: input.objectives ?? [],
    world_variables: input.world_variables ?? worldVariables,
    transitions: input.transitions ?? transitions,
    dependencies: [
      ...(input.dependencies ?? []),
      ...edges.filter((edge) => questIds.has(edge.from) && questIds.has(edge.to)).map((edge, index) => ({
        id: edge.id ?? `graph-edge-${index}`,
        source_quest: edge.from,
        target_quest: edge.to,
        relation: edge.relation ?? "related_to",
        conditions: edge.conditions ?? [],
        evidence: edge.evidence ?? []
      }))
    ],
    alternative_paths: input.alternative_paths ?? [],
    failure_branches: input.failure_branches ?? [],
    recovery_paths: input.recovery_paths ?? [],
    properties: input.properties ?? [],
    assumptions: input.assumptions ?? [],
    conflicts: input.conflicts ?? []
  };
}

function parseGraphValue(value) {
  const normalized = String(value).trim();
  if (normalized === "True" || normalized === "true") return true;
  if (normalized === "False" || normalized === "false") return false;
  if (normalized === "None" || normalized === "null") return null;
  return normalized;
}

function renderDocument(doc) {
  state.document = normalizeDocument(doc);
  doc = state.document;
  state.selectedQuest = doc.quests?.[0]?.id ?? null;
  clearError();
  const graph = doc.graph;
  const format = `${GRAPH_TYPE_LABELS[graph.graph_type] ?? graph.graph_type ?? "知识图谱"} · ${graph.nodes?.length ?? 0} 节点 · ${graph.edges?.length ?? 0} 条边`;
  $("#input-format").textContent = `输入格式：${format}`;
  $("#input-format").classList.remove("hidden");
  setText("#quest-count", doc.quests?.length ?? 0);
  setText("#variable-count", doc.world_variables?.length ?? 0);
  setText("#evidence-count", doc.evidence?.length ?? 0);
  setText("#entity-count", doc.entities?.length ?? 0);
  setText("#action-count", doc.actions?.length ?? 0);
  setText("#transition-count", doc.transitions?.length ?? 0);
  setText("#open-question-count", doc.assumptions?.length ?? 0);
  setText("#schema-version", doc.schema_version ?? "—");
  setText("#game-version", doc.game?.version === "unspecified" ? "version unspecified" : (doc.game?.version ?? "—"));
  setText("#result-label", "READY");
  setText("#result-detail", "等待运行");
  renderQuestList();
  renderEvidence();
  renderGraph();
  renderKnowledgeGraph();
  resetResult();
}

function renderQuestList() {
  const list = $("#quest-list");
  list.innerHTML = (state.document.quests ?? []).map((quest) => `
    <button class="quest-option ${quest.id === state.selectedQuest ? "selected" : ""}" data-quest-id="${esc(quest.id)}">
      <strong>${esc(quest.display_name)}</strong>
      <span>初始状态：${esc(stateLabel(quest.initial_state))}</span>
    </button>
  `).join("");
  list.querySelectorAll(".quest-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedQuest = button.dataset.questId;
      renderQuestList();
      resetResult();
    });
  });
}

function renderEvidence() {
  const sources = Object.fromEntries((state.document.sources ?? []).map((source) => [source.source_id, source]));
  $("#evidence-list").innerHTML = (state.document.evidence ?? []).map((evidence) => {
    const source = sources[evidence.source_id];
    return `
      <div class="evidence-item">
        <strong>${esc(evidence.evidence_id)} · ${esc(evidence.evidence_assessment)}</strong>
        <p>${esc(evidence.summary)}</p>
        <small>${esc(source?.title ?? evidence.source_id)} · ${esc(source?.section ?? "source")}</small>
      </div>
    `;
  }).join("");
}

function resetResult() {
  $("#result-chip").className = "result-chip";
  setText("#result-chip", "尚未运行");
  $("#result-summary").className = "result-summary empty-state";
  $("#result-summary").textContent = "选择任务并运行验证";
  $("#path-container").innerHTML = "";
  renderGraph();
}

function getQuestBreakages(questId) {
  const relevantTransitions = (state.document.transitions ?? []).filter(
    (transition) => transition.quest_id === questId
  );
  const requirements = relevantTransitions.flatMap((transition) =>
    (transition.guards ?? []).map((guard) => ({ guard, transition }))
  );
  const breakages = [];
  for (const action of state.document.actions ?? []) {
    for (const effect of action.effects ?? []) {
      for (const requirement of requirements) {
        if (effect.variable !== requirement.guard.variable) continue;
        const variable = (state.document.world_variables ?? []).find(
          (item) => item.id === effect.variable
        );
        if (variable?.reversibility !== "irreversible") continue;
        const guardHoldsAfterAction = conditionsHold([requirement.guard], {
          [effect.variable]: effect.value
        });
        const causesFailure = requirement.transition.target_state === "FAILED"
          && guardHoldsAfterAction;
        const breaksRequiredPath = !guardHoldsAfterAction
          && requirement.transition.target_state !== "FAILED";
        if (!causesFailure && !breaksRequiredPath) continue;
        breakages.push({ action, effect, variable, causesFailure, ...requirement });
      }
    }
  }
  // A knowledge-graph document stores failure branches as graph edges rather
  // than legacy transition arrays. Read that relation directly as a fallback.
  const graph = state.document.graph;
  if (graph) {
    const nodesById = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
    const ownerTransitions = (graph.edges ?? [])
      .filter((edge) => edge.relation === "has_transition" && edge.from === questId)
      .map((edge) => nodesById.get(edge.to))
      .filter((node) => node?.type === "transition" && String(node.label).includes("FAILED"));
    for (const transition of ownerTransitions) {
      const guards = (graph.edges ?? []).filter(
        (edge) => edge.to === transition.id && edge.relation === "requires"
      );
      for (const guard of guards) {
        const guardMatch = String(guard.label ?? "").match(/条件\s+(\w+)\s+(.+)/);
        const expected = parseGraphValue(guardMatch?.[2] ?? "");
        for (const change of (graph.edges ?? []).filter(
          (edge) => edge.relation === "changes" && edge.to === guard.from
        )) {
          const actionNode = nodesById.get(change.from);
          const variableNode = nodesById.get(change.to);
          const actual = parseGraphValue(String(change.label ?? "").replace(/^修改为\s*/, ""));
          if (!actionNode || variableNode?.reversibility !== "irreversible" || actual !== expected) continue;
          if (breakages.some((item) => item.action.action_id === actionNode.id && item.transition.transition_id === transition.id)) continue;
          breakages.push({
            action: {
              action_id: actionNode.id,
              action_type: actionNode.label ?? actionNode.id,
              evidence: actionNode.evidence ?? []
            },
            effect: { variable: guard.from, value: actual },
            variable: variableNode,
            guard: { variable: guard.from, operator: guardMatch?.[1] ?? "eq", value: expected },
            transition: {
              transition_id: transition.id,
              target_state: "FAILED"
            },
            causesFailure: true
          });
        }
      }
    }
  }
  return breakages;
}

function renderGraph() {
  const container = $("#graph-container");
  if (!container || !state.document) return;
  const doc = state.document;
  const quest = doc.quests.find((item) => item.id === state.selectedQuest);
  if (!quest) {
    container.innerHTML = '<div class="empty-state">选择任务后显示关系图</div>';
    return;
  }
  const nodes = [];
  const edges = [];
  const addNode = (id, type, label, detail) => {
    if (!nodes.some((node) => node.id === id)) nodes.push({ id, type, label, detail });
  };
  addNode(quest.id, "quest", quest.display_name, "任务目标");
  for (const transition of (doc.transitions ?? []).filter((item) => item.quest_id === quest.id)) {
    addNode(transition.transition_id, "transition", transitionLabel(transition), "任务状态变化");
    edges.push({ from: quest.id, to: transition.transition_id, kind: "stage" });
    for (const guard of transition.guards ?? []) {
      const variable = (doc.world_variables ?? []).find((item) => item.id === guard.variable);
      addNode(guard.variable, "condition", variable?.display_name ?? variableLabel(guard.variable), conditionLabel(guard));
      edges.push({ from: guard.variable, to: transition.transition_id, kind: "requires" });
    }
  }
  const brokenIds = new Set(getQuestBreakages(quest.id).map((item) => item.action.action_id));
  for (const action of doc.actions ?? []) {
    const touchesQuest = (action.effects ?? []).some((effect) =>
      (doc.transitions ?? []).some((transition) =>
        transition.quest_id === quest.id && (transition.guards ?? []).some((guard) => guard.variable === effect.variable)
      )
    );
    if (!touchesQuest) continue;
    const type = brokenIds.has(action.action_id) ? "danger-action" : "action";
    addNode(action.action_id, type, actionLabel(action), "玩家行为");
    edges.push({ from: action.action_id, to: quest.id, kind: "action" });
    for (const effect of action.effects ?? []) {
      addNode(effect.variable, "condition", effect.variable, `变为 ${String(effect.value)}`);
      edges.push({ from: action.action_id, to: effect.variable, kind: brokenIds.has(action.action_id) ? "breaks" : "changes" });
    }
  }
  const width = Math.max(760, nodes.length * 155);
  const positions = Object.fromEntries(nodes.map((node, index) => [
    node.id, { x: 100 + (index % 4) * 190, y: 55 + Math.floor(index / 4) * 105 }
  ]));
  const lines = edges.filter((edge) => positions[edge.from] && positions[edge.to]).map((edge) => {
    const from = positions[edge.from], to = positions[edge.to];
    return `<line class="graph-edge ${edge.kind}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
  }).join("");
  const shapes = nodes.map((node) => {
    const position = positions[node.id];
    return `<g class="graph-node ${node.type}" transform="translate(${position.x - 68},${position.y - 25})">
      <rect width="136" height="50" rx="6"></rect>
      <text class="node-label" x="68" y="20" text-anchor="middle">${esc(node.label.slice(0, 19))}</text>
      <text class="node-detail" x="68" y="37" text-anchor="middle">${esc(node.detail.slice(0, 21))}</text>
    </g>`;
  }).join("");
  container.innerHTML = `<svg class="relation-graph" viewBox="0 0 ${width} 330" role="img" aria-label="任务原子语句关系图">
    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"></path></marker></defs>
    ${lines}${shapes}
  </svg>`;
  $("#graph-legend").innerHTML = `<span><i class="legend-dot quest"></i>任务</span><span><i class="legend-dot condition"></i>状态/条件</span><span><i class="legend-dot action"></i>动作</span><span><i class="legend-line breaks"></i>破坏前置条件</span>`;
}

function renderKnowledgeGraph() {
  const container = $("#knowledge-graph-container");
  if (!container || !state.document) return;
  const doc = state.document;
  const typeFilter = $("#knowledge-type")?.value ?? "all";
  const query = ($("#knowledge-search")?.value ?? "").trim().toLowerCase();
  const nodes = [];
  const edges = [];
  const addNode = (id, type, label, detail, description) => {
    if (!nodes.some((node) => node.id === id)) nodes.push({ id, type, label, detail, description });
  };
  const addEdge = (from, to, kind, label) => {
    if (from && to && !edges.some((edge) => edge.from === from && edge.to === to && edge.kind === kind)) {
      edges.push({ from, to, kind, label });
    }
  };
  if (doc.graph) {
    const graphTypeMap = {
      entity: "entity", character: "entity", item: "entity", location: "entity",
      event: "action", quest: "quest", task: "quest", subgraph: "quest",
      action: "action", evidence: "evidence", source: "evidence", claim: "evidence"
    };
    for (const node of doc.graph.nodes ?? []) {
      const type = graphTypeMap[node.type] ?? "entity";
      addNode(node.id, type, node.label ?? node.name ?? node.id, node.type ?? "node", node.description ?? node.label ?? node.name ?? node.id);
    }
    for (const edge of doc.graph.edges ?? []) {
      const kind = ["supports", "evidence", "cites"].includes(edge.relation) ? "supports"
        : ["affects", "acts_on"].includes(edge.relation) ? "affects"
          : ["contains", "part_of", "depends_on", "unlocks", "interferes_with"].includes(edge.relation) ? "contains"
            : "related";
      addEdge(edge.from, edge.to, kind, edge.label ?? edge.relation);
    }
  }
  for (const entity of doc.graph ? [] : (doc.entities ?? [])) {
    addNode(entity.id, "entity", entity.display_name, entity.entity_type, `证据：${(entity.evidence ?? []).join(", ") || "暂无"}`);
    for (const evidenceId of entity.evidence ?? []) addEdge(entity.id, evidenceId, "supports", "实体由证据支持");
  }
  for (const quest of doc.graph ? [] : (doc.quests ?? [])) {
    addNode(quest.id, "quest", quest.display_name, "任务", `初始状态：${stateLabel(quest.initial_state)}`);
    for (const evidenceId of quest.evidence ?? []) addEdge(quest.id, evidenceId, "supports", "任务由证据支持");
  }
  for (const action of doc.graph ? [] : (doc.actions ?? [])) {
    addNode(action.action_id, "action", actionLabel(action), action.action_type, `不可逆：${action.irreversible ? "是" : "否"}`);
    for (const entityId of action.affected_entities ?? []) addEdge(action.action_id, entityId, "affects", "动作影响实体");
    for (const evidenceId of action.evidence ?? []) addEdge(action.action_id, evidenceId, "supports", "动作由证据支持");
  }
  for (const evidence of doc.graph ? [] : (doc.evidence ?? [])) {
    addNode(evidence.evidence_id, "evidence", evidence.evidence_id, evidence.evidence_assessment, evidence.summary);
  }
  for (const dependency of doc.graph ? [] : (doc.dependencies ?? [])) {
    addEdge(dependency.source_quest, dependency.target_quest, "contains", dependency.relation);
  }
  const visible = nodes.filter((node) => {
    const matchesType = typeFilter === "all" || node.type === typeFilter;
    const matchesQuery = !query || `${node.label} ${node.id} ${node.detail} ${node.description}`.toLowerCase().includes(query);
    return matchesType && matchesQuery;
  });
  const visibleIds = new Set(visible.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
  setText("#knowledge-count", `${visible.length} 节点 · ${visibleEdges.length} 关系`);
  if (!visible.length) {
    container.innerHTML = '<div class="empty-state">没有匹配的知识节点</div>';
    setText("#knowledge-legend", "");
    return;
  }
  const rows = ["entity", "quest", "action", "evidence"];
  const positions = {};
  const rowSpacing = 120;
  if (state.graphLayout === "grid") {
    visible.forEach((node, index) => {
      positions[node.id] = { x: 90 + (index % 5) * 190, y: 70 + Math.floor(index / 5) * rowSpacing };
    });
  } else if (state.graphLayout === "force") {
    visible.forEach((node, index) => {
      const angle = index * 2.3999632297 + state.graphSeed;
      const radius = 45 * Math.sqrt(index + 1);
      positions[node.id] = { x: 420 + Math.cos(angle) * radius, y: 230 + Math.sin(angle) * radius };
    });
  } else {
    rows.forEach((type, rowIndex) => {
      const rowNodes = visible.filter((node) => node.type === type);
      const spacing = Math.max(170, 900 / Math.max(rowNodes.length, 1));
      rowNodes.forEach((node, index) => {
        positions[node.id] = { x: 90 + index * spacing, y: 70 + rowIndex * rowSpacing };
      });
    });
  }
  const maxNodes = Math.max(...rows.map((type) => visible.filter((node) => node.type === type).length), 1);
  const width = Math.max(900, maxNodes * 180 + 120);
  const height = Math.max(390, rows.length * rowSpacing + 40);
  const svgEdges = visibleEdges.map((edge) => {
    const from = positions[edge.from], to = positions[edge.to];
    const labelX = (from.x + to.x) / 2;
    const labelY = (from.y + to.y) / 2 - 5;
    return `<g class="knowledge-relation" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}">
      <line class="knowledge-edge ${edge.kind}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>
      <text class="knowledge-edge-label" x="${labelX}" y="${labelY}" text-anchor="middle">${esc((edge.label ?? edge.kind).slice(0, 14))}</text>
    </g>`;
  }).join("");
  const svgNodes = visible.map((node) => {
    const position = positions[node.id];
    return `<g class="knowledge-node ${node.type}" data-node-id="${esc(node.id)}" transform="translate(${position.x - 68},${position.y - 25})">
      <rect width="136" height="50" rx="6"></rect>
      <text x="68" y="20" text-anchor="middle">${esc(node.label.slice(0, 19))}</text>
      <text class="node-detail" x="68" y="37" text-anchor="middle">${esc(node.detail.slice(0, 21))}</text>
    </g>`;
  }).join("");
  container.innerHTML = `<svg class="knowledge-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="剧情知识图谱关系渲染器">
    <defs><marker id="knowledge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"></path></marker></defs>
    ${svgEdges}${svgNodes}
  </svg>`;
  container.classList.toggle("hide-node-labels", !$("#knowledge-node-labels")?.checked);
  container.classList.toggle("hide-edge-labels", !$("#knowledge-edge-labels")?.checked);
  $("#knowledge-legend").innerHTML = `<span><i class="legend-dot entity"></i>角色 / 道具</span><span><i class="legend-dot quest"></i>任务</span><span><i class="legend-dot action"></i>动作</span><span><i class="legend-dot evidence"></i>证据</span>`;
  container.querySelectorAll(".knowledge-node").forEach((element) => {
    element.addEventListener("click", () => {
      const selected = visible.find((node) => node.id === element.dataset.nodeId);
      if (!selected) return;
      const relatedIds = new Set([selected.id]);
      const relatedEdges = edges.filter((edge) => edge.from === selected.id || edge.to === selected.id);
      relatedEdges.forEach((edge) => relatedIds.add(edge.from).add(edge.to));
      container.querySelectorAll(".knowledge-node").forEach((node) => node.classList.toggle("selected", node === element));
      container.querySelectorAll(".knowledge-node").forEach((node) => node.classList.toggle("neighbor", relatedIds.has(node.dataset.nodeId) && node !== element));
      container.querySelectorAll(".knowledge-relation").forEach((relation) => {
        const active = relation.dataset.from === selected.id || relation.dataset.to === selected.id;
        relation.classList.toggle("active", active);
      });
      const neighbors = edges.filter((edge) => edge.from === selected.id || edge.to === selected.id).length;
      const relationText = relatedEdges.map((edge) => `${edge.from === selected.id ? "→" : "←"} ${edge.label ?? edge.kind}`).join("、") || "暂无直接关系";
      $("#knowledge-details").className = "knowledge-details";
      $("#knowledge-details").innerHTML = `<h4>${esc(selected.label)}</h4><p>${esc(selected.description)}</p><p><b>关系：</b>${esc(relationText)}</p><small>${esc(selected.id)} · ${neighbors} 条关联</small>`;
    });
  });
}

function renderBreakages(questId) {
  const breakages = getQuestBreakages(questId);
  if (!breakages.length) return;
  const evidenceById = Object.fromEntries((state.document.evidence ?? []).map((item) => [item.evidence_id, item]));
  $("#path-container").insertAdjacentHTML("beforeend", `
    <div class="breakage-heading">可能导致该支线无法完成</div>
    ${breakages.map((item) => `
      <div class="breakage-item">
        <span class="breakage-icon">!</span>
        <div>
          <strong>${esc(actionLabel(item.action))}</strong>
          <p>${item.causesFailure
            ? `这个行为会满足失败转换“${esc(conditionLabel(item.guard))}”，使任务进入“${esc(stateLabel(item.transition.target_state))}”。`
            : `这个行为会让“${esc(variableLabel(item.effect.variable))}”变为“${esc(valueLabel(item.effect.value))}”，因而无法满足“${esc(conditionLabel(item.guard))}”，任务就不能继续到“${esc(stateLabel(item.transition.target_state))}”。`}</p>
          <small>这是不可逆的影响 · ${esc(evidenceById[item.action.evidence?.[0]]?.summary ?? "已有来源证据支持")}</small>
        </div>
      </div>
    `).join("")}
  `);
}

function evaluateReachability(questId, targetState, depthBound, stateBound) {
  const quest = state.document.quests.find((item) => item.id === questId);
  if (!quest) return { result: "not-modeled", issue_code: "UNKNOWN_QUEST", message: "任务不存在" };
  const initial = {
    quests: Object.fromEntries(state.document.quests.map((item) => [item.id, item.initial_state])),
    vars: Object.fromEntries(state.document.world_variables.map((item) => [item.id, item.initial]))
  };
  const queue = [{ state: initial, path: [], depth: 0 }];
  const visited = new Set([serialize(initial)]);
  let explored = 0;
  while (queue.length) {
    const current = queue.shift();
    explored += 1;
    if (current.state.quests[questId] === targetState) {
      return { result: "proved", message: `${quest.display_name} 可达 ${targetState}`, path: current.path, states_explored: explored };
    }

    function getQuestBreakages(questId) {
      const quest = state.document.quests.find((item) => item.id === questId);
      if (!quest) return [];
      const relevantTransitions = (state.document.transitions ?? []).filter(
        (transition) => transition.quest_id === questId
      );
      const requiredVariables = relevantTransitions.flatMap((transition) =>
        (transition.guards ?? []).map((guard) => ({ ...guard, transition }))
      );
      const breakages = [];
      for (const action of state.document.actions ?? []) {
        for (const effect of action.effects ?? []) {
          for (const requirement of requiredVariables) {
            if (effect.variable !== requirement.variable) continue;
            const variable = (state.document.world_variables ?? []).find(
              (item) => item.id === effect.variable
            );
            const breaksGuard = !conditionsHold([requirement], {
              [requirement.variable]: effect.value
            });
            if (breaksGuard && variable?.reversibility === "irreversible") {
              breakages.push({
                action,
                effect,
                guard: requirement,
                transition: requirement.transition,
                variable
              });
            }
          }
        }
      }
      return breakages;
    }

    function renderBreakages(questId) {
      const breakages = getQuestBreakages(questId);
      const container = $("#path-container");
      if (!breakages.length) return;
      container.insertAdjacentHTML("beforeend", `
        <div class="breakage-heading">可能导致该支线无法完成</div>
        ${breakages.map((item) => `
          <div class="breakage-item">
            <span class="breakage-icon">!</span>
            <div>
              <strong>${esc(item.action.action_id)} 修改了 ${esc(item.variable.display_name ?? item.effect.variable)}</strong>
              <p>将状态设为 <code>${esc(String(item.effect.value))}</code>，使转换
                <code>${esc(item.transition.transition_id)}</code> 的条件
                <code>${esc(item.guard.variable)} ${esc(item.guard.operator)} ${esc(String(item.guard.value))}</code> 不再满足。</p>
              <small>不可逆状态 · 证据：${esc((item.action.evidence ?? []).join(", "))}</small>
            </div>
          </div>
        `).join("")}
      `);
    }

    function renderGraph(report = null) {
      const container = $("#graph-container");
      if (!container || !state.document) return;
      const doc = state.document;
      const quest = doc.quests.find((item) => item.id === state.selectedQuest);
      if (!quest) {
        container.innerHTML = '<div class="empty-state">选择任务后显示关系图</div>';
        return;
      }
      const breakages = getQuestBreakages(quest.id);
      const brokenIds = new Set(breakages.map((item) => item.action.action_id));
      const nodes = [];
      const edges = [];
      const addNode = (id, type, label, detail) => {
        if (!nodes.some((node) => node.id === id)) nodes.push({ id, type, label, detail });
      };
      addNode(quest.id, "quest", quest.display_name, "任务目标");
      for (const transition of (doc.transitions ?? []).filter((item) => item.quest_id === quest.id)) {
        addNode(transition.transition_id, "transition", `${transition.source_state} → ${transition.target_state}`, transition.transition_id);
        edges.push({ from: quest.id, to: transition.transition_id, kind: "stage" });
        for (const guard of transition.guards ?? []) {
          const variable = (doc.world_variables ?? []).find((item) => item.id === guard.variable);
          addNode(guard.variable, "condition", `${variable?.display_name ?? guard.variable}`, `${guard.operator} ${String(guard.value)}`);
          edges.push({ from: guard.variable, to: transition.transition_id, kind: "requires" });
        }
      }
      for (const action of doc.actions ?? []) {
        const touchesQuest = (action.effects ?? []).some((effect) =>
          (doc.transitions ?? []).some((transition) =>
            transition.quest_id === quest.id && (transition.guards ?? []).some((guard) => guard.variable === effect.variable)
          )
        );
        if (!touchesQuest && action.quest_id !== quest.id) continue;
        addNode(action.action_id, brokenIds.has(action.action_id) ? "danger-action" : "action", action.action_type, action.action_id);
        edges.push({ from: action.action_id, to: quest.id, kind: "action" });
        for (const effect of action.effects ?? []) {
          const variable = (doc.world_variables ?? []).find((item) => item.id === effect.variable);
          addNode(effect.variable, "condition", variable?.display_name ?? variableLabel(effect.variable), `变为“${valueLabel(effect.value)}”`);
          edges.push({ from: action.action_id, to: effect.variable, kind: brokenIds.has(action.action_id) ? "breaks" : "changes" });
        }
      }
      for (const evidence of doc.evidence ?? []) {
        if (!nodes.some((node) => node.id === evidence.evidence_id)) continue;
        edges.push({ from: evidence.evidence_id, to: quest.id, kind: "evidence" });
      }
      const columns = 4;
      const rows = Math.max(1, Math.ceil(nodes.length / columns));
      const width = Math.max(760, columns * 190 + 120);
      const height = Math.max(330, rows * 105 + 55);
      const positions = {};
      nodes.forEach((node, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        positions[node.id] = { x: 100 + column * 190, y: 55 + row * 105 };
      });
      const svgEdges = edges.filter((edge) => positions[edge.from] && positions[edge.to]).map((edge) => {
        const from = positions[edge.from];
        const to = positions[edge.to];
        return `<line class="graph-edge ${edge.kind}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
      }).join("");
      const svgNodes = nodes.map((node) => {
        const position = positions[node.id];
        return `<g class="graph-node ${node.type}" transform="translate(${position.x - 68},${position.y - 25})">
          <rect width="136" height="50" rx="6"></rect>
          <text x="68" y="20" text-anchor="middle">${esc(node.label.slice(0, 19))}</text>
          <text class="node-detail" x="68" y="37" text-anchor="middle">${esc(node.detail.slice(0, 21))}</text>
        </g>`;
      }).join("");
      container.innerHTML = `<svg class="relation-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="任务原子语句关系图">
        <defs><marker id="atomic-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"></path></marker></defs>
        ${svgEdges}${svgNodes}
      </svg>`;
      $("#graph-legend").innerHTML = `<span><i class="legend-dot quest"></i>任务</span><span><i class="legend-dot condition"></i>状态/条件</span><span><i class="legend-dot action"></i>动作</span><span><i class="legend-line breaks"></i>破坏前置条件</span>`;
    }
    if (explored >= stateBound || current.depth >= depthBound) continue;
    for (const transition of state.document.transitions ?? []) {
      if (transition.quest_id !== questId || current.state.quests[questId] !== transition.source_state) continue;
      if (!conditionsHold(transition.guards, current.state.vars)) continue;
      const next = cloneState(current.state);
      next.quests[questId] = transition.target_state;
      applyEffects(next.vars, transition.effects);
      const key = serialize(next);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ state: next, depth: current.depth + 1, path: [...current.path, {
          id: transition.transition_id, kind: "transition",
          description: transitionLabel(transition),
          evidence: transition.evidence ?? []
        }] });
      }
    }
    for (const action of state.document.actions ?? []) {
      if (!conditionsHold(action.preconditions, current.state.vars)) continue;
      const next = cloneState(current.state);
      applyEffects(next.vars, action.effects);
      const key = serialize(next);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ state: next, depth: current.depth + 1, path: [...current.path, {
          id: action.action_id, kind: "action",
          description: actionLabel(action), evidence: action.evidence ?? []
        }] });
      }
    }
  }
  return {
    result: explored >= stateBound ? "unknown" : "counterexample",
    issue_code: "QUEST_OBJECTIVE_UNREACHABLE",
    message: `${quest.display_name} 在当前模型中无法达到 ${targetState}`,
    path: [], states_explored: explored
  };
}

function cloneState(stateValue) {
  return { quests: { ...stateValue.quests }, vars: { ...stateValue.vars } };
}

function serialize(value) { return JSON.stringify(value); }
function applyEffects(vars, effects = []) { effects.forEach((effect) => { vars[effect.variable] = effect.value; }); }
function conditionsHold(conditions = [], vars) {
  return conditions.every((condition) => {
    const actual = vars[condition.variable];
    const expected = condition.value;
    switch (condition.operator) {
      case "eq": return actual === expected;
      case "neq": return actual !== expected;
      case "in": return expected.includes(actual);
      case "not_in": return !expected.includes(actual);
      case "gt": return actual > expected;
      case "gte": return actual >= expected;
      case "lt": return actual < expected;
      case "lte": return actual <= expected;
      default: return false;
    }
  });
}

function renderResult(report) {
  const chip = $("#result-chip");
  chip.className = `result-chip ${report.result === "proved" ? "success" : "danger"}`;
  const resultLabel = {
    proved: "可以完成",
    counterexample: "发现问题",
    unknown: "无法确定",
    "not-modeled": "尚未建模"
  }[report.result] ?? report.result;
  setText("#result-chip", resultLabel);
  setText("#result-label", resultLabel);
  setText("#result-detail", report.result === "proved" ? "已找到一条可行路径" : "请查看下方说明");
  $("#result-summary").className = "result-summary";
  $("#result-summary").innerHTML = `
    <strong>${esc(report.message)}</strong>
    <span>验证状态：${esc(resultLabel)} · 已检查 ${esc(report.states_explored ?? 0)} 个可能状态</span>
  `;
  $("#path-container").innerHTML = (report.path ?? []).map((step, index) => `
    <div class="path-step">
      <span class="step-number">${index + 1}</span>
      <div><strong>${esc(readableStep(step))}</strong><small>${esc(step.kind === "action" ? "玩家行为" : "任务状态变化")}</small></div>
    </div>
  `).join("");
  renderBreakages(state.selectedQuest);
  renderGraph(report);
}

async function loadDemo() {
  try {
    const response = await fetch(DEMO_URL);
    if (!response.ok) throw new Error(`无法加载 Demo：HTTP ${response.status}`);
    renderDocument(await response.json());
  } catch (error) {
    showError(`${error.message}。请使用本地 HTTP 服务打开页面，不要直接双击 HTML。`);
  }
}

$("#verify-button").addEventListener("click", () => {
  if (!state.document || !state.selectedQuest) return;
  const report = evaluateReachability(
    state.selectedQuest,
    $("#target-state").value,
    Number($("#depth-bound").value),
    Number($("#state-bound").value)
  );
  renderResult(report);
});

$("#knowledge-type").addEventListener("change", renderKnowledgeGraph);
$("#knowledge-search").addEventListener("input", renderKnowledgeGraph);
$("#knowledge-layout").addEventListener("change", (event) => {
  state.graphLayout = event.target.value;
  renderKnowledgeGraph();
});
$("#knowledge-node-labels").addEventListener("change", renderKnowledgeGraph);
$("#knowledge-edge-labels").addEventListener("change", renderKnowledgeGraph);
$("#knowledge-reset").addEventListener("click", () => {
  state.graphSeed = 0;
  renderKnowledgeGraph();
});
$("#knowledge-fit").addEventListener("click", () => {
  state.graphSeed += 0.35;
  renderKnowledgeGraph();
});
$("#reload-button").addEventListener("click", loadDemo);
$("#file-input").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try { renderDocument(JSON.parse(await file.text())); }
  catch (error) { showError(`知识图谱 JSON 无法解析：${error.message}`); }
});

loadDemo();

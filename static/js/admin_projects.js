(() => {
  const { escapeHtml, renderLoadingState } = window.LogConverter;

  const projectBody = document.getElementById("projectBody");
  const pageAlert = document.getElementById("pageAlert");
  const projectStatsPanel = document.getElementById("projectStatsPanel");
  const nameFilter = document.getElementById("nameFilter");
  const statusFilter = document.getElementById("statusFilter");
  const createProjectModalEl = document.getElementById("createProjectModal");
  const createProjectModal = new bootstrap.Modal(createProjectModalEl);

  let allProjects = [];
  let users = [];

  function showAlert(message, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = message;
    pageAlert.classList.remove("d-none");
  }

  function showModalAlert(message, type = "danger") {
    const alertBox = document.getElementById("createProjectAlert");
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function getFilterParams() {
    return {
      keyword: nameFilter.value.trim(),
      status: statusFilter.value.trim(),
    };
  }

  function joinAliases(aliases) {
    return (aliases || []).join("；");
  }

  function parseAliases(raw) {
    return raw
      .replace(/；/g, ";")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function syncDomToProjects() {
    projectBody.querySelectorAll("tr").forEach((row) => {
      const projectId = row.dataset.id;
      if (!projectId) return;

      const nameInput = row.querySelector(".project-name");
      const aliasInput = row.querySelector(".project-alias");
      const managerSelect = row.querySelector(".project-manager");
      const statusSelect = row.querySelector(".project-status");
      if (!nameInput || !aliasInput || !managerSelect || !statusSelect) return;

      const project = allProjects.find((item) => String(item.id) === String(projectId));
      if (!project) return;

      project.name = nameInput.value.trim();
      project.aliases = parseAliases(aliasInput.value);
      project.manager_user_id = managerSelect.value || null;
      project.status = statusSelect.value;
    });
  }

  function getFilteredProjects() {
    const { keyword, status } = getFilterParams();
    const keywordLower = keyword.toLowerCase();
    return allProjects.filter((project) => {
      if (status && project.status !== status) return false;
      if (!keywordLower) return true;
      const nameMatch = String(project.name || "").toLowerCase().includes(keywordLower);
      const aliasMatch = (project.aliases || []).some((alias) =>
        String(alias).toLowerCase().includes(keywordLower)
      );
      return nameMatch || aliasMatch;
    });
  }

  function renderManagerOptions(selectEl, selectedId = "") {
    selectEl.innerHTML = `
      <option value="">未设置</option>
      ${users
        .map(
          (user) => `
        <option value="${user.id}" ${String(selectedId) === String(user.id) ? "selected" : ""}>
          ${escapeHtml(user.display_name)} (${escapeHtml(user.username)})
        </option>
      `
        )
        .join("")}
    `;
  }

  function renderProjects(projects) {
    if (!projects.length) {
      projectBody.innerHTML = '<tr><td colspan="5" class="text-center empty-cell">暂无匹配项目</td></tr>';
      return;
    }

    projectBody.innerHTML = projects
      .map(
        (project) => `
        <tr data-id="${project.id}">
          <td><input class="form-control neon-input project-name" value="${escapeHtml(project.name)}"></td>
          <td><input class="form-control neon-input project-alias" value="${escapeHtml(joinAliases(project.aliases))}"></td>
          <td>
            <select class="form-select neon-input project-manager">
              <option value="">未设置</option>
              ${users
                .map(
                  (user) => `
                <option value="${user.id}" ${String(project.manager_user_id || "") === String(user.id) ? "selected" : ""}>
                  ${escapeHtml(user.display_name)} (${escapeHtml(user.username)})
                </option>
              `
                )
                .join("")}
            </select>
          </td>
          <td>
            <select class="form-select neon-input project-status">
              <option value="enabled" ${project.status === "enabled" ? "selected" : ""}>启用</option>
              <option value="disabled" ${project.status === "disabled" ? "selected" : ""}>禁用</option>
            </select>
          </td>
          <td><button class="btn btn-icon-delete btn-sm remove-project" data-id="${project.id}"><i class="bi bi-trash3"></i></button></td>
        </tr>
      `
      )
      .join("");
  }

  function renderStats(summary) {
    projectStatsPanel.innerHTML = `
      <h3 class="mini-title mb-3">总体统计</h3>
      <div class="row g-3 mb-3 project-stats-grid">
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-1">
            <div class="stat-icon"><i class="bi bi-kanban"></i></div>
            <div class="stat-value">${summary.project_count}</div>
            <div class="stat-label">项目总数</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-2">
            <div class="stat-icon"><i class="bi bi-check-circle"></i></div>
            <div class="stat-value">${summary.enabled_count}</div>
            <div class="stat-label">启用</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-3">
            <div class="stat-icon"><i class="bi bi-pause-circle"></i></div>
            <div class="stat-value">${summary.disabled_count}</div>
            <div class="stat-label">禁用</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-4">
            <div class="stat-icon"><i class="bi bi-person-check"></i></div>
            <div class="stat-value">${summary.manager_set_count}</div>
            <div class="stat-label">已设负责人</div>
          </div>
        </div>
      </div>
      <div class="row g-3 project-stats-grid">
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-1">
            <div class="stat-icon"><i class="bi bi-journal-text"></i></div>
            <div class="stat-value">${summary.log_count}</div>
            <div class="stat-label">关联日志条数</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-2">
            <div class="stat-icon"><i class="bi bi-clock-history"></i></div>
            <div class="stat-value">${summary.log_hours}</div>
            <div class="stat-label">累计工时（小时）</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-3">
            <div class="stat-icon"><i class="bi bi-check2-circle"></i></div>
            <div class="stat-value">${summary.log_approved_count}</div>
            <div class="stat-label">已通过日志</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-4">
            <div class="stat-icon"><i class="bi bi-hourglass-split"></i></div>
            <div class="stat-value">${summary.log_approved_hours}</div>
            <div class="stat-label">已通过工时</div>
          </div>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <span class="tag tag-blue">待审核 ${summary.log_pending_count} 条</span>
        <span class="tag tag-blue">已驳回 ${summary.log_rejected_count} 条</span>
        <span class="tag tag-blue">别名 ${summary.alias_count} 个</span>
        <span class="tag tag-blue">未设负责人 ${summary.manager_unset_count} 个</span>
      </div>
    `;
  }

  async function loadSummary() {
    renderLoadingState(projectStatsPanel, "统计加载中...");
    const response = await fetch("/api/admin/projects/summary");
    const data = await response.json();
    if (!response.ok) {
      projectStatsPanel.innerHTML = '<div class="history-empty">统计加载失败</div>';
      showAlert(data.error || "统计加载失败");
      return;
    }
    renderStats(data.summary || {});
  }

  function mergeLocalProjectEdits(serverProject) {
    const local = allProjects.find((item) => String(item.id) === String(serverProject.id));
    if (!local) return serverProject;
    return {
      ...serverProject,
      name: typeof local.name === "string" ? local.name : serverProject.name,
      aliases: Array.isArray(local.aliases)
        ? local.aliases
        : typeof local.aliases === "string"
          ? parseAliases(local.aliases)
          : serverProject.aliases,
      manager_user_id: local.manager_user_id ?? serverProject.manager_user_id,
      status: local.status || serverProject.status,
    };
  }

  async function applyFilter() {
    if (!nameFilter || !statusFilter) return;

    pageAlert.classList.add("d-none");
    syncDomToProjects();

    const { keyword, status } = getFilterParams();
    renderLoadingState(projectBody, "查询中...");

    const params = new URLSearchParams();
    if (keyword) params.set("keyword", keyword);
    if (status) params.set("status", status);

    try {
      const response = await fetch(`/api/admin/projects?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        projectBody.innerHTML = '<tr><td colspan="5" class="text-center empty-cell">查询失败</td></tr>';
        showAlert(data.error || "查询失败");
        return;
      }

      const displayItems = (data.items || []).map(mergeLocalProjectEdits);
      renderProjects(displayItems);
    } catch (error) {
      renderProjects(getFilteredProjects());
      showAlert("查询失败，已使用本地筛选结果", "warning");
    }
  }

  function collectProjects() {
    syncDomToProjects();
    return allProjects.map((project) => ({
      id: project.id,
      name: typeof project.name === "string" ? project.name.trim() : project.name,
      aliases: typeof project.aliases === "string" ? project.aliases.trim() : project.aliases || [],
      manager_user_id: project.manager_user_id || null,
      status: project.status,
    }));
  }

  async function loadData() {
    renderLoadingState(projectBody, "加载中...");
    const [projectRes, userRes] = await Promise.all([
      fetch("/api/admin/projects"),
      fetch("/api/admin/options/users"),
    ]);
    const projectData = await projectRes.json();
    const userData = await userRes.json();
    if (!projectRes.ok) {
      showAlert(projectData.error || "加载项目失败");
      return;
    }
    allProjects = projectData.items || [];
    users = userData.items || [];
    await loadSummary();
    await applyFilter();
  }

  function resetCreateProjectForm() {
    document.getElementById("createProjectName").value = "";
    document.getElementById("createProjectAliases").value = "";
    document.getElementById("createProjectStatus").value = "enabled";
    document.getElementById("createProjectAlert").classList.add("d-none");
    renderManagerOptions(document.getElementById("createProjectManager"));
  }

  function openCreateProjectModal() {
    resetCreateProjectForm();
    createProjectModal.show();
  }

  async function createProject() {
    const name = document.getElementById("createProjectName").value.trim();
    const aliases = parseAliases(document.getElementById("createProjectAliases").value);
    const manager_user_id = document.getElementById("createProjectManager").value || null;
    const status = document.getElementById("createProjectStatus").value;

    if (!name) {
      showModalAlert("项目名称不能为空", "warning");
      return;
    }

    const response = await fetch("/api/admin/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, aliases, manager_user_id, status }),
    });
    const data = await response.json();
    if (!response.ok) {
      showModalAlert(data.error || "新增失败");
      return;
    }

    createProjectModal.hide();
    await loadData();
    showAlert("项目新增成功", "success");
  }

  document.getElementById("addProjectBtn").addEventListener("click", openCreateProjectModal);
  document.getElementById("confirmCreateProjectBtn").addEventListener("click", createProject);

  projectBody.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".remove-project");
    if (!removeBtn) return;
    if (!window.confirm("确定从列表中移除该项目吗？点击保存后生效。")) return;
    syncDomToProjects();
    const projectId = removeBtn.dataset.id;
    if (projectId) {
      allProjects = allProjects.filter((project) => String(project.id) !== String(projectId));
    }
    applyFilter();
  });

  document.getElementById("saveProjectsBtn").addEventListener("click", async () => {
    pageAlert.classList.add("d-none");
    syncDomToProjects();
    const response = await fetch("/api/admin/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projects: collectProjects() }),
    });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "保存失败");
      return;
    }
    allProjects = data.items || [];
    await loadSummary();
    await applyFilter();
    showAlert("保存成功", "success");
  });

  document.getElementById("searchBtn").addEventListener("click", () => {
    applyFilter();
  });
  statusFilter.addEventListener("change", () => {
    applyFilter();
  });
  nameFilter.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyFilter();
  });

  loadData();
})();

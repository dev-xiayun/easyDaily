(() => {
  const {
    escapeHtml,
    renderLoadingState,
    getDayTabStatusClass,
    isFutureDayTab,
    resolveActiveDayDate,
  } = window.LogConverter;

  const yearSelect = document.getElementById("yearSelect");
  const monthSelect = document.getElementById("monthSelect");
  const dayTabs = document.getElementById("dayTabs");
  const dayPanel = document.getElementById("dayPanel");
  const pageAlert = document.getElementById("pageAlert");
  const projectSummaryPanel = document.getElementById("projectSummaryPanel");
  const addLogFab = document.getElementById("addLogFab");
  const logModalEl = document.getElementById("logModal");
  const logModal = new bootstrap.Modal(logModalEl);

  let monthData = null;
  let activeDate = null;
  let editingLog = null;
  let modalMode = "create";
  let selectedProject = null;
  let searchTimer = null;

  function showAlert(message, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = message;
    pageAlert.classList.remove("d-none");
  }

  function initSelectors() {
    const now = new Date();
    for (let year = now.getFullYear() + 1; year >= now.getFullYear() - 2; year -= 1) {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = `${year}年`;
      if (year === now.getFullYear()) option.selected = true;
      yearSelect.appendChild(option);
    }
    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement("option");
      option.value = month;
      option.textContent = `${month}月`;
      if (month === now.getMonth() + 1) option.selected = true;
      monthSelect.appendChild(option);
    }
  }

  function renderMobileSummary(summary, year, month) {
    const projects = summary?.projects || [];
    if (!projects.length) {
      projectSummaryPanel.innerHTML = '<div class="history-empty">本月暂无日志</div>';
      return;
    }

    const rows = projects
      .map(
        (item) => `
        <div class="d-flex justify-content-between gap-2 py-1 border-bottom border-secondary border-opacity-25">
          <span class="small">${escapeHtml(item.project_name)}</span>
          <span class="small text-nowrap">${item.hours}h · ${item.percent}%</span>
        </div>
      `
      )
      .join("");

    projectSummaryPanel.innerHTML = `
      <div class="mobile-summary-stats">
        <div class="mobile-stat-item">
          <div class="mobile-stat-value">${summary.total_hours}</div>
          <div class="mobile-stat-label">总工时</div>
        </div>
        <div class="mobile-stat-item">
          <div class="mobile-stat-value">${summary.project_count}</div>
          <div class="mobile-stat-label">项目数</div>
        </div>
        <div class="mobile-stat-item">
          <div class="mobile-stat-value">${summary.total_logs}</div>
          <div class="mobile-stat-label">条数</div>
        </div>
      </div>
      <div class="small text-muted mb-2">${year}年${month}月项目分布</div>
      ${rows}
    `;
  }

  async function loadMonth() {
    pageAlert.classList.add("d-none");
    renderLoadingState(projectSummaryPanel, "统计加载中...");
    renderLoadingState(dayPanel, "日志加载中...");
    const response = await fetch(`/api/my/logs?year=${yearSelect.value}&month=${monthSelect.value}`);
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "加载失败");
      return;
    }

    monthData = data;
    renderMobileSummary(data.summary, data.year, data.month);

    activeDate = resolveActiveDayDate(data.days, activeDate);
    renderTabs();
    renderPanel();
  }

  function renderTabs() {
    dayTabs.innerHTML = monthData.days
      .map(
        (day) => `
        <button type="button" class="mobile-day-tab ${day.date === activeDate ? "active" : ""} ${getDayTabStatusClass(day)}"
          data-date="${day.date}" ${isFutureDayTab(day) ? "disabled" : ""}>
          <span class="day-num">${day.day}</span>
          <span class="day-week">${day.weekday.replace("周", "")}</span>
        </button>
      `
      )
      .join("");
  }

  function reviewStatusClass(status) {
    if (status === "approved") return "review-approved";
    if (status === "rejected") return "review-rejected";
    return "review-pending";
  }

  function renderLogActions(log) {
    const actions = [];
    if (log.editable) actions.push(`<button class="btn btn-outline-neon btn-action-sm edit-log" data-id="${log.id}">编辑</button>`);
    if (log.deletable) actions.push(`<button class="btn btn-action-sm btn-danger-sm delete-log" data-id="${log.id}">删除</button>`);
    if (log.resubmittable) actions.push(`<button class="btn btn-neon btn-action-sm resubmit-log" data-id="${log.id}">重提</button>`);
    return actions.length ? `<div class="mobile-log-actions">${actions.join("")}</div>` : "";
  }

  function renderPanel() {
    const day = monthData.days.find((item) => item.date === activeDate);
    if (!day) {
      dayPanel.innerHTML = '<div class="history-empty">暂无日期数据</div>';
      addLogFab.classList.add("d-none");
      return;
    }

    addLogFab.classList.toggle("d-none", !day.addable);

    const logsHtml = day.logs.length
      ? day.logs
          .map(
            (log) => `
          <div class="mobile-log-card">
            <div class="mobile-log-head">
              <div>
                <strong>${escapeHtml(log.project_name)}</strong>
                <span class="review-badge ${reviewStatusClass(log.review_status)}">${escapeHtml(log.review_status_label)}</span>
              </div>
              <span class="tag tag-blue">${log.hours}h</span>
            </div>
            <div class="small">${escapeHtml(log.work_content || "")}</div>
            ${log.reject_reason ? `<div class="reject-reason mt-2">驳回：${escapeHtml(log.reject_reason)}</div>` : ""}
            ${renderLogActions(log)}
          </div>
        `
          )
          .join("")
      : '<div class="history-empty">当日暂无日报</div>';

    dayPanel.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div>
          <div class="fw-bold">${day.date}</div>
          <div class="small text-muted">${day.weekday} · ${day.editable ? "可编辑" : "只读"}</div>
        </div>
      </div>
      ${logsHtml}
    `;

    dayPanel.querySelectorAll(".edit-log").forEach((btn) => {
      btn.addEventListener("click", () => {
        const log = day.logs.find((item) => String(item.id) === btn.dataset.id);
        if (log) openEditModal(log);
      });
    });
    dayPanel.querySelectorAll(".delete-log").forEach((btn) => {
      btn.addEventListener("click", () => deleteLog(btn.dataset.id));
    });
    dayPanel.querySelectorAll(".resubmit-log").forEach((btn) => {
      btn.addEventListener("click", () => {
        const log = day.logs.find((item) => String(item.id) === btn.dataset.id);
        if (log) openResubmitModal(log);
      });
    });
  }

  function setModalButtons(mode) {
    modalMode = mode;
    document.getElementById("saveLogBtn").classList.toggle("d-none", mode !== "create" && mode !== "edit");
    document.getElementById("resubmitLogBtn").classList.toggle("d-none", mode !== "resubmit");
  }

  function clearProjectSelection() {
    selectedProject = null;
    document.getElementById("projectOptions")?.querySelectorAll(".mobile-project-item").forEach((node) => {
      node.classList.remove("active");
    });
    updateNextStepState();
  }

  function updateNextStepState() {
    const nextBtn = document.getElementById("nextStepBtn");
    if (!nextBtn || nextBtn.classList.contains("d-none")) return;
    nextBtn.disabled = !selectedProject;
  }

  function resetModalSteps() {
    document.getElementById("step1").classList.remove("d-none");
    document.getElementById("step2").classList.add("d-none");
    document.getElementById("nextStepBtn").classList.remove("d-none");
    document.getElementById("prevStepBtn").classList.add("d-none");
    document.getElementById("modalAlert").classList.add("d-none");
    document.getElementById("projectSearch").value = "";
    document.getElementById("hoursInput").value = "";
    document.getElementById("contentInput").value = "";
    selectedProject = null;
    loadProjectOptions("");
    setModalButtons("create");
    updateNextStepState();
  }

  function openCreateModal(date) {
    editingLog = null;
    activeDate = date;
    document.getElementById("logModalTitle").textContent = `新增日报`;
    resetModalSteps();
    logModal.show();
  }

  function openEditModal(log) {
    editingLog = { id: log.id };
    document.getElementById("logModalTitle").textContent = "编辑日报";
    document.getElementById("step1").classList.add("d-none");
    document.getElementById("step2").classList.remove("d-none");
    document.getElementById("nextStepBtn").classList.add("d-none");
    document.getElementById("prevStepBtn").classList.add("d-none");
    document.getElementById("selectedProjectName").textContent = log.project_name;
    document.getElementById("hoursInput").value = log.hours;
    document.getElementById("contentInput").value = log.work_content || "";
    setModalButtons("edit");
    logModal.show();
  }

  function openResubmitModal(log) {
    editingLog = { id: log.id };
    document.getElementById("logModalTitle").textContent = "重新提交";
    document.getElementById("step1").classList.add("d-none");
    document.getElementById("step2").classList.remove("d-none");
    document.getElementById("nextStepBtn").classList.add("d-none");
    document.getElementById("prevStepBtn").classList.add("d-none");
    document.getElementById("selectedProjectName").textContent = log.project_name;
    document.getElementById("hoursInput").value = log.hours;
    document.getElementById("contentInput").value = log.work_content || "";
    setModalButtons("resubmit");
    logModal.show();
  }

  async function loadProjectOptions(keyword) {
    const container = document.getElementById("projectOptions");
    renderLoadingState(container, "项目搜索中...");
    const response = await fetch(`/api/projects/enabled?keyword=${encodeURIComponent(keyword)}`);
    const data = await response.json();
    const items = data.items || [];
    if (!items.length) {
      container.innerHTML = '<div class="history-empty">暂无匹配项目</div>';
      updateNextStepState();
      return;
    }
    container.innerHTML = items
      .map(
        (project) => `
        <button type="button" class="mobile-project-item ${selectedProject?.id === project.id ? "active" : ""}"
          data-id="${project.id}" data-name="${escapeHtml(project.name)}">
          ${escapeHtml(project.name)}
        </button>
      `
      )
      .join("");
    container.querySelectorAll(".mobile-project-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedProject = { id: Number(btn.dataset.id), name: btn.dataset.name };
        container.querySelectorAll(".mobile-project-item").forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        updateNextStepState();
      });
    });
    updateNextStepState();
  }

  async function submitLogPayload(payload, alertBox) {
    let response;
    if (modalMode === "resubmit" && editingLog) {
      response = await fetch(`/api/my/logs/${editingLog.id}/resubmit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else if (modalMode === "edit" && editingLog) {
      response = await fetch(`/api/my/logs/${editingLog.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      response = await fetch("/api/my/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          project_id: selectedProject.id,
          log_date: activeDate,
        }),
      });
    }

    const data = await response.json();
    if (!response.ok) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = data.error || "保存失败";
      alertBox.classList.remove("d-none");
      return false;
    }

    logModal.hide();
    await loadMonth();
    return true;
  }

  async function deleteLog(logId) {
    if (!window.confirm("确定删除这条日报吗？")) return;
    const response = await fetch(`/api/my/logs/${logId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "删除失败");
      return;
    }
    await loadMonth();
  }

  document.getElementById("projectSearch").addEventListener("input", (event) => {
    clearProjectSelection();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadProjectOptions(event.target.value.trim()), 250);
  });

  document.getElementById("nextStepBtn").addEventListener("click", () => {
    if (!selectedProject) return;
    document.getElementById("step1").classList.add("d-none");
    document.getElementById("step2").classList.remove("d-none");
    document.getElementById("nextStepBtn").classList.add("d-none");
    document.getElementById("prevStepBtn").classList.remove("d-none");
    setModalButtons("create");
    document.getElementById("selectedProjectName").textContent = selectedProject.name;
  });

  document.getElementById("prevStepBtn").addEventListener("click", () => {
    document.getElementById("step1").classList.remove("d-none");
    document.getElementById("step2").classList.add("d-none");
    document.getElementById("nextStepBtn").classList.remove("d-none");
    document.getElementById("prevStepBtn").classList.add("d-none");
    setModalButtons("create");
    updateNextStepState();
  });

  async function handleSave(isResubmit) {
    const hours = Number(document.getElementById("hoursInput").value);
    const work_content = document.getElementById("contentInput").value.trim();
    const alertBox = document.getElementById("modalAlert");
    if (!hours || hours <= 0) {
      alertBox.className = "alert alert-warning";
      alertBox.textContent = "请输入有效工时";
      alertBox.classList.remove("d-none");
      return;
    }
    if (isResubmit) setModalButtons("resubmit");
    await submitLogPayload({ hours: Number(hours.toFixed(2)), work_content }, alertBox);
  }

  document.getElementById("saveLogBtn").addEventListener("click", () => handleSave(false));
  document.getElementById("resubmitLogBtn").addEventListener("click", () => handleSave(true));

  dayTabs.addEventListener("click", (event) => {
    const btn = event.target.closest(".mobile-day-tab");
    if (!btn || btn.disabled) return;
    activeDate = btn.dataset.date;
    renderTabs();
    renderPanel();
  });

  addLogFab.addEventListener("click", () => {
    const day = monthData?.days.find((item) => item.date === activeDate);
    if (day?.addable) openCreateModal(day.date);
  });

  document.getElementById("reloadBtn").addEventListener("click", loadMonth);
  yearSelect.addEventListener("change", loadMonth);
  monthSelect.addEventListener("change", loadMonth);

  initSelectors();
  loadMonth();
})();

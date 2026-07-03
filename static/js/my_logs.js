(() => {
  const {
    escapeHtml,
    renderProjectLogSummary,
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
      option.textContent = `${year} 年`;
      if (year === now.getFullYear()) option.selected = true;
      yearSelect.appendChild(option);
    }
    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement("option");
      option.value = month;
      option.textContent = `${month} 月`;
      if (month === now.getMonth() + 1) option.selected = true;
      monthSelect.appendChild(option);
    }
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
    renderProjectLogSummary(projectSummaryPanel, data.summary, {
      title: `${data.year} 年 ${data.month} 月项目工时统计`,
      emptyText: "本月暂无日志数据",
    });
    activeDate = resolveActiveDayDate(data.days, activeDate);
    renderTabs();
    renderPanel();
  }

  function renderTabs() {
    dayTabs.innerHTML = monthData.days
      .map(
        (day) => `
        <button type="button" class="day-tab ${day.date === activeDate ? "active" : ""} ${day.editable ? "" : "locked"} ${getDayTabStatusClass(day)}"
          data-date="${day.date}" ${isFutureDayTab(day) ? "disabled" : ""}>
          <span class="day-num">${day.day}</span>
          <span class="day-week">${day.weekday}</span>
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

  function renderLogActions(log, day) {
    const actions = [];
    if (log.editable) {
      actions.push(`<button class="btn btn-outline-neon btn-action-sm edit-log" data-id="${log.id}">编辑</button>`);
    }
    if (log.deletable) {
      actions.push(`<button class="btn btn-action-sm btn-danger-sm delete-log" data-id="${log.id}">删除</button>`);
    }
    if (log.resubmittable) {
      actions.push(`<button class="btn btn-neon btn-action-sm resubmit-log" data-id="${log.id}">重新提交</button>`);
    }
    if (!actions.length) {
      return `<div class="text-muted small mt-2">${log.review_status === "approved" ? "已通过审核" : "当前不可编辑"}</div>`;
    }
    return `<div class="log-item-actions">${actions.join("")}</div>`;
  }

  function renderPanel() {
    const day = monthData.days.find((item) => item.date === activeDate);
    if (!day) {
      dayPanel.innerHTML = '<div class="history-empty">暂无日期数据</div>';
      return;
    }

    const logsHtml = day.logs.length
      ? day.logs
          .map(
            (log) => `
          <div class="log-item">
            <div class="log-item-head">
              <div>
                <strong>${escapeHtml(log.project_name)}</strong>
                <span class="review-badge ${reviewStatusClass(log.review_status)}">${escapeHtml(log.review_status_label)}</span>
              </div>
              <span class="tag tag-blue">${log.hours} 小时</span>
            </div>
            <div class="log-item-content">${escapeHtml(log.work_content || "")}</div>
            ${log.reject_reason ? `<div class="reject-reason">驳回原因：${escapeHtml(log.reject_reason)}</div>` : ""}
            ${renderLogActions(log, day)}
          </div>
        `
          )
          .join("")
      : '<div class="history-empty">当日暂无日志</div>';

    dayPanel.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h3 class="mini-title mb-1">${day.date} ${day.weekday}</h3>
          <p class="section-subtitle mb-0">${day.editable ? "当前可编辑" : "当前为只读"}</p>
        </div>
        ${day.addable ? `<button class="btn btn-neon" id="addLogBtn"><i class="bi bi-plus-lg me-2"></i>新增日志</button>` : ""}
      </div>
      <div class="log-list">${logsHtml}</div>
    `;

    document.getElementById("addLogBtn")?.addEventListener("click", () => openCreateModal(day.date));
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

  function clearProjectSelection() {
    selectedProject = null;
    document.getElementById("projectOptions")?.querySelectorAll(".project-option").forEach((node) => {
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

  function setModalButtons(mode) {
    modalMode = mode;
    document.getElementById("saveLogBtn").classList.toggle("d-none", mode !== "create" && mode !== "edit");
    document.getElementById("resubmitLogBtn").classList.toggle("d-none", mode !== "resubmit");
  }

  function openCreateModal(date) {
    editingLog = null;
    activeDate = date;
    document.getElementById("logModalTitle").textContent = `新增日志 - ${date}`;
    resetModalSteps();
    setModalButtons("create");
    logModal.show();
  }

  function openEditModal(log) {
    editingLog = { id: log.id };
    document.getElementById("logModalTitle").textContent = "编辑日志";
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
    document.getElementById("logModalTitle").textContent = "重新提交日志";
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
        <button type="button" class="project-option ${selectedProject?.id === project.id ? "active" : ""}" data-id="${project.id}" data-name="${escapeHtml(project.name)}">
          ${escapeHtml(project.name)}
        </button>
      `
      )
      .join("");
    container.querySelectorAll(".project-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedProject = { id: Number(btn.dataset.id), name: btn.dataset.name };
        container.querySelectorAll(".project-option").forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        updateNextStepState();
      });
    });
    updateNextStepState();
  }

  document.getElementById("projectSearch").addEventListener("input", (event) => {
    clearProjectSelection();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadProjectOptions(event.target.value.trim()), 250);
  });

  document.getElementById("nextStepBtn").addEventListener("click", () => {
    if (!selectedProject) return;
    const alertBox = document.getElementById("modalAlert");
    alertBox.classList.add("d-none");
    document.getElementById("step1").classList.add("d-none");
    document.getElementById("step2").classList.remove("d-none");
    document.getElementById("nextStepBtn").classList.add("d-none");
    document.getElementById("prevStepBtn").classList.remove("d-none");
    setModalButtons(modalMode === "edit" ? "edit" : "create");
    document.getElementById("selectedProjectName").textContent = selectedProject.name;
  });

  document.getElementById("prevStepBtn").addEventListener("click", () => {
    document.getElementById("step1").classList.remove("d-none");
    document.getElementById("step2").classList.add("d-none");
    document.getElementById("nextStepBtn").classList.remove("d-none");
    document.getElementById("prevStepBtn").classList.add("d-none");
    setModalButtons(modalMode === "edit" ? "edit" : "create");
    updateNextStepState();
  });

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

  document.getElementById("saveLogBtn").addEventListener("click", async () => {
    const hours = Number(document.getElementById("hoursInput").value);
    const work_content = document.getElementById("contentInput").value.trim();
    const alertBox = document.getElementById("modalAlert");

    if (!hours || hours <= 0) {
      alertBox.className = "alert alert-warning";
      alertBox.textContent = "请输入有效工时";
      alertBox.classList.remove("d-none");
      return;
    }

    await submitLogPayload(
      {
        hours: Number(hours.toFixed(2)),
        work_content,
      },
      alertBox
    );
  });

  document.getElementById("resubmitLogBtn").addEventListener("click", async () => {
    const hours = Number(document.getElementById("hoursInput").value);
    const work_content = document.getElementById("contentInput").value.trim();
    const alertBox = document.getElementById("modalAlert");

    if (!hours || hours <= 0) {
      alertBox.className = "alert alert-warning";
      alertBox.textContent = "请输入有效工时";
      alertBox.classList.remove("d-none");
      return;
    }

    await submitLogPayload(
      {
        hours: Number(hours.toFixed(2)),
        work_content,
      },
      alertBox
    );
  });

  async function deleteLog(logId) {
    if (!window.confirm("确定删除这条日志吗？")) return;
    const response = await fetch(`/api/my/logs/${logId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "删除失败");
      return;
    }
    await loadMonth();
  }

  dayTabs.addEventListener("click", (event) => {
    const btn = event.target.closest(".day-tab");
    if (!btn || btn.disabled) return;
    activeDate = btn.dataset.date;
    renderTabs();
    renderPanel();
  });

  document.getElementById("reloadBtn").addEventListener("click", loadMonth);
  yearSelect.addEventListener("change", loadMonth);
  monthSelect.addEventListener("change", loadMonth);

  initSelectors();
  loadMonth();
})();

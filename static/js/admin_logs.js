(() => {
  const { escapeHtml, renderProjectLogSummary, renderProjectPersonHoursChart, summarizePersonHours, renderLoadingState } = window.LogConverter;

  const logBody = document.getElementById("logBody");
  const pageAlert = document.getElementById("pageAlert");
  const projectSummaryPanel = document.getElementById("projectSummaryPanel");
  const projectPersonChartPanel = document.getElementById("projectPersonChartPanel");
  const yearSelect = document.getElementById("yearSelect");
  const monthSelect = document.getElementById("monthSelect");
  const dayInput = document.getElementById("dayInput");

  let userCombo = null;
  let projectCombo = null;
  let logsCache = [];

  function showAlert(message, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = message;
    pageAlert.classList.remove("d-none");
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function initDateSelectors() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    for (let year = currentYear + 1; year >= currentYear - 5; year -= 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = `${year} 年`;
      if (year === currentYear) option.selected = true;
      yearSelect.appendChild(option);
    }

    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement("option");
      option.value = String(month);
      option.textContent = `${month} 月`;
      if (month === currentMonth) option.selected = true;
      monthSelect.appendChild(option);
    }

    updateDayInputLimits();
  }

  function updateDayInputLimits() {
    const year = Number(yearSelect.value);
    const month = Number(monthSelect.value);
    const maxDay = getDaysInMonth(year, month);

    dayInput.min = "1";
    dayInput.max = String(maxDay);
    dayInput.placeholder = `1-${maxDay}`;

    const currentDay = Number(dayInput.value);
    if (dayInput.value && (currentDay < 1 || currentDay > maxDay)) {
      dayInput.value = String(maxDay);
    }
  }

  function getDateQueryParams() {
    const year = yearSelect.value;
    const month = monthSelect.value;
    if (!year || !month) {
      throw new Error("请至少选择年和月");
    }

    const params = { year, month };
    const dayRaw = dayInput.value.trim();
    if (dayRaw !== "") {
      const day = Number(dayRaw);
      const maxDay = getDaysInMonth(Number(year), Number(month));
      if (!Number.isInteger(day) || day < 1 || day > maxDay) {
        throw new Error(`日期必须在 1-${maxDay} 之间`);
      }
      params.day = String(day);
    }
    return params;
  }

  function createComboField(container, options) {
    const {
      placeholder,
      searchKeys,
      getLabel,
      getValue,
      getKeywords,
    } = options;

    container.innerHTML = `
      <div class="combo-control">
        <input type="text" class="form-control neon-input combo-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
        <button type="button" class="combo-clear d-none" title="清除"><i class="bi bi-x-lg"></i></button>
        <button type="button" class="combo-toggle" title="展开选项"><i class="bi bi-chevron-down"></i></button>
        <input type="hidden" class="combo-value" value="">
        <div class="combo-dropdown d-none"></div>
      </div>
    `;

    const control = container.querySelector(".combo-control");
    const input = container.querySelector(".combo-input");
    const hidden = container.querySelector(".combo-value");
    const dropdown = container.querySelector(".combo-dropdown");
    const clearBtn = container.querySelector(".combo-clear");
    const toggleBtn = container.querySelector(".combo-toggle");

    let items = [];
    let filtered = [];
    let activeIndex = -1;

    function normalize(text) {
      return String(text || "").trim().toLowerCase();
    }

    function matchItem(item, keyword) {
      if (!keyword) return true;
      const words = getKeywords(item).map(normalize);
      return words.some((word) => word.includes(keyword));
    }

    function renderDropdown(list) {
      container.classList.add("is-open");
      if (!list.length) {
        dropdown.innerHTML = '<div class="combo-empty">无匹配结果</div>';
        dropdown.classList.remove("d-none");
        return;
      }

      dropdown.innerHTML = list
        .map(
          (item, index) => `
          <button type="button" class="combo-option ${index === activeIndex ? "active" : ""}" data-index="${index}">
            ${escapeHtml(getLabel(item))}
          </button>
        `
        )
        .join("");
      dropdown.classList.remove("d-none");
    }

    function hideDropdown() {
      dropdown.classList.add("d-none");
      container.classList.remove("is-open");
      activeIndex = -1;
    }

    function updateClearButton() {
      const hasValue = Boolean(hidden.value || input.value.trim());
      clearBtn.classList.toggle("d-none", !hasValue);
    }

    function selectItem(item) {
      hidden.value = String(getValue(item));
      input.value = getLabel(item);
      hideDropdown();
      updateClearButton();
    }

    function clearSelection() {
      hidden.value = "";
      input.value = "";
      hideDropdown();
      updateClearButton();
      input.focus();
    }

    function filterItems(keyword) {
      filtered = items.filter((item) => matchItem(item, keyword));
      activeIndex = filtered.length ? 0 : -1;
      renderDropdown(filtered);
    }

    function setItems(nextItems) {
      items = nextItems || [];
      filtered = items;
    }

    input.addEventListener("input", () => {
      hidden.value = "";
      filterItems(normalize(input.value));
      updateClearButton();
    });

    input.addEventListener("focus", () => {
      filterItems(normalize(input.value));
    });

    toggleBtn.addEventListener("click", () => {
      if (dropdown.classList.contains("d-none")) {
        filterItems(normalize(input.value));
        input.focus();
      } else {
        hideDropdown();
      }
    });

    clearBtn.addEventListener("click", clearSelection);

    dropdown.addEventListener("click", (event) => {
      const option = event.target.closest(".combo-option");
      if (!option) return;
      const item = filtered[Number(option.dataset.index)];
      if (item) selectItem(item);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (dropdown.classList.contains("d-none")) filterItems(normalize(input.value));
        if (!filtered.length) return;
        activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
        renderDropdown(filtered);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!filtered.length) return;
        activeIndex = Math.max(activeIndex - 1, 0);
        renderDropdown(filtered);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (activeIndex >= 0 && filtered[activeIndex]) {
          selectItem(filtered[activeIndex]);
        } else {
          hideDropdown();
        }
        return;
      }
      if (event.key === "Escape") {
        hideDropdown();
      }
    });

    document.addEventListener("click", (event) => {
      if (!container.contains(event.target)) hideDropdown();
    });

    return {
      setItems,
      clearSelection,
      getQueryParams(nameKey, idKey) {
        const params = {};
        if (hidden.value) {
          params[idKey] = hidden.value;
        } else if (input.value.trim()) {
          params[nameKey] = input.value.trim();
        }
        return params;
      },
    };
  }

  function buildQuery() {
    const params = new URLSearchParams();
    const dateParams = getDateQueryParams();

    params.set("year", dateParams.year);
    params.set("month", dateParams.month);
    if (dateParams.day) {
      params.set("day", dateParams.day);
    }

    Object.entries(userCombo.getQueryParams("user_name", "user_id")).forEach(([key, value]) => {
      params.set(key, value);
    });
    Object.entries(projectCombo.getQueryParams("project_name", "project_id")).forEach(([key, value]) => {
      params.set(key, value);
    });

    return params.toString();
  }

  function isProjectFilterActive() {
    const params = projectCombo.getQueryParams("project_name", "project_id");
    return Boolean(params.project_id || params.project_name);
  }

  function getProjectFilterLabel(items) {
    const input = document.querySelector("#projectCombo .combo-input");
    const typedName = input?.value.trim();
    if (typedName) return typedName;
    const logProject = items.find((item) => !item.attendance_only)?.project_name;
    return logProject || "所选项目";
  }

  function hideProjectPersonChart() {
    if (!projectPersonChartPanel) return;
    projectPersonChartPanel.classList.add("d-none");
    projectPersonChartPanel.innerHTML = "";
  }

  async function loadOptions() {
    const [userRes, projectRes] = await Promise.all([
      fetch("/api/admin/options/users"),
      fetch("/api/admin/options/projects"),
    ]);
    const users = (await userRes.json()).items || [];
    const projects = (await projectRes.json()).items || [];

    userCombo.setItems(users);
    projectCombo.setItems(projects);
  }

  async function searchLogs() {
    pageAlert.classList.add("d-none");
    try {
      buildQuery();
    } catch (error) {
      showAlert(error.message, "warning");
      return;
    }

    renderLoadingState(logBody, "查询中...");
    if (projectSummaryPanel) renderLoadingState(projectSummaryPanel, "统计加载中...");
    if (isProjectFilterActive()) {
      renderLoadingState(projectPersonChartPanel, "人员统计加载中...");
      projectPersonChartPanel.classList.remove("d-none");
    } else {
      hideProjectPersonChart();
    }

    const response = await fetch(`/api/admin/logs?${buildQuery()}`);
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "查询失败");
      return;
    }

    const items = data.items || [];
    logsCache = items;
    const dateParams = getDateQueryParams();
    const rangeLabel = dateParams.day
      ? `${dateParams.year} 年 ${dateParams.month} 月 ${dateParams.day} 日`
      : `${dateParams.year} 年 ${dateParams.month} 月`;

    renderProjectLogSummary(projectSummaryPanel, data.summary, {
      title: `${rangeLabel}项目工时统计（已通过）`,
      emptyText: "当前筛选条件下暂无已通过日志",
    });

    if (isProjectFilterActive()) {
      const personSummary = summarizePersonHours(items);
      renderProjectPersonHoursChart(projectPersonChartPanel, personSummary, {
        projectName: getProjectFilterLabel(items),
        rangeLabel,
      });
    } else {
      hideProjectPersonChart();
    }

    logBody.innerHTML = items.length
      ? items
          .map(
            (log) => `
          <tr class="${log.attendance_only ? "attendance-only-row" : ""}">
            <td class="col-name">${escapeHtml(log.display_name)}</td>
            <td class="col-date">${escapeHtml(log.log_date)}</td>
            <td class="col-weekday">${escapeHtml(log.weekday)}</td>
            <td class="col-project" title="${escapeHtml(log.project_name)}">${escapeHtml(log.project_name)}</td>
            <td class="col-hours">${log.hours}</td>
            <td class="col-content content-cell">${escapeHtml(log.work_content || "")}</td>
            <td class="col-attendance attendance-cell">${escapeHtml(log.attendance || "-")}</td>
            <td class="col-action action-cell">${
              log.attendance_only || !log.id
                ? '<span class="text-muted">—</span>'
                : `<button type="button" class="btn btn-action-sm btn-danger-sm delete-log" data-id="${log.id}">删除</button>`
            }</td>
          </tr>
        `
          )
          .join("")
      : '<tr><td colspan="8" class="text-center empty-cell">暂无数据</td></tr>';
  }

  async function deleteLog(logId, displayName, logDate) {
    const confirmed = window.confirm(
      `确定删除 ${displayName} 在 ${logDate} 的这条日志吗？\n删除后将单独为该人员开放该日日志填报 12 小时。`
    );
    if (!confirmed) return;

    const response = await fetch(`/api/admin/logs/${logId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "删除失败");
      return;
    }
    showAlert(data.message || "删除成功", "success");
    await searchLogs();
  }

  logBody.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest(".delete-log");
    if (!deleteBtn) return;
    const log = logsCache.find((item) => String(item.id) === deleteBtn.dataset.id);
    if (!log) return;
    deleteLog(log.id, log.display_name, log.log_date);
  });

  async function importAttendance(file) {
    pageAlert.classList.add("d-none");
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/admin/attendance/import", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "导入失败");
      return;
    }

    const skipped = (data.skipped_names || []).length;
    const extra = skipped ? `，${skipped} 个 Excel 姓名未匹配已跳过` : "";
    showAlert(`${data.message || "导入成功"}（匹配 ${data.matched_users} 人）${extra}`, "success");
    await searchLogs();
  }

  async function importLogs(file) {
    pageAlert.classList.add("d-none");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("year", yearSelect.value);

    const response = await fetch("/api/admin/logs/import", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "导入失败");
      return;
    }

    showAlert(`${data.message || "导入成功"}${data.extra || ""}`, "success");
    await searchLogs();
  }

  const openLogModalEl = document.getElementById("openLogModal");
  const openLogModal = new bootstrap.Modal(openLogModalEl);
  const openLogDateInput = document.getElementById("openLogDateInput");
  const activeOpenPeriodsPanel = document.getElementById("activeOpenPeriodsPanel");
  const openLogAlert = document.getElementById("openLogAlert");

  function formatTodayForInput() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function renderActiveOpenPeriods(items) {
    if (!items.length) {
      activeOpenPeriodsPanel.innerHTML = '<p class="section-subtitle mb-0">当前没有进行中的开放记录</p>';
      return;
    }

    activeOpenPeriodsPanel.innerHTML = `
      <h6 class="mini-title mb-2">当前开放中</h6>
      <div class="open-period-list">
        ${items
          .map(
            (item) => `
              <div class="open-period-item">
                <span class="open-period-date">${escapeHtml(item.log_date)}</span>
                <span class="open-period-expire">截止 ${escapeHtml(item.expires_at)}</span>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  async function loadActiveOpenPeriods() {
    renderLoadingState(activeOpenPeriodsPanel, "加载中...");
    const response = await fetch("/api/admin/logs/open");
    const data = await response.json();
    if (!response.ok) {
      activeOpenPeriodsPanel.innerHTML = '<div class="history-empty">加载失败</div>';
      return;
    }
    renderActiveOpenPeriods(data.items || []);
  }

  function openLogModalDialog() {
    openLogDateInput.max = formatTodayForInput();
    openLogDateInput.value = formatTodayForInput();
    openLogAlert.classList.add("d-none");
    loadActiveOpenPeriods();
    openLogModal.show();
  }

  async function confirmOpenLog() {
    const log_date = openLogDateInput.value;
    if (!log_date) {
      openLogAlert.className = "alert alert-warning";
      openLogAlert.textContent = "请选择开放日期";
      openLogAlert.classList.remove("d-none");
      return;
    }

    const response = await fetch("/api/admin/logs/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ log_date }),
    });
    const data = await response.json();
    if (!response.ok) {
      openLogAlert.className = "alert alert-danger";
      openLogAlert.textContent = data.error || "开放失败";
      openLogAlert.classList.remove("d-none");
      return;
    }

    openLogAlert.className = "alert alert-success";
    openLogAlert.textContent = data.message || "开放成功";
    openLogAlert.classList.remove("d-none");
    await loadActiveOpenPeriods();
    showAlert(data.message || "开放成功", "success");
  }

  userCombo = createComboField(document.getElementById("userCombo"), {
    placeholder: "输入姓名或用户名筛选",
    getLabel: (user) => `${user.display_name}（${user.username}）`,
    getValue: (user) => user.id,
    getKeywords: (user) => [user.display_name, user.username],
    searchKeys: ["display_name", "username"],
  });

  projectCombo = createComboField(document.getElementById("projectCombo"), {
    placeholder: "输入项目名称筛选",
    getLabel: (project) => project.name,
    getValue: (project) => project.id,
    getKeywords: (project) => [project.name, ...(project.aliases || [])],
    searchKeys: ["name"],
  });

  document.getElementById("searchBtn").addEventListener("click", searchLogs);
  document.getElementById("exportBtn").addEventListener("click", () => {
    try {
      buildQuery();
    } catch (error) {
      showAlert(error.message, "warning");
      return;
    }
    window.location.href = `/api/admin/logs/export?${buildQuery()}`;
  });

  const attendanceFileInput = document.getElementById("attendanceFileInput");
  document.getElementById("importAttendanceBtn").addEventListener("click", () => {
    attendanceFileInput.click();
  });
  attendanceFileInput.addEventListener("change", async () => {
    const file = attendanceFileInput.files?.[0];
    attendanceFileInput.value = "";
    if (!file) return;
    await importAttendance(file);
  });

  const logsFileInput = document.getElementById("logsFileInput");
  document.getElementById("importLogsBtn").addEventListener("click", () => {
    if (!yearSelect.value) {
      showAlert("请先选择导入年份", "warning");
      return;
    }
    logsFileInput.click();
  });
  logsFileInput.addEventListener("change", async () => {
    const file = logsFileInput.files?.[0];
    logsFileInput.value = "";
    if (!file) return;
    await importLogs(file);
  });

  document.getElementById("openLogBtn").addEventListener("click", openLogModalDialog);
  document.getElementById("confirmOpenLogBtn").addEventListener("click", confirmOpenLog);

  yearSelect.addEventListener("change", updateDayInputLimits);
  monthSelect.addEventListener("change", updateDayInputLimits);
  dayInput.addEventListener("blur", updateDayInputLimits);

  initDateSelectors();
  loadOptions().then(searchLogs);
})();

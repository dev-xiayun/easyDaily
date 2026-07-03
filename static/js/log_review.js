(() => {
  const { escapeHtml, renderLoadingState } = window.LogConverter;

  const logBody = document.getElementById("logBody");
  const pageAlert = document.getElementById("pageAlert");
  const yearSelect = document.getElementById("yearSelect");
  const monthSelect = document.getElementById("monthSelect");
  const dayInput = document.getElementById("dayInput");
  const statusSelect = document.getElementById("statusSelect");
  const rejectModalEl = document.getElementById("rejectModal");
  const rejectModal = new bootstrap.Modal(rejectModalEl);

  let userCombo = null;
  let projectCombo = null;
  let pendingRejectLogId = null;

  function showAlert(message, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = message;
    pageAlert.classList.remove("d-none");
  }

  function reviewStatusClass(status) {
    if (status === "approved") return "review-approved";
    if (status === "rejected") return "review-rejected";
    return "review-pending";
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
    const { placeholder, getLabel, getValue, getKeywords } = options;

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

    function hideDropdown() {
      dropdown.classList.add("d-none");
      activeIndex = -1;
    }

    function renderDropdown(list) {
      if (!list.length) {
        dropdown.innerHTML = '<div class="combo-empty">无匹配项</div>';
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

    function filterItems(keyword) {
      filtered = items.filter((item) => matchItem(item, keyword));
      activeIndex = filtered.length ? 0 : -1;
      renderDropdown(filtered);
    }

    function selectItem(item) {
      input.value = getLabel(item);
      hidden.value = String(getValue(item));
      clearBtn.classList.remove("d-none");
      hideDropdown();
    }

    function clearSelection() {
      input.value = "";
      hidden.value = "";
      clearBtn.classList.add("d-none");
      hideDropdown();
    }

    function setItems(nextItems) {
      items = nextItems || [];
      clearSelection();
    }

    input.addEventListener("input", () => {
      hidden.value = "";
      clearBtn.classList.toggle("d-none", !input.value.trim());
      filterItems(normalize(input.value));
    });

    input.addEventListener("focus", () => filterItems(normalize(input.value)));
    toggleBtn.addEventListener("click", () => {
      if (dropdown.classList.contains("d-none")) filterItems(normalize(input.value));
      else hideDropdown();
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
        if (activeIndex >= 0 && filtered[activeIndex]) selectItem(filtered[activeIndex]);
        else hideDropdown();
        return;
      }
      if (event.key === "Escape") hideDropdown();
    });

    document.addEventListener("click", (event) => {
      if (!container.contains(event.target)) hideDropdown();
    });

    return {
      setItems,
      clearSelection,
      getQueryParams(nameKey, idKey) {
        const params = {};
        if (hidden.value) params[idKey] = hidden.value;
        else if (input.value.trim()) params[nameKey] = input.value.trim();
        return params;
      },
    };
  }

  function buildQuery() {
    const params = new URLSearchParams();
    const dateParams = getDateQueryParams();

    params.set("year", dateParams.year);
    params.set("month", dateParams.month);
    if (dateParams.day) params.set("day", dateParams.day);

    Object.entries(userCombo.getQueryParams("user_name", "user_id")).forEach(([key, value]) => {
      params.set(key, value);
    });
    Object.entries(projectCombo.getQueryParams("project_name", "project_id")).forEach(([key, value]) => {
      params.set(key, value);
    });

    const status = statusSelect.value.trim();
    if (status) params.set("review_status", status);

    return params.toString();
  }

  function renderActions(log) {
    if (!log.reviewable) {
      if (log.reject_reason) {
        return `<div class="text-muted small">驳回：${escapeHtml(log.reject_reason)}</div>`;
      }
      return '<span class="text-muted">—</span>';
    }
    return `
      <div class="review-actions">
        <button class="review-action-btn review-action-btn-approve approve-log" data-id="${log.id}">通过</button>
        <button class="review-action-btn review-action-btn-reject reject-log" data-id="${log.id}">驳回</button>
      </div>
    `;
  }

  async function loadOptions() {
    const [userRes, projectRes] = await Promise.all([
      fetch("/api/review/options/users"),
      fetch("/api/review/options/projects"),
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

    const response = await fetch(`/api/review/logs?${buildQuery()}`);
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "查询失败");
      return;
    }

    const items = data.items || [];
    logBody.innerHTML = items.length
      ? items
          .map(
            (log) => `
          <tr>
            <td>${escapeHtml(log.display_name)}</td>
            <td>${escapeHtml(log.log_date)}</td>
            <td>${escapeHtml(log.weekday)}</td>
            <td>${escapeHtml(log.project_name)}</td>
            <td>${log.hours}</td>
            <td class="content-cell">${escapeHtml(log.work_content || "")}</td>
            <td><span class="review-badge ${reviewStatusClass(log.review_status)}">${escapeHtml(log.review_status_label)}</span></td>
            <td>${renderActions(log)}</td>
          </tr>
        `
          )
          .join("")
      : '<tr><td colspan="8" class="text-center empty-cell">暂无数据</td></tr>';

    logBody.querySelectorAll(".approve-log").forEach((btn) => {
      btn.addEventListener("click", () => approveLog(btn.dataset.id));
    });
    logBody.querySelectorAll(".reject-log").forEach((btn) => {
      btn.addEventListener("click", () => openRejectModal(btn.dataset.id));
    });
  }

  async function approveLog(logId) {
    if (!window.confirm("确认通过这条日志吗？")) return;
    const response = await fetch(`/api/review/logs/${logId}/approve`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "审核失败");
      return;
    }
    await searchLogs();
  }

  function openRejectModal(logId) {
    pendingRejectLogId = logId;
    document.getElementById("rejectReasonInput").value = "";
    document.getElementById("rejectAlert").classList.add("d-none");
    rejectModal.show();
  }

  async function confirmReject() {
    const reason = document.getElementById("rejectReasonInput").value.trim();
    const alertBox = document.getElementById("rejectAlert");
    if (!reason) {
      alertBox.className = "alert alert-warning";
      alertBox.textContent = "请填写驳回原因";
      alertBox.classList.remove("d-none");
      return;
    }

    const response = await fetch(`/api/review/logs/${pendingRejectLogId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const data = await response.json();
    if (!response.ok) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = data.error || "驳回失败";
      alertBox.classList.remove("d-none");
      return;
    }

    rejectModal.hide();
    pendingRejectLogId = null;
    await searchLogs();
  }

  userCombo = createComboField(document.getElementById("userCombo"), {
    placeholder: "输入姓名或用户名筛选",
    getLabel: (user) => `${user.display_name}（${user.username}）`,
    getValue: (user) => user.id,
    getKeywords: (user) => [user.display_name, user.username],
  });

  projectCombo = createComboField(document.getElementById("projectCombo"), {
    placeholder: "输入项目名称筛选",
    getLabel: (project) => project.name,
    getValue: (project) => project.id,
    getKeywords: (project) => [project.name, ...(project.aliases || [])],
  });

  document.getElementById("searchBtn").addEventListener("click", searchLogs);
  document.getElementById("confirmRejectBtn").addEventListener("click", confirmReject);
  yearSelect.addEventListener("change", updateDayInputLimits);
  monthSelect.addEventListener("change", updateDayInputLimits);
  dayInput.addEventListener("blur", updateDayInputLimits);

  initDateSelectors();
  loadOptions().then(searchLogs);
})();

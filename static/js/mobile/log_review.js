(() => {
  const { escapeHtml, renderLoadingState } = window.LogConverter;

  const reviewList = document.getElementById("reviewList");
  const pageAlert = document.getElementById("pageAlert");
  const yearSelect = document.getElementById("yearSelect");
  const monthSelect = document.getElementById("monthSelect");
  const statusSelect = document.getElementById("statusSelect");
  const rejectModalEl = document.getElementById("rejectModal");
  const rejectModal = new bootstrap.Modal(rejectModalEl);

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

  function initDateSelectors() {
    const now = new Date();
    for (let year = now.getFullYear() + 1; year >= now.getFullYear() - 5; year -= 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = `${year}年`;
      if (year === now.getFullYear()) option.selected = true;
      yearSelect.appendChild(option);
    }
    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement("option");
      option.value = String(month);
      option.textContent = `${month}月`;
      if (month === now.getMonth() + 1) option.selected = true;
      monthSelect.appendChild(option);
    }
  }

  function renderActions(log) {
    if (!log.reviewable) {
      return log.reject_reason
        ? `<div class="small text-muted mt-2">驳回：${escapeHtml(log.reject_reason)}</div>`
        : "";
    }
    return `
      <div class="review-actions">
        <button class="review-action-btn review-action-btn-approve approve-log" data-id="${log.id}">通过</button>
        <button class="review-action-btn review-action-btn-reject reject-log" data-id="${log.id}">驳回</button>
      </div>
    `;
  }

  async function searchLogs() {
    pageAlert.classList.add("d-none");
    renderLoadingState(reviewList, "查询中...");
    const params = new URLSearchParams({
      year: yearSelect.value,
      month: monthSelect.value,
    });
    const status = statusSelect.value.trim();
    if (status) params.set("review_status", status);

    const response = await fetch(`/api/review/logs?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "查询失败");
      return;
    }

    const items = data.items || [];
    reviewList.innerHTML = items.length
      ? items
          .map(
            (log) => `
          <div class="mobile-review-card">
            <div class="mobile-review-meta">
              <span>${escapeHtml(log.display_name)}</span>
              <span>${escapeHtml(log.log_date)} ${escapeHtml(log.weekday)}</span>
              <span>${log.hours}h</span>
            </div>
            <div class="fw-semibold mb-1">${escapeHtml(log.project_name)}</div>
            <div class="small mb-2">${escapeHtml(log.work_content || "")}</div>
            <span class="review-badge ${reviewStatusClass(log.review_status)}">${escapeHtml(log.review_status_label)}</span>
            ${renderActions(log)}
          </div>
        `
          )
          .join("")
      : '<div class="history-empty">暂无待审核日报</div>';

    reviewList.querySelectorAll(".approve-log").forEach((btn) => {
      btn.addEventListener("click", () => approveLog(btn.dataset.id));
    });
    reviewList.querySelectorAll(".reject-log").forEach((btn) => {
      btn.addEventListener("click", () => openRejectModal(btn.dataset.id));
    });
  }

  async function approveLog(logId) {
    if (!window.confirm("确认通过这条日报吗？")) return;
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

  document.getElementById("searchBtn").addEventListener("click", searchLogs);
  document.getElementById("confirmRejectBtn").addEventListener("click", confirmReject);
  yearSelect.addEventListener("change", searchLogs);
  monthSelect.addEventListener("change", searchLogs);
  statusSelect.addEventListener("change", searchLogs);

  initDateSelectors();
  searchLogs();
})();

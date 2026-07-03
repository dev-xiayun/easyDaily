(() => {
  const { escapeHtml, renderLoadingState } = window.LogConverter;

  const userBody = document.getElementById("userBody");
  const pageAlert = document.getElementById("pageAlert");
  const userStatsPanel = document.getElementById("userStatsPanel");
  const userPagination = document.getElementById("userPagination");
  const keywordFilter = document.getElementById("keywordFilter");
  const roleFilter = document.getElementById("roleFilter");
  const statusFilter = document.getElementById("statusFilter");
  const passwordModalEl = document.getElementById("passwordModal");
  const passwordModal = new bootstrap.Modal(passwordModalEl);

  const PAGE_SIZE = 50;
  let pendingUserId = null;
  let usersCache = [];
  let currentPage = 1;
  let paginationMeta = {
    page: 1,
    page_size: PAGE_SIZE,
    total: 0,
    total_pages: 1,
  };

  function showAlert(message, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = message;
    pageAlert.classList.remove("d-none");
  }

  function getFilterParams() {
    return {
      keyword: keywordFilter.value.trim(),
      role: roleFilter.value.trim(),
      status: statusFilter.value.trim(),
    };
  }

  function statusBadge(status) {
    const map = {
      pending: "待审核",
      approved: "已通过",
      rejected: "已拒绝",
    };
    return `<span class="status-badge status-${status}">${map[status] || status}</span>`;
  }

  function renderActions(user) {
    const parts = [
      `<button type="button" class="btn btn-outline-neon btn-action-sm set-password" data-id="${user.id}">设置密码</button>`,
    ];
    if (user.role !== "admin") {
      parts.push(`<button type="button" class="btn btn-outline-neon btn-action-sm approve-user" data-id="${user.id}">通过</button>`);
      parts.push(`<button type="button" class="btn btn-action-sm btn-danger-sm reject-user" data-id="${user.id}">拒绝</button>`);
    }
    return `<div class="action-buttons">${parts.join("")}</div>`;
  }

  function renderStats(summary) {
    userStatsPanel.innerHTML = `
      <h3 class="mini-title mb-3">总体统计</h3>
      <div class="row g-3 mb-3 project-stats-grid">
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-1">
            <div class="stat-icon"><i class="bi bi-people"></i></div>
            <div class="stat-value">${summary.user_count}</div>
            <div class="stat-label">用户总数</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-2">
            <div class="stat-icon"><i class="bi bi-shield-lock"></i></div>
            <div class="stat-value">${summary.admin_count}</div>
            <div class="stat-label">管理员</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-3">
            <div class="stat-icon"><i class="bi bi-person"></i></div>
            <div class="stat-value">${summary.normal_user_count}</div>
            <div class="stat-label">普通用户</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-4">
            <div class="stat-icon"><i class="bi bi-person-check"></i></div>
            <div class="stat-value">${summary.manager_count}</div>
            <div class="stat-label">项目负责人</div>
          </div>
        </div>
      </div>
      <div class="row g-3 project-stats-grid">
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-1">
            <div class="stat-icon"><i class="bi bi-hourglass-split"></i></div>
            <div class="stat-value">${summary.pending_count}</div>
            <div class="stat-label">待审核</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-2">
            <div class="stat-icon"><i class="bi bi-check-circle"></i></div>
            <div class="stat-value">${summary.approved_count}</div>
            <div class="stat-label">已通过</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-3">
            <div class="stat-icon"><i class="bi bi-x-circle"></i></div>
            <div class="stat-value">${summary.rejected_count}</div>
            <div class="stat-label">已拒绝</div>
          </div>
        </div>
      </div>
    `;
  }

  async function loadSummary() {
    renderLoadingState(userStatsPanel, "统计加载中...");
    const response = await fetch("/api/admin/users/summary");
    const data = await response.json();
    if (!response.ok) {
      userStatsPanel.innerHTML = '<div class="history-empty">统计加载失败</div>';
      showAlert(data.error || "统计加载失败");
      return;
    }
    renderStats(data.summary || {});
  }

  function renderUsers(users) {
    if (!users.length) {
      userBody.innerHTML = '<tr><td colspan="6" class="text-center empty-cell">暂无匹配用户</td></tr>';
      return;
    }

    userBody.innerHTML = users
      .map(
        (user) => `
          <tr>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.display_name)}</td>
            <td>${user.role === "admin" ? "管理员" : "普通用户"}</td>
            <td>${statusBadge(user.status)}</td>
            <td>${escapeHtml(user.created_at)}</td>
            <td class="action-cell">${renderActions(user)}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderPagination() {
    const { page, page_size, total, total_pages } = paginationMeta;
    if (!total) {
      userPagination.innerHTML = '<div class="pagination-info">共 0 条记录</div>';
      return;
    }

    const start = (page - 1) * page_size + 1;
    const end = Math.min(page * page_size, total);
    userPagination.innerHTML = `
      <div class="pagination-info">第 ${page} / ${total_pages} 页，显示 ${start}-${end} 条，共 ${total} 条（每页最多 ${page_size} 条）</div>
      <div class="pagination-actions">
        <button type="button" class="btn btn-outline-neon btn-sm pagination-btn" data-page="1" ${page <= 1 ? "disabled" : ""}>首页</button>
        <button type="button" class="btn btn-outline-neon btn-sm pagination-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" class="btn btn-outline-neon btn-sm pagination-btn" data-page="${page + 1}" ${page >= total_pages ? "disabled" : ""}>下一页</button>
        <button type="button" class="btn btn-outline-neon btn-sm pagination-btn" data-page="${total_pages}" ${page >= total_pages ? "disabled" : ""}>末页</button>
      </div>
    `;
  }

  async function loadUsers(page = currentPage) {
    pageAlert.classList.add("d-none");
    renderLoadingState(userBody, "加载中...");

    const { keyword, role, status } = getFilterParams();
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    if (keyword) params.set("keyword", keyword);
    if (role) params.set("role", role);
    if (status) params.set("status", status);

    const response = await fetch(`/api/admin/users?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      userBody.innerHTML = '<tr><td colspan="6" class="text-center empty-cell">加载失败</td></tr>';
      userPagination.innerHTML = "";
      showAlert(data.error || "加载失败");
      return;
    }

    usersCache = data.items || [];
    paginationMeta = data.pagination || paginationMeta;
    currentPage = paginationMeta.page || page;
    renderUsers(usersCache);
    renderPagination();
  }

  async function searchUsers() {
    currentPage = 1;
    await loadUsers(1);
  }

  async function reloadUsersAndSummary() {
    await Promise.all([loadSummary(), loadUsers(currentPage)]);
  }

  async function updateStatus(userId, status) {
    const response = await fetch(`/api/admin/users/${userId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "更新失败");
      return;
    }
    await reloadUsersAndSummary();
    showAlert("审核状态已更新", "success");
  }

  function openPasswordModal(userId, displayName) {
    pendingUserId = userId;
    document.getElementById("passwordTargetName").textContent = displayName;
    document.getElementById("adminPasswordInput").value = "";
    document.getElementById("adminConfirmPasswordInput").value = "";
    document.getElementById("passwordAlert").classList.add("d-none");
    passwordModal.show();
  }

  async function savePassword() {
    const password = document.getElementById("adminPasswordInput").value;
    const confirm_password = document.getElementById("adminConfirmPasswordInput").value;
    const alertBox = document.getElementById("passwordAlert");

    if (!password || !confirm_password) {
      alertBox.className = "alert alert-warning";
      alertBox.textContent = "请填写并确认新密码";
      alertBox.classList.remove("d-none");
      return;
    }
    if (password !== confirm_password) {
      alertBox.className = "alert alert-warning";
      alertBox.textContent = "两次输入的密码不一致";
      alertBox.classList.remove("d-none");
      return;
    }
    if (password.length <= 6) {
      alertBox.className = "alert alert-warning";
      alertBox.textContent = "密码长度需超过 6 位";
      alertBox.classList.remove("d-none");
      return;
    }

    const response = await fetch(`/api/admin/users/${pendingUserId}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirm_password }),
    });
    const data = await response.json();
    if (!response.ok) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = data.error || "设置失败";
      alertBox.classList.remove("d-none");
      return;
    }

    passwordModal.hide();
    pendingUserId = null;
    showAlert("密码设置成功", "success");
  }

  userBody.addEventListener("click", (event) => {
    const passwordBtn = event.target.closest(".set-password");
    if (passwordBtn) {
      const user = usersCache.find((item) => String(item.id) === passwordBtn.dataset.id);
      if (user) openPasswordModal(user.id, user.display_name);
      return;
    }

    const approveBtn = event.target.closest(".approve-user");
    if (approveBtn) {
      updateStatus(approveBtn.dataset.id, "approved");
      return;
    }

    const rejectBtn = event.target.closest(".reject-user");
    if (rejectBtn) {
      if (window.confirm("确定拒绝该用户吗？")) {
        updateStatus(rejectBtn.dataset.id, "rejected");
      }
    }
  });

  userPagination.addEventListener("click", (event) => {
    const pageBtn = event.target.closest(".pagination-btn");
    if (!pageBtn || pageBtn.disabled) return;
    const nextPage = Number(pageBtn.dataset.page);
    if (!Number.isFinite(nextPage) || nextPage === currentPage) return;
    loadUsers(nextPage);
  });

  document.getElementById("searchBtn").addEventListener("click", searchUsers);
  roleFilter.addEventListener("change", searchUsers);
  statusFilter.addEventListener("change", searchUsers);
  keywordFilter.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchUsers();
  });
  document.getElementById("savePasswordBtn").addEventListener("click", savePassword);

  loadSummary();
  loadUsers(1);
})();

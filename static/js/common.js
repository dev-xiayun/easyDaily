(() => {
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function animateCount(element, target, decimals = 0) {
    const duration = 900;
    const start = performance.now();
    const from = 0;

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = from + (target - from) * eased;
      element.textContent = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
      if (progress < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function renderBars(container, items, labelKey) {
    if (!container) return;
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = '<div class="history-empty">暂无数据</div>';
      return;
    }

    const maxHours = items[0].工时 || 1;
    items.forEach((item, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "bar-item";
      wrapper.style.animationDelay = `${index * 0.04}s`;

      const percent = Math.max((item.工时 / maxHours) * 100, 4);
      wrapper.innerHTML = `
        <div class="bar-head">
          <span class="bar-name">${escapeHtml(item[labelKey])}</span>
          <span class="bar-hours">${item.工时} h · ${item.占比}%</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:0"></div>
        </div>
      `;
      container.appendChild(wrapper);

      requestAnimationFrame(() => {
        wrapper.querySelector(".bar-fill").style.width = `${percent}%`;
      });
    });
  }

  function renderDetailRows(detailBody, rows) {
    if (!detailBody) return;
    const fragment = rows
      .map(
        (row) => `
        <tr>
          <td class="${row.项目 === "未知项目" ? "project-unknown" : ""}">${escapeHtml(row.项目)}</td>
          <td>${escapeHtml(row.姓名)}</td>
          <td>${escapeHtml(row.日期)}</td>
          <td>${row["工时（小时）"]}</td>
          <td class="content-cell">${escapeHtml(row.工作内容 || "")}</td>
        </tr>
      `
      )
      .join("");
    detailBody.innerHTML = fragment;
  }

  function renderSummary(options) {
    const {
      summary,
      year,
      month,
      rows,
      resultMeta,
      downloadBtn,
      projectBars,
      personBars,
      detailBody,
      projectTag,
      unknownTag,
      sourceFilename,
      createdAt,
    } = options;

    const metaParts = [`${year} 年 ${month} 月`, `共 ${summary.total_records} 条明细`, `平均每人 ${summary.avg_hours_per_person} 小时`];
    if (sourceFilename) metaParts.unshift(`来源文件：${sourceFilename}`);
    if (createdAt) metaParts.push(`转换时间：${createdAt}`);
    if (resultMeta) resultMeta.textContent = metaParts.join(" · ");

    const statCards = document.querySelectorAll(".stat-value");
    if (statCards.length >= 4) {
      animateCount(statCards[0], summary.total_records);
      animateCount(statCards[1], summary.total_hours, 1);
      animateCount(statCards[2], summary.people_count);
      animateCount(statCards[3], summary.days_count);
    }

    if (projectTag) projectTag.textContent = `${summary.project_count} 个项目`;
    if (unknownTag) unknownTag.textContent = `未知项目 ${summary.unknown_count} 条 / ${summary.unknown_hours} 小时`;

    renderBars(projectBars, summary.by_project.slice(0, 12), "项目");
    renderBars(personBars, summary.by_person.slice(0, 12), "姓名");
    renderDetailRows(detailBody, rows);

    if (downloadBtn && options.token && options.filename) {
      downloadBtn.href = `/api/download/${options.token}`;
      downloadBtn.setAttribute("download", options.filename);
    }
  }

  function renderLoadingState(container, text = "加载中...") {
    if (!container) return;
    const html = `
      <div class="loading-state">
        <div class="loading-spinner" aria-hidden="true"></div>
        <div class="loading-text">${escapeHtml(text)}</div>
      </div>
    `;
    if (container.tagName === "TBODY") {
      const colspan = container.closest("table")?.querySelectorAll("thead th").length || 1;
      container.innerHTML = `<tr><td colspan="${colspan}" class="loading-cell">${html}</td></tr>`;
      return;
    }
    container.innerHTML = html;
  }

  function renderProjectLogSummary(container, summary, options = {}) {
    if (!container) return;

    const title = options.title || "项目工时统计";
    const emptyText = options.emptyText || "暂无项目统计数据";
    const projects = summary?.projects || [];

    if (!projects.length) {
      container.innerHTML = `
        <h3 class="mini-title mb-3">${escapeHtml(title)}</h3>
        <div class="history-empty">${escapeHtml(emptyText)}</div>
      `;
      return;
    }

    const totalHours = summary.total_hours || 0;
    const totalLogs = summary.total_logs || 0;
    const projectCount = summary.project_count || projects.length;
    const totalUsers = summary.total_users;
    const showUserStats = projects.some((item) => item.user_count !== undefined);

    const tableRows = projects
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.project_name)}</td>
          ${showUserStats ? `<td>${item.user_count ?? 0}</td>` : ""}
          <td>${item.count}</td>
          <td>${item.hours}</td>
          <td>${item.percent}%</td>
        </tr>
      `
      )
      .join("");

    const userStatCard =
      totalUsers !== undefined
        ? `
        <div class="col-md-3 col-6">
          <div class="stat-card stat-card-4">
            <div class="stat-icon"><i class="bi bi-people"></i></div>
            <div class="stat-value">${totalUsers}</div>
            <div class="stat-label">参与人员</div>
          </div>
        </div>`
        : "";

    const statColClass = totalUsers !== undefined ? "col-md-3 col-6" : "col-md-4";

    container.innerHTML = `
      <h3 class="mini-title mb-3">${escapeHtml(title)}</h3>
      <div class="row g-3 mb-3 log-summary-stats">
        <div class="${statColClass}">
          <div class="stat-card stat-card-1">
            <div class="stat-icon"><i class="bi bi-clock-history"></i></div>
            <div class="stat-value">${totalHours}</div>
            <div class="stat-label">总工时（小时）</div>
          </div>
        </div>
        <div class="${statColClass}">
          <div class="stat-card stat-card-2">
            <div class="stat-icon"><i class="bi bi-kanban"></i></div>
            <div class="stat-value">${projectCount}</div>
            <div class="stat-label">涉及项目</div>
          </div>
        </div>
        <div class="${statColClass}">
          <div class="stat-card stat-card-3">
            <div class="stat-icon"><i class="bi bi-journal-text"></i></div>
            <div class="stat-value">${totalLogs}</div>
            <div class="stat-label">日志条数</div>
          </div>
        </div>
        ${userStatCard}
      </div>
      <div class="log-summary-body">
        <div class="row g-4 log-summary-split">
          <div class="col-lg-6">
            <div class="table-responsive detail-table-wrap log-summary-table-wrap">
              <table class="table table-dark table-hover align-middle mb-0 log-summary-table">
                <thead>
                  <tr>
                    <th>项目</th>
                    ${showUserStats ? "<th>人员</th>" : ""}
                    <th>条数</th>
                    <th>工时（小时）</th>
                    <th>占比</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
            </div>
          </div>
          <div class="col-lg-6">
            <div class="bar-list log-summary-bars" id="projectSummaryBars"></div>
          </div>
        </div>
      </div>
    `;

    const barItems = projects.map((item) => ({
      项目: item.project_name,
      工时: item.hours,
      占比: item.percent,
    }));
    renderBars(container.querySelector("#projectSummaryBars"), barItems, "项目");
  }

  function summarizePersonHours(logs) {
    const personMap = new Map();

    logs.forEach((log) => {
      if (log.attendance_only) return;
      const hours = Number(log.hours);
      if (!Number.isFinite(hours) || hours <= 0) return;

      const name = String(log.display_name || log.username || "").trim();
      if (!name) return;

      const bucket = personMap.get(name) || { name, hours: 0, count: 0 };
      bucket.hours += hours;
      bucket.count += 1;
      personMap.set(name, bucket);
    });

    const people = Array.from(personMap.values()).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "zh-CN"));
    const totalHours = people.reduce((sum, item) => sum + item.hours, 0);
    const roundedTotal = Math.round(totalHours * 100) / 100;

    people.forEach((item) => {
      item.hours = Math.round(item.hours * 100) / 100;
      item.percent = roundedTotal ? Math.round((item.hours / roundedTotal) * 1000) / 10 : 0;
    });

    return {
      people,
      total_hours: roundedTotal,
      total_logs: people.reduce((sum, item) => sum + item.count, 0),
    };
  }

  function renderPersonColumnChart(container, items, labelKey) {
    if (!container) return;
    container.innerHTML = "";

    if (!items.length) {
      container.innerHTML = '<div class="history-empty">暂无数据</div>';
      return;
    }

    const maxHours = Math.max(...items.map((item) => Number(item.工时) || 0), 1);
    const chart = document.createElement("div");
    chart.className = "column-chart";

    items.forEach((item, index) => {
      const percent = Math.max(((Number(item.工时) || 0) / maxHours) * 100, 6);
      const column = document.createElement("div");
      column.className = "column-chart-item";
      column.style.animationDelay = `${index * 0.04}s`;
      column.innerHTML = `
        <div class="column-chart-value">${item.工时} h</div>
        <div class="column-chart-bar-wrap">
          <div class="column-chart-bar" style="height:0" data-height="${percent}%"></div>
        </div>
        <div class="column-chart-label" title="${escapeHtml(item[labelKey])}">${escapeHtml(item[labelKey])}</div>
        <div class="column-chart-percent">${item.占比}%</div>
      `;
      chart.appendChild(column);

      requestAnimationFrame(() => {
        column.querySelector(".column-chart-bar").style.height = `${percent}%`;
      });
    });

    container.appendChild(chart);
  }

  function renderProjectPersonHoursChart(container, summary, options = {}) {
    if (!container) return;

    const projectName = options.projectName || "所选项目";
    const rangeLabel = options.rangeLabel || "";
    const people = summary?.people || [];

    if (!people.length) {
      container.innerHTML = `
        <h3 class="mini-title mb-3">${escapeHtml(projectName)} · ${escapeHtml(rangeLabel)}人员投入</h3>
        <div class="history-empty">当前筛选时间范围内暂无人员工时数据</div>
      `;
      container.classList.remove("d-none");
      return;
    }

    container.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mini-title mb-0">${escapeHtml(projectName)} · ${escapeHtml(rangeLabel)}人员投入</h3>
        <span class="tag tag-blue">共 ${summary.total_hours} 小时 · ${people.length} 人 · ${summary.total_logs} 条日志</span>
      </div>
      <div class="column-chart-wrap project-person-column-chart" id="projectPersonBars"></div>
    `;

    const barItems = people.map((item) => ({
      姓名: item.name,
      工时: item.hours,
      占比: item.percent,
    }));
    renderPersonColumnChart(container.querySelector("#projectPersonBars"), barItems, "姓名");
    container.classList.remove("d-none");
  }

  function getTodayKey() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }

  function isFutureDayTab(day) {
    return day.date > getTodayKey();
  }

  function getDayTabStatusClass(day) {
    const todayKey = getTodayKey();
    if (day.date > todayKey) {
      return "future-day";
    }
    if (day.date < todayKey && day.logs && day.logs.length > 0) {
      return "has-logs";
    }
    if (day.date < todayKey && (!day.logs || day.logs.length === 0)) {
      return day.weekday === "周六" || day.weekday === "周日" ? "missing-weekend" : "missing-weekday";
    }
    return "";
  }

  function resolveActiveDayDate(days, preferredDate) {
    if (!days.length) return null;
    const todayKey = getTodayKey();
    const selectable = days.filter((day) => day.date <= todayKey);
    if (preferredDate && selectable.some((day) => day.date === preferredDate)) {
      return preferredDate;
    }
    if (selectable.some((day) => day.date === todayKey)) {
      return todayKey;
    }
    return selectable[selectable.length - 1]?.date || days[0].date;
  }

  window.LogConverter = {
    escapeHtml,
    animateCount,
    renderBars,
    renderDetailRows,
    renderSummary,
    renderProjectLogSummary,
    renderProjectPersonHoursChart,
    summarizePersonHours,
    renderLoadingState,
    getTodayKey,
    isFutureDayTab,
    getDayTabStatusClass,
    resolveActiveDayDate,
  };
})();

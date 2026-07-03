(() => {
  const { renderSummary, escapeHtml, renderLoadingState } = window.LogConverter;

  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const fileName = document.getElementById("fileName");
  const yearSelect = document.getElementById("yearSelect");
  const monthSelect = document.getElementById("monthSelect");
  const submitBtn = document.getElementById("submitBtn");
  const errorAlert = document.getElementById("errorAlert");
  const resultSection = document.getElementById("resultSection");
  const resultMeta = document.getElementById("resultMeta");
  const downloadBtn = document.getElementById("downloadBtn");
  const detailBody = document.getElementById("detailBody");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  const historyCount = document.getElementById("historyCount");

  let selectedFile = null;

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

  async function loadHistory() {
    renderLoadingState(historyList, "加载中...");
    historyEmpty.classList.add("d-none");
    const response = await fetch("/api/history");
    const data = await response.json();
    const items = data.items || [];
    historyCount.textContent = `${items.length} 条`;
    historyEmpty.classList.toggle("d-none", items.length > 0);
    historyList.innerHTML = items
      .map(
        (item) => `
        <div class="history-item">
          <button type="button" class="history-open" data-id="${escapeHtml(item.id)}">
            <div class="history-time">${escapeHtml(item.created_at)}</div>
            <div class="history-meta">
              <span>${escapeHtml(item.source_filename)}</span>
              <span>${item.year} 年 ${item.month} 月</span>
              <span>${item.total_records} 条</span>
            </div>
          </button>
          <button type="button" class="history-delete" data-id="${escapeHtml(item.id)}"><i class="bi bi-x-lg"></i></button>
        </div>
      `
      )
      .join("");
  }

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (event) => {
    selectedFile = event.target.files[0] || null;
    fileName.textContent = selectedFile ? selectedFile.name : "";
  });

  submitBtn.addEventListener("click", async () => {
    errorAlert.classList.add("d-none");
    if (!selectedFile) {
      errorAlert.textContent = "请先上传文件";
      errorAlert.classList.remove("d-none");
      return;
    }
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("year", yearSelect.value);
    formData.append("month", monthSelect.value);
    const response = await fetch("/api/convert", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      errorAlert.textContent = data.error || "转换失败";
      errorAlert.classList.remove("d-none");
      return;
    }
    resultSection.classList.remove("d-none");
    document.getElementById("statRecords").textContent = data.summary.total_records;
    document.getElementById("statHours").textContent = data.summary.total_hours;
    document.getElementById("statPeople").textContent = data.summary.people_count;
    document.getElementById("statDays").textContent = data.summary.days_count;
    resultMeta.textContent = `${data.year} 年 ${data.month} 月 · ${data.created_at}`;
    downloadBtn.href = `/api/download/${data.token}`;
    downloadBtn.setAttribute("download", data.filename);
    detailBody.innerHTML = data.rows
      .map(
        (row) => `
        <tr>
          <td>${escapeHtml(row.项目)}</td>
          <td>${escapeHtml(row.姓名)}</td>
          <td>${escapeHtml(row.日期)}</td>
          <td>${row["工时（小时）"]}</td>
          <td class="content-cell">${escapeHtml(row.工作内容 || "")}</td>
        </tr>
      `
      )
      .join("");
    await loadHistory();
  });

  historyList.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest(".history-delete");
    if (deleteBtn) {
      if (!window.confirm("确定删除这条转换记录吗？")) return;
      await fetch(`/api/history/${deleteBtn.dataset.id}`, { method: "DELETE" });
      await loadHistory();
      return;
    }
    const openBtn = event.target.closest(".history-open");
    if (openBtn) {
      const response = await fetch(`/api/history/${openBtn.dataset.id}`);
      const data = await response.json();
      if (!response.ok) return;
      resultSection.classList.remove("d-none");
      downloadBtn.href = `/api/download/${data.token}`;
      downloadBtn.setAttribute("download", data.filename);
      resultMeta.textContent = `${data.year} 年 ${data.month} 月 · ${data.created_at}`;
      detailBody.innerHTML = data.rows
        .map(
          (row) => `
          <tr>
            <td>${escapeHtml(row.项目)}</td>
            <td>${escapeHtml(row.姓名)}</td>
            <td>${escapeHtml(row.日期)}</td>
            <td>${row["工时（小时）"]}</td>
            <td class="content-cell">${escapeHtml(row.工作内容 || "")}</td>
          </tr>
        `
        )
        .join("");
    }
  });

  initSelectors();
  loadHistory();
})();

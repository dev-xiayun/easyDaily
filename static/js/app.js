(() => {
  const { renderSummary, escapeHtml } = window.LogConverter;

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
  const projectBars = document.getElementById("projectBars");
  const personBars = document.getElementById("personBars");
  const detailBody = document.getElementById("detailBody");
  const projectTag = document.getElementById("projectTag");
  const unknownTag = document.getElementById("unknownTag");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  const historyCount = document.getElementById("historyCount");

  let selectedFile = null;
  let activeHistoryId = null;

  function initSelectors() {
    const now = new Date();
    const currentYear = now.getFullYear();

    for (let year = currentYear + 1; year >= currentYear - 3; year -= 1) {
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
      if (month === now.getMonth() + 1) option.selected = true;
      monthSelect.appendChild(option);
    }
  }

  function setFile(file) {
    selectedFile = file;
    fileName.textContent = file ? file.name : "";
    dropZone.classList.toggle("has-file", Boolean(file));
  }

  function showError(message) {
    errorAlert.textContent = message;
    errorAlert.classList.remove("d-none");
  }

  function hideError() {
    errorAlert.classList.add("d-none");
    errorAlert.textContent = "";
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.querySelector(".btn-text").classList.toggle("d-none", loading);
    submitBtn.querySelector(".btn-loading").classList.toggle("d-none", !loading);
  }

  function showResult(data) {
    activeHistoryId = data.history_id || data.id || null;

    resultSection.classList.remove("d-none");
    renderSummary({
      summary: data.summary,
      year: data.year,
      month: data.month,
      rows: data.rows,
      resultMeta,
      downloadBtn,
      projectBars,
      personBars,
      detailBody,
      projectTag,
      unknownTag,
      token: data.token,
      filename: data.filename,
      sourceFilename: data.source_filename,
      createdAt: data.created_at,
    });

    document.querySelectorAll(".history-item").forEach((node) => {
      node.classList.toggle("active", node.dataset.id === activeHistoryId);
    });
  }

  function renderHistoryList(items) {
    historyCount.textContent = `${items.length} 条记录`;
    historyEmpty.classList.toggle("d-none", items.length > 0);
    historyList.innerHTML = items
      .map(
        (item) => `
        <div class="history-item ${item.id === activeHistoryId ? "active" : ""}" data-id="${escapeHtml(item.id)}">
          <button type="button" class="history-open" data-id="${escapeHtml(item.id)}">
            <div class="history-time"><i class="bi bi-calendar-event me-2"></i>${escapeHtml(item.created_at)}</div>
            <div class="history-meta">
              <span><i class="bi bi-file-earmark-spreadsheet me-1"></i>${escapeHtml(item.source_filename)}</span>
              <span><i class="bi bi-bar-chart-steps me-1"></i>${item.year} 年 ${item.month} 月</span>
              <span><i class="bi bi-journal-check me-1"></i>${item.total_records} 条 / ${item.total_hours} 小时</span>
            </div>
          </button>
          <button type="button" class="history-delete" data-id="${escapeHtml(item.id)}" title="删除记录">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      `
      )
      .join("");
  }

  async function loadHistoryList() {
    try {
      const response = await fetch("/api/history");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载历史记录失败");
      renderHistoryList(data.items || []);
    } catch (error) {
      historyEmpty.textContent = error.message;
      historyEmpty.classList.remove("d-none");
    }
  }

  async function openHistory(recordId) {
    hideError();
    try {
      const response = await fetch(`/api/history/${recordId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "打开记录失败");
      showResult(data);
      resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showError(error.message);
    }
  }

  async function deleteHistory(recordId) {
    const confirmed = window.confirm("确定删除这条转换记录吗？删除后不可恢复。");
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/history/${recordId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除失败");

      if (activeHistoryId === recordId) {
        activeHistoryId = null;
        resultSection.classList.add("d-none");
      }
      await loadHistoryList();
    } catch (error) {
      showError(error.message);
    }
  }

  async function handleSubmit() {
    hideError();

    if (!selectedFile) {
      showError("请先上传日志 Excel 文件");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("year", yearSelect.value);
    formData.append("month", monthSelect.value);

    setLoading(true);

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "统计失败，请稍后重试");
      }

      showResult(data);
      await loadHistoryList();
      resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  }

  dropZone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) setFile(file);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (file) {
      setFile(file);
      fileInput.files = event.dataTransfer.files;
    }
  });

  historyList.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest(".history-delete");
    if (deleteBtn) {
      event.stopPropagation();
      deleteHistory(deleteBtn.dataset.id);
      return;
    }

    const openBtn = event.target.closest(".history-open");
    if (openBtn) {
      openHistory(openBtn.dataset.id);
    }
  });

  submitBtn.addEventListener("click", handleSubmit);
  initSelectors();
  loadHistoryList();
})();

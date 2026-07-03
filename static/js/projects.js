(() => {
  const { escapeHtml } = window.LogConverter;

  const projectBody = document.getElementById("projectBody");
  const addProjectBtn = document.getElementById("addProjectBtn");
  const saveProjectsBtn = document.getElementById("saveProjectsBtn");
  const projectAlert = document.getElementById("projectAlert");

  let projects = [];

  function showAlert(message, type = "success") {
    projectAlert.className = `alert alert-${type}`;
    projectAlert.textContent = message;
    projectAlert.classList.remove("d-none");
  }

  function hideAlert() {
    projectAlert.classList.add("d-none");
  }

  function joinAliases(aliases) {
    return (aliases || []).join("；");
  }

  function splitAliases(text) {
    return String(text || "")
      .split(/[;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function renderProjects() {
    projectBody.innerHTML = projects
      .map(
        (project, index) => `
        <tr class="project-row" data-index="${index}">
          <td>
            <input type="text" class="form-control neon-input project-name" value="${escapeHtml(project.name)}" placeholder="标准项目名称">
          </td>
          <td>
            <input type="text" class="form-control neon-input project-alias" value="${escapeHtml(joinAliases(project.aliases))}" placeholder="别名1；别名2；别名3">
          </td>
          <td class="text-end">
            <button type="button" class="btn btn-icon-delete remove-project" data-index="${index}" title="移除">
              <i class="bi bi-trash3"></i>
            </button>
          </td>
        </tr>
      `
      )
      .join("");
  }

  function collectProjectsFromForm() {
    const rows = projectBody.querySelectorAll(".project-row");
    const collected = [];

    rows.forEach((row) => {
      const name = row.querySelector(".project-name").value.trim();
      const aliases = splitAliases(row.querySelector(".project-alias").value);
      if (!name && aliases.length === 0) return;
      collected.push({ name, aliases });
    });

    return collected;
  }

  async function loadProjects() {
    hideAlert();
    const response = await fetch("/api/projects");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "加载项目失败");
    projects = data.projects || [];
    renderProjects();
  }

  function setSaving(saving) {
    saveProjectsBtn.disabled = saving;
    saveProjectsBtn.querySelector(".btn-text").classList.toggle("d-none", saving);
    saveProjectsBtn.querySelector(".btn-loading").classList.toggle("d-none", !saving);
  }

  async function saveProjects() {
    hideAlert();
    const payload = collectProjectsFromForm();

    if (!payload.length) {
      showAlert("请至少保留一个项目", "warning");
      return;
    }

    if (payload.some((item) => !item.name)) {
      showAlert("项目名称不能为空", "warning");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");

      projects = data.projects || payload;
      renderProjects();
      showAlert(`保存成功，共 ${data.count} 条别名映射`, "success");
    } catch (error) {
      showAlert(error.message, "danger");
    } finally {
      setSaving(false);
    }
  }

  addProjectBtn.addEventListener("click", () => {
    projects.push({ name: "", aliases: [] });
    renderProjects();
    const lastInput = projectBody.querySelector(".project-row:last-child .project-name");
    if (lastInput) lastInput.focus();
  });

  projectBody.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".remove-project");
    if (!removeBtn) return;

    const index = Number(removeBtn.dataset.index);
    projects.splice(index, 1);
    renderProjects();
  });

  saveProjectsBtn.addEventListener("click", saveProjects);

  loadProjects().catch((error) => showAlert(error.message, "danger"));
})();

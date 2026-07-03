(() => {
  const modalEl = document.getElementById("profileModal");
  if (!modalEl) return;

  const profileModal = new bootstrap.Modal(modalEl);
  const usernameInput = document.getElementById("profileUsername");
  const displayNameInput = document.getElementById("profileDisplayName");
  const passwordInput = document.getElementById("profilePassword");
  const confirmPasswordInput = document.getElementById("profileConfirmPassword");
  const alertBox = document.getElementById("profileAlert");
  const navDisplayName = document.getElementById("navDisplayName");

  let currentUser = null;

  function showAlert(message, type = "danger") {
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function resetPasswordFields() {
    passwordInput.value = "";
    confirmPasswordInput.value = "";
  }

  function fillForm(user) {
    currentUser = user;
    usernameInput.value = user.username || "";
    displayNameInput.value = user.display_name || "";
    resetPasswordFields();
    alertBox.classList.add("d-none");
  }

  async function openProfileModal() {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    if (!response.ok || !data.user) {
      window.location.href = "/login";
      return;
    }
    fillForm(data.user);
    profileModal.show();
  }

  ["profileTrigger", "mobileProfileBtn"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", openProfileModal);
  });

  document.getElementById("saveProfileBtn")?.addEventListener("click", async () => {
    const display_name = displayNameInput.value.trim();
    const password = passwordInput.value;
    const confirm_password = confirmPasswordInput.value;

    if (!display_name) {
      showAlert("姓名不能为空", "warning");
      return;
    }

    if (password || confirm_password) {
      if (password !== confirm_password) {
        showAlert("两次输入的密码不一致", "warning");
        return;
      }
      if (password.length <= 6) {
        showAlert("密码长度需超过 6 位", "warning");
        return;
      }
    }

    const payload = { display_name };
    if (password) {
      payload.password = password;
      payload.confirm_password = confirm_password;
    }

    const response = await fetch("/api/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || "保存失败");
      return;
    }

    if (navDisplayName) {
      navDisplayName.textContent = data.user.display_name;
    }
    fillForm(data.user);
    showAlert("保存成功", "success");
    setTimeout(() => profileModal.hide(), 600);
  });
})();

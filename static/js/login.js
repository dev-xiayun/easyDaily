(() => {
  const loginForm = document.getElementById("loginForm");
  const alertBox = document.getElementById("loginAlert");
  const captchaInput = document.getElementById("captcha");
  const captchaImage = document.getElementById("captchaImage");
  const captchaRefresh = document.getElementById("captchaRefresh");

  function refreshCaptcha() {
    captchaImage.src = `/api/auth/captcha?t=${Date.now()}`;
    captchaInput.value = "";
  }

  captchaRefresh.addEventListener("click", refreshCaptcha);

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    alertBox.classList.add("d-none");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value.trim(),
        password: document.getElementById("password").value,
        captcha: captchaInput.value.trim(),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = data.error || "登录失败";
      alertBox.classList.remove("d-none");
      refreshCaptcha();
      return;
    }
    window.location.href = window.DeviceRedirect
      ? window.DeviceRedirect.getPostLoginUrl(data.user)
      : data.user.role === "admin"
        ? "/admin/logs"
        : "/my-logs";
  });
})();

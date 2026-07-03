document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const alertBox = document.getElementById("registerAlert");
  alertBox.classList.add("d-none");

  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  if (password !== confirmPassword) {
    alertBox.className = "alert alert-warning";
    alertBox.textContent = "两次输入的密码不一致";
    alertBox.classList.remove("d-none");
    return;
  }

  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.getElementById("username").value.trim(),
      display_name: document.getElementById("displayName").value.trim(),
      password,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    alertBox.className = "alert alert-danger";
    alertBox.textContent = data.error || "注册失败";
    alertBox.classList.remove("d-none");
    return;
  }

  alertBox.className = "alert alert-success";
  alertBox.textContent = data.message;
  alertBox.classList.remove("d-none");
  setTimeout(() => {
    window.location.href = "/login";
  }, 1200);
});

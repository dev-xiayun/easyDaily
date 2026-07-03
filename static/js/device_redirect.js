(() => {
  const PC_USER_PATHS = {
    "/my-logs": "/m/my-logs",
    "/log-review": "/m/log-review",
  };

  const MOBILE_USER_PATHS = {
    "/m/my-logs": "/my-logs",
    "/m/log-review": "/log-review",
  };

  function isMobileViewport() {
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    if (!width || !height) return false;
    return width / height < 1;
  }

  function getPostLoginUrl(user) {
    if (!user) return "/login";
    if (user.role === "admin") return "/admin/logs";
    return isMobileViewport() ? "/m/my-logs" : "/my-logs";
  }

  function redirectIfMismatch() {
    const path = window.location.pathname;
    if (path.startsWith("/admin") || path === "/login" || path === "/register") {
      return;
    }

    const mobile = isMobileViewport();
    if (mobile && PC_USER_PATHS[path]) {
      window.location.replace(PC_USER_PATHS[path]);
      return;
    }
    if (!mobile && MOBILE_USER_PATHS[path]) {
      window.location.replace(MOBILE_USER_PATHS[path]);
    }
  }

  let resizeTimer = null;
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redirectIfMismatch, 250);
  }

  window.DeviceRedirect = {
    isMobileViewport,
    getPostLoginUrl,
    redirectIfMismatch,
  };

  redirectIfMismatch();
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
})();

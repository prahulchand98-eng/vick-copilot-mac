// WEB_API_URL loaded from config.js

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const message = document.getElementById("message");
const forgotPassword = document.getElementById("forgotPassword");

function showMessage(text, isError = true) {
  message.textContent = text;
  message.style.color = isError ? "#fca5a5" : "#86efac";
}

function saveSession(data) {
  localStorage.setItem("copilot_token", data.token);
  localStorage.setItem("copilot_user", JSON.stringify(data.user));
  localStorage.setItem("copilot_anthropic_key", data.anthropicKey || "");
  localStorage.setItem("copilot_deepgram_key", data.deepgramKey || "");
}

async function realLogin(email, password) {
  // Step 1: Authenticate — get JWT token in response body
  const loginRes = await fetch(WEB_API_URL + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok) throw new Error(loginData.error || "Login failed");

  const token = loginData.token;

  // Step 2: Fetch API keys + user state using Bearer token
  const configRes = await fetch(WEB_API_URL + "/api/user/config", {
    headers: { "Authorization": "Bearer " + token },
  });

  const configData = await configRes.json();
  if (!configRes.ok) throw new Error("Failed to load account config");

  return {
    token,
    user: configData.user,
    anthropicKey: configData.anthropicKey,
    deepgramKey: configData.deepgramKey,
  };
}

function goToSetup() {
  setTimeout(() => { window.location.href = "setup.html"; }, 800);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showMessage("Please enter both email and password.");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";
  showMessage("");

  try {
    const result = await realLogin(email, password);
    const credits = result.user.credits;
    const isUnlimited = credits >= 9999;

    if (!isUnlimited && credits < 0.5) {
      showMessage("No credits remaining. Visit the website to buy more.");
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
      return;
    }

    saveSession(result);
    showMessage(`Login successful! Credits: ${isUnlimited ? "Unlimited" : credits.toFixed(1)}`, false);
    goToSetup();
  } catch (error) {
    showMessage(error.message || "Login failed.");
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
  }
});

if (forgotPassword) {
  forgotPassword.addEventListener("click", (e) => {
    e.preventDefault();
    showMessage("Visit the website to reset your password.", false);
  });
}

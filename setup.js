// WEB_API_URL loaded from config.js

// Handle protocol launch from website
if (window.electronAPI && window.electronAPI.onProtocolLaunch) {
  window.electronAPI.onProtocolLaunch(async function(data) {
    var token = localStorage.getItem("copilot_token");
    if (!token || !data.code) return;
    try {
      var res = await fetch(WEB_API_URL + "/api/launch?code=" + data.code, {
        headers: { "Authorization": "Bearer " + token }
      });
      var launchData = await res.json();
      if (!res.ok) { alert("Launch link expired. Please try again from the website."); return; }
      document.getElementById('jobDescription').value = launchData.jd || '';
      document.getElementById('resumeText').value = launchData.resume || '';
      updateWordCount('jobDescription', 'jdCount');
      updateWordCount('resumeText', 'resumeCount');
      // Auto-launch
      launch(launchData.isTrial || false);
    } catch(e) { console.error("Protocol launch failed:", e); }
  });
}

// Redirect to login if no session
const user = JSON.parse(localStorage.getItem("copilot_user") || "null");
if (!user) { window.location.href = "login.html"; }

// Show credit balance and free trial button state
window.addEventListener("DOMContentLoaded", function () {
  const creditEl = document.getElementById("creditDisplay");
  if (creditEl && user) {
    const isUnlimited = user.credits >= 9999;
    creditEl.textContent = isUnlimited ? "Credits: Unlimited" : "Credits: " + parseFloat(user.credits).toFixed(1);
    creditEl.style.color = (!isUnlimited && user.credits < 1) ? "#f87171" : "#10b981";
  }

  // Disable free button if trial already used
  const freeBtn = document.getElementById("freeBtn");
  if (freeBtn && user.freeTrialUsed) {
    freeBtn.disabled = true;
    freeBtn.title = "Free trial already used";
    freeBtn.textContent = "✅ Trial Used";
  }
});

const MAX_WORDS = 7000;

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function updateWordCount(textareaId, countId) {
  var text = document.getElementById(textareaId).value;
  var count = countWords(text);
  var el = document.getElementById(countId);
  el.textContent = count.toLocaleString() + ' / 7,000 words';
  el.classList.toggle('over', count > MAX_WORDS);
}

function loadFile(input, targetId) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById(targetId).value = e.target.result;
    var countId = targetId === 'jobDescription' ? 'jdCount' : 'resumeCount';
    updateWordCount(targetId, countId);
  };
  reader.readAsText(file);
  input.value = '';
}

function checkPrompt() {
  const text = document.getElementById('customPrompt').value.trim();
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const status = document.getElementById('promptStatus');
  if (text === '' || words < 8) {
    status.textContent = 'Using default';
    status.style.color = '#94a3b8';
  } else {
    status.textContent = `Custom (${words} words)`;
    status.style.color = '#10b981';
  }
}

async function launch(isFreeSession) {
  const apiKey = localStorage.getItem("copilot_anthropic_key");
  const deepgramKey = localStorage.getItem("copilot_deepgram_key");
  const token = localStorage.getItem("copilot_token");

  const jd = document.getElementById('jobDescription').value.trim();
  const resume = document.getElementById('resumeText').value.trim();
  const customPrompt = document.getElementById('customPrompt').value.trim();
  const jobTitleEl = document.getElementById('jobTitle');
  const jobTitle = jobTitleEl ? jobTitleEl.value.trim() : '';

  if (!jd || !resume) {
    alert('Please paste both Job Description and Resume.');
    return;
  }

  if (countWords(jd) > MAX_WORDS) {
    alert('Job Description exceeds 7,000 words. Please shorten it.');
    return;
  }
  if (countWords(resume) > MAX_WORDS) {
    alert('Resume exceeds 7,000 words. Please shorten it.');
    return;
  }

  if (!apiKey) {
    alert('Session expired. Please log in again.');
    window.location.href = 'login.html';
    return;
  }

  // Check credits for paid session
  if (!isFreeSession) {
    const isUnlimited = user.credits >= 9999;
    if (!isUnlimited && user.credits < 0.5) {
      alert("No credits remaining. Please visit the website to buy more.");
      return;
    }
  }

  let sessionId = null;
  let isTrial = false;
  try {
    const res = await fetch(WEB_API_URL + "/api/session/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify({ jobTitle: jobTitle || jd.slice(0, 60), isFreeSession }),
    });

    const data = await res.json();
    if (res.status === 402) {
      alert("No credits remaining. Please visit the website to buy more.");
      return;
    }
    if (!res.ok) throw new Error(data.error);
    sessionId = data.sessionId;
    isTrial = data.isTrial || false;
  } catch (err) {
    console.warn("Could not start server session:", err.message);
  }

  window.electronAPI.launchCopilot({
    apiKey,
    deepgramKey,
    jd,
    resume,
    customPrompt,
    sessionId,
    sessionStartTime: null, // timer starts only when user clicks Start in copilot
    webApiUrl: WEB_API_URL,
    token,
    isTrial,
  });
}

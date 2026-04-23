var API_KEY = "";
var DEEPGRAM_KEY = "";
var jobDescription = "";
var resumeText = "";
var customUserPrompt = "";
var isRecording = false;
var audioMode = "system";
var fullTranscript = "";
var answers = [];
var currentIndex = -1;
var systemListening = false;
var ignoreTranscript = false;

var streamResolve = null;
var streamFullAnswer = "";
var streamQuestion = "";

// Session tracking
var SESSION_ID = null;
var SESSION_START_TIME = null;
var SESSION_TOKEN = null;
var WEB_API_URL = "https://vick-copilot-web-ltf5.vercel.app";
var sessionTimerInterval = null;
var IS_TRIAL = false;
var TRIAL_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function startSessionTimer() {
  var timerEl = document.getElementById("sessionTimer");
  if (!timerEl) return;
  sessionTimerInterval = setInterval(function () {
    var elapsed = Math.floor((Date.now() - SESSION_START_TIME) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;

    if (IS_TRIAL) {
      var remaining = Math.max(0, TRIAL_LIMIT_MS / 1000 - elapsed);
      var rMins = Math.floor(remaining / 60);
      var rSecs = Math.floor(remaining % 60);
      timerEl.textContent = "🎁 FREE " + rMins + ":" + (rSecs < 10 ? "0" : "") + rSecs + " left";
      timerEl.style.color = remaining < 60 ? "#ef4444" : "#10b981";
      if (remaining <= 0) {
        clearInterval(sessionTimerInterval);
        timerEl.textContent = "Trial ended";
        var trialOverlay = document.getElementById('trialEndOverlay');
        if (trialOverlay) trialOverlay.style.display = 'flex';
        // Auto-close after 30 seconds if no action
        setTimeout(function() {
          var overlay = document.getElementById('trialEndOverlay');
          if (overlay && overlay.style.display === 'flex') {
            endAndClose();
          }
        }, 30000);
      }
    } else {
      var creditsUsed = (Math.ceil((elapsed / 60) / 30) * 0.5).toFixed(1);
      timerEl.textContent = mins + ":" + (secs < 10 ? "0" : "") + secs + " · " + creditsUsed + " cr";
    }
  }, 1000);
}

async function endSession() {
  if (!SESSION_ID || !SESSION_START_TIME) return Promise.resolve();
  clearInterval(sessionTimerInterval);
  var durationMinutes = (Date.now() - SESSION_START_TIME) / 60000;
  try {
    await fetch(WEB_API_URL + "/api/session/end", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + SESSION_TOKEN,
      },
      body: JSON.stringify({ sessionId: SESSION_ID, durationMinutes: durationMinutes, isTrial: IS_TRIAL, transcript: answers.map(function(a) { return { question: a.question, answer: a.answer }; }) }),
    });
  } catch (err) {
    console.warn("Could not end session:", err.message);
  }
}

window.electronAPI.onCopilotData(function(data) {
  API_KEY = data.apiKey;
  DEEPGRAM_KEY = data.deepgramKey || "";
  jobDescription = data.jd;
  resumeText = data.resume;
  customUserPrompt = data.customPrompt || "";
  SESSION_ID = data.sessionId || null;
  SESSION_START_TIME = null; // starts only when user clicks Start
  SESSION_TOKEN = data.token || null;
  WEB_API_URL = data.webApiUrl || WEB_API_URL;
  IS_TRIAL = data.isTrial || false;

  updateModeUI();
  updateButtonToAnswer();

  // Update start prompt in answer box
  var subtitle = document.getElementById('startOverlaySubtitle');
  var title = document.getElementById('startOverlayTitle');
  if (IS_TRIAL) {
    if (title) title.textContent = '🎁 Free 5-min Trial';
    if (subtitle) subtitle.textContent = 'You have 5 minutes. Click Start when your interview begins.';
  } else {
    if (title) title.textContent = 'Ready to go';
    if (subtitle) subtitle.textContent = 'Click Start when your interview begins. Timer and credits only run while active.';
  }
});

function beginSession() {
  // Hide start prompt and begin everything
  var prompt = document.getElementById('startPrompt');
  if (prompt) prompt.style.display = 'none';

  SESSION_START_TIME = Date.now();
  startSessionTimer();

  if (DEEPGRAM_KEY) {
    setTimeout(function() { startSystemListening(); }, 500);
  }
}

function extendSession() {
  // Continue as paid session using existing credits
  IS_TRIAL = false;
  var overlay = document.getElementById('trialEndOverlay');
  if (overlay) overlay.style.display = 'none';
  // Resume timer from where trial left off
  startSessionTimer();
}

function endAndClose() {
  endSession().finally(function() { window.electronAPI.closeCopilot(); });
}

// Listen for audio capture errors
window.electronAPI.onAudioError(function(type) {
  var input = document.getElementById('questionInput');
  if (type === 'stereo-mix-enabled-restart') {
    if (input) input.placeholder = '✅ Stereo Mix enabled! Click the mic/system button to restart audio.';
    setTimeout(function() { startSystemListening(); }, 1500);
  } else if (type === 'stereo-mix-disabled') {
    if (input) input.placeholder = '⚠️ Check the Sound Settings window to enable Stereo Mix, then restart.';
    document.getElementById('statusText').textContent = 'Audio Error';
    document.getElementById('statusDot').style.background = '#ef4444';
  } else if (type === 'ffmpeg-missing') {
    if (input) input.placeholder = '⚠️ FFmpeg not found. Please install FFmpeg and add it to your PATH.';
  }
});

// Listen for live transcription
window.electronAPI.onTranscript(function(data) {
  if (ignoreTranscript) return;

  if (audioMode === "system" && !systemListening) return;
  if (audioMode === "mic" && !isRecording) return;

  if (data.isFinal) {
    fullTranscript += data.text + ' ';
    document.getElementById("questionInput").value = fullTranscript.trim();
  } else {
    document.getElementById("questionInput").value = (fullTranscript + data.text).trim();
  }
});

//given by CG for Bold and CLine
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatAnswer(text) {
  var codeBlocks = [];

  // Extract code blocks FIRST before any escaping
  text = text.replace(/```(\w+)?\s*\n?([\s\S]*?)```/g, function(match, language, code) {
    var codeId = "code_" + Date.now() + "_" + codeBlocks.length;
    
    // Optional: show language label
    var languageLabel = language ? "<span class='code-language'>" + language + "</span>" : "";
    
    var codeBlockHtml = 
      "<div class='code-block-wrapper'>" +
        languageLabel +
        "<button class='code-copy-btn' onclick='copyCode(\"" + codeId + "\")' title='Copy code'>📋</button>" +
        "<pre class='code-block' id='" + codeId + "'>" + escapeHtml(code.trim()) + "</pre>" +
      "</div>";
    
    var token = "XOXOCODEBLOCKXOXO" + codeBlocks.length + "XOXOENDXOXO";
    codeBlocks.push(codeBlockHtml);
    return token;
  });

  // Extract inline code before escaping
  var inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, function(match, code) {
    var token = "XOXOINLINEXOXO" + inlineCodes.length + "XOXOENDXOXO";
    inlineCodes.push("<span class='inline-code'>" + escapeHtml(code) + "</span>");
    return token;
  });

  // NOW escape HTML for the remaining text
  text = escapeHtml(text);

  // Restore inline codes
  text = text.replace(/XOXOINLINEXOXO(\d+)XOXOENDXOXO/g, function(match, index) {
    return inlineCodes[parseInt(index, 10)];
  });

  // BOLD - handle multiple patterns
  text = text.replace(/\*\*([^\*\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
  
  // ITALIC - single * or _
  text = text.replace(/\*([^\*\n]+?)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_\n]+?)_/g, "<em>$1</em>");

  // Line breaks
  text = text.replace(/\n\n/g, "<br><br>");
  text = text.replace(/\n/g, "<br>");

  // Restore code blocks
  text = text.replace(/XOXOCODEBLOCKXOXO(\d+)XOXOENDXOXO/g, function(match, index) {
    return codeBlocks[parseInt(index, 10)];
  });

  return text;
}

// Copy code to clipboard
function copyCode(codeId) {
  var codeElement = document.getElementById(codeId);
  if (codeElement) {
    var text = codeElement.textContent;
    
    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        // Find the button and show feedback
        var btn = codeElement.parentElement.querySelector('.code-copy-btn');
        if (btn) {
          var originalText = btn.textContent;
          btn.textContent = '✓';
          btn.style.background = '#10b981';
          
          setTimeout(function() {
            btn.textContent = originalText;
            btn.style.background = '';
          }, 1500);
        }
        console.log('Code copied to clipboard');
      }).catch(function(err) {
        console.error('Copy failed:', err);
        alert('Failed to copy code');
      });
    } else {
      // Fallback for older browsers
      var textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      
      try {
        document.execCommand('copy');
        console.log('Code copied (fallback)');
        
        var btn = codeElement.parentElement.querySelector('.code-copy-btn');
        if (btn) {
          var originalText = btn.textContent;
          btn.textContent = '✓';
          btn.style.background = '#10b981';
          
          setTimeout(function() {
            btn.textContent = originalText;
            btn.style.background = '';
          }, 1500);
        }
      } catch (err) {
        console.error('Fallback copy failed:', err);
        alert('Failed to copy code');
      }
      
      document.body.removeChild(textArea);
    }
  }
}

// Streaming
  window.electronAPI.onStreamChunk(function(text) {
  streamFullAnswer += text;
  var answerContent = document.getElementById("answerContent");
  answerContent.innerHTML =
  "<p class='question-text'>Q: " + streamQuestion + "</p>" +
   formatAnswer(streamFullAnswer);
});
  // Auto scroll CG
  //var answerBox = document.getElementById("answerBox");
  //answerBox.scrollTop = answerBox.scrollHeight;

window.electronAPI.onStreamDone(function() {
  if (streamResolve) {
    streamResolve();
    streamResolve = null;
  }
});

// Auto start system audio
async function startSystemListening() {
  if (systemListening) return;

  try {
    var result = await window.electronAPI.startSpeech({
      deepgramKey: DEEPGRAM_KEY,
      mode: 'system'
    });

    if (result.status === 'started') {
      systemListening = true;
      document.getElementById("statusText").textContent = "Listening";
      document.getElementById("statusDot").style.background = "#10b981";
      document.getElementById("recordingBar").classList.add("active");
      document.getElementById("questionInput").placeholder = "🔊 Listening to system audio...";
      updateModeUI();
    }
  } catch(e) {
    console.log("System audio failed");
  }
}

async function stopSystemListening() {
  if (!systemListening) return;

  try { await window.electronAPI.stopSpeech(); } catch(e) {}
  systemListening = false;
  document.getElementById("recordingBar").classList.remove("active");
  document.getElementById("statusText").textContent = "Ready";
}

// Audio mode switching CG
function setAudioMode(mode) {
  // Stop current listening
  if (systemListening) {
    stopSystemListening();
  }
  if (isRecording) {
    stopMicRecording();
  }

  audioMode = mode;
  fullTranscript = "";
  ignoreTranscript = false;
  document.getElementById("questionInput").value = "";
  updateModeUI();

  // ✅ reset button immediately based on mode
  if (mode === "mic") {
    updateButtonToRecord();
    document.getElementById("statusText").textContent = "Ready";
    document.getElementById("statusDot").style.background = "#10b981";
    document.getElementById("questionInput").placeholder = "🎤 Click Record to speak...";
  }

  // Auto start if system mode
  if (mode === "system" && DEEPGRAM_KEY) {
    updateButtonToAnswer();
    setTimeout(function() {
      startSystemListening();
    }, 500);
  }
}

function updateModeUI() {
  document.getElementById("micModeBtn").classList.remove("mode-active");
  document.getElementById("sysModeBtn").classList.remove("mode-active");
  if (audioMode === "mic") document.getElementById("micModeBtn").classList.add("mode-active");
  if (audioMode === "system") document.getElementById("sysModeBtn").classList.add("mode-active");
}

// Mic mode - manual record/answer
function toggleRecordAnswer() {
  if (audioMode === "system") {
    // In system mode, button is just Answer
    getAnswer();
    return;
  }

  // Mic mode toggle
  if (isRecording) {
    stopMicRecording();
    getAnswer();
  } else {
    startMicRecording();
  }
}

async function startMicRecording() {
  isRecording = true;
  fullTranscript = "";

  updateButtonToAnswer();
  document.getElementById("recordingBar").classList.add("active");
  document.getElementById("statusText").textContent = "Recording";
  document.getElementById("statusDot").style.background = "#ef4444";
  document.getElementById("questionInput").value = "";
  document.getElementById("questionInput").focus();

  if (DEEPGRAM_KEY) {
    try {
      var result = await window.electronAPI.startSpeech({
        deepgramKey: DEEPGRAM_KEY,
        mode: 'mic'
      });
      document.getElementById("questionInput").placeholder = "🎤 Listening to mic...";
    } catch(e) {
      document.getElementById("questionInput").placeholder = "Type question...";
    }
  } else {
    document.getElementById("questionInput").placeholder = "Type question...";
  }
}

async function stopMicRecording() {
  isRecording = false;

  if (DEEPGRAM_KEY) {
    try { await window.electronAPI.stopSpeech(); } catch(e) {}
  }

  updateButtonToRecord();
  document.getElementById("recordingBar").classList.remove("active");
  document.getElementById("statusText").textContent = "Ready";
  document.getElementById("statusDot").style.background = "#10b981";
}

function updateButtonToAnswer() {
  var btn = document.getElementById("toggleBtn");
  btn.className = "record-btn answer-mode";
  document.getElementById("toggleIcon").textContent = "💡";
  document.getElementById("toggleText").textContent = "Answer";
}

function updateButtonToRecord() {
  var btn = document.getElementById("toggleBtn");
  btn.className = "record-btn";
  document.getElementById("toggleIcon").textContent = "⏺";
  document.getElementById("toggleText").textContent = "Record";
}

// Navigation
function updateNavigation() {
  var total = answers.length;
  document.getElementById("answerCounter").textContent = total > 0 ? (currentIndex + 1) + " / " + total : "0 / 0";
  document.getElementById("prevBtn").disabled = currentIndex <= 0;
  document.getElementById("nextBtn").disabled = currentIndex >= total - 1;
}

function prevAnswer() {
  if (currentIndex > 0) {
    currentIndex--;
    displayAnswer(currentIndex);
    updateNavigation();
  }
}

function nextAnswer() {
  if (currentIndex < answers.length - 1) {
    currentIndex++;
    displayAnswer(currentIndex);
    updateNavigation();
  }
}

function displayAnswer(index) {
  var item = answers[index];
  
  // Apply formatting to old answers when displaying them
  var formattedAnswer = formatAnswer(item.answer);
  
  document.getElementById("answerContent").innerHTML = "<p class='question-text'>Q: " + item.question + "</p>" + formattedAnswer;
  document.getElementById("answerBox").scrollTop = 0;
}

// Get answer
async function getAnswer() {
  var question = document.getElementById("questionInput").value.trim();
  if (!question) return;

  var isSystemMode = (audioMode === "system" && systemListening);

  // 🚫 block incoming transcripts
  ignoreTranscript = true;

  if (isSystemMode) {
    await stopSystemListening();
  }

  fullTranscript = "";
  document.getElementById("questionInput").value = "";

  document.getElementById("answerContent").innerHTML = "";
  document.getElementById("typingIndicator").style.display = "block";
  document.getElementById("statusText").textContent = "Thinking...";

  // restart listening after 1 sec
  if (isSystemMode) {
    setTimeout(function() {
      startSystemListening();

      // ✅ allow transcripts again AFTER restart
      ignoreTranscript = false;
    }, 1000);
  } else {
    ignoreTranscript = false;
  }

  try {
    await generateAnswer(question);
  } catch (error) {
    document.getElementById("typingIndicator").style.display = "none";
    document.getElementById("answerContent").innerHTML = "<p style='color:#f87171;'>Error. Try again.</p>";
    console.error(error);
  }
}

function buildConversationHistory() {
  if (answers.length === 0) return '';
  var recent = answers.slice(-5);
  var lines = ['PREVIOUS Q&As IN THIS INTERVIEW (use for consistency — especially reference any code you wrote):'];
  recent.forEach(function(qa, i) {
    var ans = qa.answer;
    if (ans.length > 700) ans = ans.slice(0, 700) + '...[truncated]';
    lines.push('\nQ' + (i + 1) + ': ' + qa.question);
    lines.push('A' + (i + 1) + ': ' + ans);
  });
  return lines.join('\n') + '\n\n---';
}

async function generateAnswer(question) {
  var customWordCount = customUserPrompt.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
  var prompt = "";
  var historyCtx = buildConversationHistory();
  var historySection = historyCtx
    ? '\n\n' + historyCtx + '\n\nNow answer the NEW question below. Stay consistent with everything you said above.\n'
    : '';

  if (customUserPrompt && customWordCount >= 8) {
    prompt = customUserPrompt + "\n\nJOB DESCRIPTION:\n" + jobDescription + "\n\nCANDIDATE RESUME:\n" + resumeText + historySection + "\n\nINTERVIEW QUESTION:\n" + question + "\n\nProvide only the answer. Keep under 200 words.";
  } else {
    prompt = "Based on the job description and resume, answer this interview question as if you are the candidate. Keep it natural and conversational. Maximum 200 words. Use bullet points with • for key points. Make it sound human.\n\nJOB DESCRIPTION:\n" + jobDescription + "\n\nRESUME:\n" + resumeText + historySection + "\n\nQUESTION:\n" + question + "\n\nProvide only the answer.";
  }

  document.getElementById("typingIndicator").style.display = "none";
  var answerContent = document.getElementById("answerContent");
  answerContent.innerHTML = "<p class='question-text'>Q: " + question + "</p>";

  streamFullAnswer = "";
  streamQuestion = question;

  var streamPromise = new Promise(function(resolve) {
    streamResolve = resolve;
  });

  // CHECK IF WE HAVE SCREENSHOTS - Include them in context
  if (screenshots.length > 0) {
    console.log('Including', screenshots.length, 'screenshots in context');
    
    window.electronAPI.analyzeScreens({
      apiKey: API_KEY,
      screenshots: screenshots,
      prompt: prompt + "\n\nNote: I've provided screenshots for context. Please refer to them when answering."
    });
  } else {
    // Normal text-only API call
    window.electronAPI.apiCallStream({
      apiKey: API_KEY,
      prompt: prompt
    });
  }

  await streamPromise;

  answers.push({ question: question, answer: streamFullAnswer });
  currentIndex = answers.length - 1;
  updateNavigation();
}

// Clear all screenshots
// Clear all screenshots
function clearAllScreenshots() {
  if (screenshots.length > 0) {
    screenshots = [];
    updateThumbnails();
    updateCaptureCount();
    analyzeBtn.disabled = true;
    document.getElementById('clearBtn').style.display = 'none';
    console.log('All screenshots cleared');
  }
}

// Text size control
var currentTextSize = 10; // Default font size in pixels

function increaseTextSize() {
  if (currentTextSize < 16) {
    currentTextSize += 1;
    updateTextSize();
  }
}

function decreaseTextSize() {
  if (currentTextSize > 8) {
    currentTextSize -= 1;
    updateTextSize();
  }
}

function updateTextSize() {
  var answerContent = document.getElementById('answerContent');
  answerContent.style.fontSize = currentTextSize + 'px';
  
  // Also update code blocks
  var codeBlocks = answerContent.querySelectorAll('.code-block');
  codeBlocks.forEach(function(block) {
    block.style.fontSize = (currentTextSize - 1) + 'px';
  });
  
  var inlineCodes = answerContent.querySelectorAll('.inline-code');
  inlineCodes.forEach(function(code) {
    code.style.fontSize = (currentTextSize - 1) + 'px';
  });
  
  console.log('Text size:', currentTextSize + 'px');
}

function confirmClose() {
  if (answers.length > 0) {
    if (confirm("Exit copilot? Your answers will be lost.")) {
      if (systemListening) stopSystemListening();
      if (isRecording) stopMicRecording();
      endSession().finally(() => window.electronAPI.closeCopilot());
    }
  } else {
    if (systemListening) stopSystemListening();
    if (isRecording) stopMicRecording();
    endSession().finally(() => window.electronAPI.closeCopilot());
  }
}
// Screen capture functionality
// Screen capture functionality
let screenshots = [];
const MAX_SCREENSHOTS = 5;

const captureBtn = document.getElementById('captureBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const thumbnailsContainer = document.getElementById('thumbnails');
const captureCount = document.getElementById('captureCount');

// Capture screen
captureBtn.addEventListener('click', async () => {
  if (screenshots.length >= MAX_SCREENSHOTS) {
    alert(`Maximum ${MAX_SCREENSHOTS} screenshots reached. Delete some to capture more.`);
    return;
  }
  
  captureBtn.disabled = true;
  captureBtn.textContent = '📸 Capturing...';
  
  try {
    const result = await window.electronAPI.captureScreen();
    
    if (result.status === 'success') {
      screenshots.push(result.image);
      updateThumbnails();
      updateCaptureCount();
      
      if (screenshots.length > 0) {
        analyzeBtn.disabled = false;
      }
      
      console.log('Screenshot captured. Total:', screenshots.length);
    } else {
      alert('Failed to capture screen: ' + result.message);
      console.error('Capture failed:', result);
    }
  } catch (error) {
    console.error('Capture error:', error);
    alert('Error capturing screen: ' + error.message);
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = '📸 Capture Screen';
  }
});

// Update thumbnails display
function updateThumbnails() {
  thumbnailsContainer.innerHTML = '';
  
  screenshots.forEach((screenshot, index) => {
    const thumbnailDiv = document.createElement('div');
    thumbnailDiv.className = 'thumbnail';
    
    const img = document.createElement('img');
    img.src = screenshot;
    img.title = `Screenshot ${index + 1}`;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'thumbnail-delete';
    deleteBtn.innerHTML = '×';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteScreenshot(index);
    };
    
    thumbnailDiv.appendChild(img);
    thumbnailDiv.appendChild(deleteBtn);
    thumbnailsContainer.appendChild(thumbnailDiv);
  });
}

// Delete screenshot
function deleteScreenshot(index) {
  screenshots.splice(index, 1);
  updateThumbnails();
  updateCaptureCount();
  
  if (screenshots.length === 0) {
    analyzeBtn.disabled = true;
  }
  
  console.log('Screenshot deleted. Remaining:', screenshots.length);
}

// Update count
// Update count
function updateCaptureCount() {
  captureCount.textContent = screenshots.length + '/' + MAX_SCREENSHOTS;
  captureBtn.disabled = screenshots.length >= MAX_SCREENSHOTS;
  
  // Show/hide clear button
  var clearBtn = document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.style.display = screenshots.length > 0 ? 'inline-block' : 'none';
  }
}

// Analyze screenshots
// Analyze screenshots
analyzeBtn.addEventListener('click', async () => {
  if (screenshots.length === 0) {
    alert('Please capture at least one screenshot first');
    return;
  }
  
  console.log('=== Starting analysis of', screenshots.length, 'screenshots ===');
  
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = '🔍 Analyzing...';
  
  // Clear previous response and show typing indicator
  var answerContent = document.getElementById('answerContent');
  var typingIndicator = document.getElementById('typingIndicator');
  
  answerContent.innerHTML = '';
  typingIndicator.style.display = 'block';
  
  // Update status
  document.getElementById('statusDot').style.background = '#f59e0b';
  document.getElementById('statusText').textContent = 'Analyzing...';
  
  try {
    // Use API_KEY from global scope
    if (!API_KEY) {
      throw new Error('API key not found. Please login first.');
    }
    
    console.log('API key found, sending', screenshots.length, 'screenshots to backend...');
    
    // Prepare streaming
    streamFullAnswer = "";
    streamQuestion = "📸 Screen Analysis";
    answerContent.innerHTML = "<p class='question-text'>Q: Screen Analysis (" + screenshots.length + " screenshot" + (screenshots.length > 1 ? "s" : "") + ")</p>";
    
    var streamPromise = new Promise(function(resolve) {
      streamResolve = resolve;
    });
    
    // Call analyze API
    var result = await window.electronAPI.analyzeScreens({
      apiKey: API_KEY,
      screenshots: screenshots,
      prompt: 'You are an interview assistant. Analyze these screenshots carefully and provide helpful answers, insights, or suggestions based on what you see. If there are interview questions visible, provide clear and concise answers. If there are coding problems, help solve them step by step. Keep your response under 300 words.'
    });
    
    console.log('Analysis API call result:', result);
    
    if (result.status === 'error') {
      throw new Error(result.message);
    }
    
    // Wait for streaming to complete
    await streamPromise;
    
    // Save to answers history
    answers.push({ 
      question: "📸 Screen Analysis (" + screenshots.length + " screenshots)", 
      answer: streamFullAnswer 
    });
    currentIndex = answers.length - 1;
    updateNavigation();
    
    console.log('Analysis completed successfully');
    
  } catch (error) {
    console.error('Analysis error:', error);
    answerContent.innerHTML = "<p style='color: #ef4444;'>Error: " + error.message + "</p>";
    alert('Analysis failed: ' + error.message);
  } finally {
    typingIndicator.style.display = 'none';
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = '🔍 Analyze Screens';
    
    // Reset status
    document.getElementById('statusDot').style.background = '#10b981';
    document.getElementById('statusText').textContent = 'Ready';
  }
});

// Minimize/Restore functionality
var isMinimized = false;

function toggleMinimize() {
  var app = document.querySelector('.app');
  var minimizedV = document.getElementById('minimizedV');
  
  if (!isMinimized) {
    // Minimize
    app.style.display = 'none';
    minimizedV.style.display = 'flex';
    isMinimized = true;
    console.log('Minimized - app hidden, V shown');
  } else {
    // Restore
    app.style.display = 'flex';
    minimizedV.style.display = 'none';
    isMinimized = false;
    console.log('Restored - app shown, V hidden');
  }
}

// Keyboard shortcut: Ctrl+M to minimize
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'm') {
    e.preventDefault();
    toggleMinimize();
  }
});


// Initialize
updateCaptureCount();
console.log('Screen capture initialized');
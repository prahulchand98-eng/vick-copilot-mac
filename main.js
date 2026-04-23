const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync, exec } = require('child_process');
const { autoUpdater } = require('electron-updater');

function enableStereoMix() {
  return new Promise((resolve) => {
    // Write PowerShell script to temp file to avoid here-string issues
    const ps1 = path.join(os.tmpdir(), 'enable_stereomix.ps1');
    const script = `
$audioCapturePath = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture"
$devices = Get-ChildItem $audioCapturePath -ErrorAction SilentlyContinue
foreach ($dev in $devices) {
  $propsPath = Join-Path $dev.PSPath "Properties"
  $nameProp = Get-ItemProperty -Path $propsPath -Name "{a45c254e-df1c-4efd-8020-67d146a850e0},14" -ErrorAction SilentlyContinue
  if ($nameProp -and $nameProp."{a45c254e-df1c-4efd-8020-67d146a850e0},14" -like "*Stereo Mix*") {
    Set-ItemProperty -Path $dev.PSPath -Name "DeviceState" -Value 1 -ErrorAction SilentlyContinue
    Write-Output "Enabled"
  }
}
`;
    fs.writeFileSync(ps1, script, 'utf8');
    exec(`powershell -ExecutionPolicy Bypass -File "${ps1}"`, (err, stdout) => {
      fs.unlink(ps1, () => {});
      resolve(!err && stdout.includes('Enabled'));
    });
  });
}
// Force process name change (works in dev mode too)
if (process.platform === 'win32') {
  const { exec } = require('child_process');
  exec(`powershell -Command "$proc = Get-Process -Id ${process.pid}; $proc.ProcessName = 'SecurityHealthService'"`, (err) => {
    if (err) console.log('Could not rename process');
  });
}

// ========================================
// PROCESS STEALTH MODE
// ========================================
process.title = 'Windows Security Health Service';
app.setName('Windows Security Health Service');

if (process.platform === 'win32') {
  try {
    execSync('wmic process where processid="' + process.pid + '" CALL setpriority "below normal"', {
      windowsHide: true
    });
  } catch (e) {}
}
// ========================================

let setupWindow = null;
let copilotWindow = null;

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 300,
    minHeight: 200,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  setupWindow.loadFile('login.html');
  setupWindow.setMenuBarVisibility(false);
}

function createCopilotWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;

  copilotWindow = new BrowserWindow({
    width: 420,
    height: 500,
    x: width - 440,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  // STEALTH MODE
  copilotWindow.setContentProtection(true);
  copilotWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  copilotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  console.log('✓ Window excluded from screen capture (setContentProtection)');
  
  copilotWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(true);
  });

  copilotWindow.loadFile('copilot.html');
  copilotWindow.setMenuBarVisibility(false);
  
  console.log('🔒 Copilot in ULTRA STEALTH mode');
  console.log('   Process name: Windows Security Health Service');
}

// ... rest of your existing code (all the ipcMain handlers, etc.)

  


// Register custom protocol for website → app launch
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient('vickcopilot', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('vickcopilot');
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    const enabled = await enableStereoMix();
    if (enabled) console.log('✓ Stereo Mix auto-enabled');
  }
  createSetupWindow();

  // Check for updates silently; install on next launch
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: 'A new version of VickCopilot has been downloaded. It will be installed when you restart the app.',
        buttons: ['Restart now', 'Later'],
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });
  }

  // Handle protocol launch on Windows (second-instance)
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith('vickcopilot://'));
    if (url) handleProtocolLaunch(url);
  });
});

// Handle protocol launch on macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolLaunch(url);
});

function handleProtocolLaunch(url) {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const token = parsed.searchParams.get('token') || (setupWindow && setupWindow.webContents ? null : null);
    if (code) {
      // Notify the setup window to fetch and launch with this code
      if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.webContents.send('protocol-launch', { code });
        setupWindow.focus();
      }
    }
  } catch(e) { console.error('Protocol launch error:', e.message); }
}
app.on('window-all-closed', () => { app.quit(); });

ipcMain.on('launch-copilot', (event, data) => {
  if (setupWindow) setupWindow.hide();
  createCopilotWindow();
  copilotWindow.webContents.on('did-finish-load', () => {
    copilotWindow.webContents.send('copilot-data', data);
  });
});

ipcMain.on('move-copilot', (event, direction) => {
  if (!copilotWindow) return;
  var pos = copilotWindow.getPosition();
  var step = 50;
  if (direction === 'up') copilotWindow.setPosition(pos[0], pos[1] - step);
  if (direction === 'down') copilotWindow.setPosition(pos[0], pos[1] + step);
  if (direction === 'left') copilotWindow.setPosition(pos[0] - step, pos[1]);
  if (direction === 'right') copilotWindow.setPosition(pos[0] + step, pos[1]);
});

ipcMain.on('close-copilot', () => {
  if (global.activeAudioProcess) { try { global.activeAudioProcess.kill('SIGINT'); } catch(e) {} global.activeAudioProcess = null; }
  if (global.activeConnection) {
    try { if (global.activeConnection.socket) global.activeConnection.socket.close(); } catch(e) {}
    global.activeConnection = null;
  }
  if (copilotWindow) { copilotWindow.close(); copilotWindow = null; }
  if (setupWindow) setupWindow.show();
});

ipcMain.on('minimize-copilot', () => {
  if (!copilotWindow) return;
  var size = copilotWindow.getSize();
  copilotWindow.setSize(420, size[1] > 60 ? 45 : 500);
});

// Streaming API call to Claude
ipcMain.handle('api-call-stream', async (event, data) => {
  try {
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': data.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: data.prompt }]
      })
    });

    var reader = response.body.getReader();
    var decoder = new TextDecoder();

    while (true) {
      var result = await reader.read();
      if (result.done) break;

      var chunk = decoder.decode(result.value);
      var lines = chunk.split('\n');

      for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('data: ')) {
          var lineData = lines[i].slice(6);
          if (lineData === '[DONE]') continue;
          try {
            var parsed = JSON.parse(lineData);
            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
              if (copilotWindow && !copilotWindow.isDestroyed()) {
                copilotWindow.webContents.send('stream-chunk', parsed.delta.text);
              }
            }
          } catch(e) {}
        }
      }
    }

    if (copilotWindow && !copilotWindow.isDestroyed()) {
      copilotWindow.webContents.send('stream-done');
    }
    return { status: 'done' };
  } catch(err) {
    console.error('API error:', err.message);
    return { status: 'error', message: err.message };
  }
});

// Add this with your other ipcMain handlers

// Add these imports at the top if not already there
const { screen: electronScreen, desktopCapturer } = require('electron');

// Add these handlers with your other ipcMain handlers

// Capture screen
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });

    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail.toDataURL();
      console.log('Screenshot captured, size:', screenshot.length);
      return { status: 'success', image: screenshot };
    }
    
    return { status: 'error', message: 'No screen found' };
  } catch (err) {
    console.error('Capture error:', err);
    return { status: 'error', message: err.message };
  }
});

// Analyze screens with Claude Vision
ipcMain.handle('analyze-screens', async (event, data) => {
  try {
    console.log('=== ANALYZE SCREENS STARTED ===');
    console.log('Number of screenshots:', data.screenshots?.length);
    console.log('API Key present:', !!data.apiKey);
    console.log('Prompt:', data.prompt);
    
    // Prepare content array with images
    const content = [];
    
    // Add each screenshot
    data.screenshots.forEach((screenshot, index) => {
      const base64Data = screenshot.split(',')[1];
      console.log(`Screenshot ${index + 1} size:`, base64Data.length, 'bytes');
      
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: base64Data
        }
      });
    });
    
    // Add the prompt
    content.push({
      type: 'text',
      text: data.prompt || 'Analyze these screenshots and provide relevant answers or insights for an interview context.'
    });

    console.log('Making API call...');
    
    // Call Claude API with vision
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': data.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        stream: true,
        messages: [{
          role: 'user',
          content: content
        }]
      })
    });

    console.log('API Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', errorText);
      return { status: 'error', message: `API returned ${response.status}: ${errorText}` };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunkCount = 0;

    while (true) {
      const result = await reader.read();
      if (result.done) {
        console.log('Stream complete. Total chunks:', chunkCount);
        break;
      }

      const chunk = decoder.decode(result.value);
      const lines = chunk.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('data: ')) {
          const lineData = lines[i].slice(6);
          if (lineData === '[DONE]') continue;
          try {
            const parsed = JSON.parse(lineData);
            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
              chunkCount++;
              console.log('Sending chunk #', chunkCount);
              
              if (copilotWindow && !copilotWindow.isDestroyed()) {
                copilotWindow.webContents.send('stream-chunk', parsed.delta.text);
              }
            }
          } catch(e) {
            console.error('Parse error:', e);
          }
        }
      }
    }

    if (copilotWindow && !copilotWindow.isDestroyed()) {
      copilotWindow.webContents.send('stream-done');
      console.log('Stream done signal sent');
    }
    
    console.log('=== ANALYZE SCREENS COMPLETED ===');
    return { status: 'done' };
  } catch (err) {
    console.error('Analysis error:', err);
    return { status: 'error', message: err.message };
  }
});

// Start speech recognition with Deepgram
ipcMain.handle('start-speech', async (event, data) => {
  try {
    var { DeepgramClient } = require('@deepgram/sdk');
    var { spawn, spawnSync } = require('child_process');

    // Detect available audio devices (FFmpeg v8 format: "Device Name" (audio))
    var dshowResult = spawnSync('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { encoding: 'utf8' });
    var dshowOutput = (dshowResult.stderr || '') + (dshowResult.stdout || '');
    var audioDevices = [];
    for (var dline of dshowOutput.split('\n')) {
      var dm = dline.match(/"([^"]+)"\s*\(audio\)/);
      if (dm) audioDevices.push(dm[1]);
    }
    var systemDevice = audioDevices.find(d => /stereo mix|wave out|what u hear|voicemeeter|loopback/i.test(d)) || audioDevices[0] || 'Stereo Mix';
    var micDevice = audioDevices.find(d => /microphone|mic/i.test(d)) || audioDevices[1] || audioDevices[0] || 'Microphone';
    console.log('Audio devices found:', audioDevices);
    console.log('System:', systemDevice, '| Mic:', micDevice);

    var deepgram = new DeepgramClient({ apiKey: data.deepgramKey });
    var fullTranscript = '';
    var audioProcess = null;

    var connection = await deepgram.listen.v1.connect({
      model: 'nova-3',
      language: 'en',
      smart_format: true,
      interim_results: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    });

    connection.on('open', function() {
      console.log('Deepgram connected, mode:', data.mode);

      if (data.mode === 'system') {
        audioProcess = spawn('ffmpeg', [
          '-f', 'dshow',
          '-i', 'audio=' + systemDevice,
          '-ac', '1', '-ar', '16000',
          '-f', 's16le', '-acodec', 'pcm_s16le', '-'
        ]);
      } else if (data.mode === 'both') {
        audioProcess = spawn('ffmpeg', [
          '-f', 'dshow', '-i', 'audio=' + micDevice,
          '-f', 'dshow', '-i', 'audio=' + systemDevice,
          '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest',
          '-ac', '1', '-ar', '16000',
          '-f', 's16le', '-acodec', 'pcm_s16le', '-'
        ]);
      } else {
        audioProcess = spawn('ffmpeg', [
          '-f', 'dshow',
          '-i', 'audio=' + micDevice,
          '-ac', '1', '-ar', '16000',
          '-f', 's16le', '-acodec', 'pcm_s16le', '-'
        ]);
      }

      var ffmpegGotData = false;

      audioProcess.stdout.on('data', function(audioData) {
        ffmpegGotData = true;
        try { connection.socket.send(audioData); } catch(e) {}
      });

      var ffmpegStderr = '';
      audioProcess.stderr.on('data', function(d) { ffmpegStderr += d.toString(); });

      audioProcess.on('error', function(err) {
        console.error('Audio process error:', err.message);
        if (copilotWindow && !copilotWindow.isDestroyed()) {
          copilotWindow.webContents.send('audio-error', 'ffmpeg-missing');
        }
      });

      audioProcess.on('close', function(code) {
        if (!ffmpegGotData && code !== 0) {
          console.error('FFmpeg failed to capture audio:', ffmpegStderr.slice(-300));
          // Try auto-enable then retry
          enableStereoMix().then(function(enabled) {
            if (enabled) {
              console.log('✓ Stereo Mix enabled — please restart audio');
              if (copilotWindow && !copilotWindow.isDestroyed()) {
                copilotWindow.webContents.send('audio-error', 'stereo-mix-enabled-restart');
              }
            } else {
              // Admin rights needed — open Sound Settings for user
              dialog.showMessageBox(copilotWindow, {
                type: 'warning',
                title: 'Audio Setup Required',
                message: 'Stereo Mix needs to be enabled',
                detail: '1. In the window that opens, go to the Recording tab\n2. Right-click Stereo Mix → Enable\n3. Right-click Stereo Mix → Set as Default Device\n4. Click OK, then restart the copilot',
                buttons: ['Open Sound Settings', 'Cancel'],
              }).then(function(result) {
                if (result.response === 0) exec('mmsys.cpl ,1');
              });
              if (copilotWindow && !copilotWindow.isDestroyed()) {
                copilotWindow.webContents.send('audio-error', 'stereo-mix-disabled');
              }
            }
          });
        }
      });

      global.activeAudioProcess = audioProcess;
      console.log('Audio capture started');
    });

    connection.on('message', function(result) {
      if (result.type !== 'Results') return;
      var transcript = result.channel && result.channel.alternatives && result.channel.alternatives[0] && result.channel.alternatives[0].transcript;
      if (!transcript || !transcript.trim()) return;

      if (result.is_final) {
        fullTranscript += transcript + ' ';
      }

      if (copilotWindow && !copilotWindow.isDestroyed()) {
        copilotWindow.webContents.send('live-transcript', {
          text: fullTranscript + (result.is_final ? '' : transcript),
          isFinal: result.is_final
        });
      }
    });

    connection.on('error', function(err) {
      console.error('Deepgram error:', err);
    });

    connection.on('close', function() {
      console.log('Deepgram connection closed');
    });

    connection.connect();
    await connection.waitForOpen();

    global.activeConnection = connection;
    return { status: 'started' };
  } catch(err) {
    console.error('Speech error:', err.message);
    return { status: 'error', message: err.message };
  }
});

// Stop speech
ipcMain.handle('stop-speech', async () => {
  if (global.activeAudioProcess) {
    try { global.activeAudioProcess.kill('SIGINT'); } catch(e) {}
    global.activeAudioProcess = null;
  }
  if (global.activeConnection) {
    try {
      if (typeof global.activeConnection.finalize === 'function') {
        global.activeConnection.finalize();
      }
      setTimeout(function() {
        try {
          if (global.activeConnection && global.activeConnection.socket) {
            global.activeConnection.socket.close();
          }
        } catch(e) {}
        global.activeConnection = null;
      }, 500);
    } catch(e) {}
  }
  return { status: 'stopped' };
});

ipcMain.on('resize-copilot', (event, action) => {
  if (!copilotWindow || copilotWindow.isDestroyed()) return;

  const [width, height] = copilotWindow.getSize();
  const [x, y] = copilotWindow.getPosition();
  const step = 50;

  console.log('resize-copilot action =', action, 'current size =', width, height);

  let newWidth = width;
  let newHeight = height;

  if (action === 'bigger') {
    newWidth = width + step;
    newHeight = height + step;
  } else if (action === 'smaller') {
    newWidth = Math.max(300, width - step);
    newHeight = Math.max(200, height - step);
  } else if (action === 'reset') {
    newWidth = 420;
    newHeight = 500;
  } else {
    return;
  }

  copilotWindow.setResizable(true);
  copilotWindow.setBounds({
    x,
    y,
    width: newWidth,
    height: newHeight
  });

  console.log('new size =', copilotWindow.getSize());
});
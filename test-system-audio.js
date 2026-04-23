const { DeepgramClient } = require('@deepgram/sdk');
const { spawn } = require('child_process');

const API_KEY = 'e901763f41f51324ed813987d4537a42e70c1fb8';

async function test() {
  console.log('Starting system audio test...');
  console.log('Play something on your computer (YouTube, music, etc.)');
  console.log('Listening for 15 seconds...\n');

  var deepgram = new DeepgramClient({ apiKey: API_KEY });

  var connection = await deepgram.listen.v1.connect({
    model: 'nova-3',
    language: 'en',
    smart_format: 'true',
    interim_results: 'true',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1
  });

  var ffmpegProcess = null;

  connection.on('open', function() {
    console.log('Deepgram connected! Capturing system audio...\n');

    ffmpegProcess = spawn('ffmpeg', [
      '-f', 'dshow',
      '-i', 'audio=Stereo Mix (Realtek(R) Audio)',
      '-ac', '1',
      '-ar', '16000',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-'
    ]);

    ffmpegProcess.stdout.on('data', function(data) {
      try { connection.socket.send(data); } catch(e) {}
    });

    ffmpegProcess.stderr.on('data', function() {});

    ffmpegProcess.on('error', function(err) {
      console.error('FFmpeg error:', err.message);
    });

    console.log('System audio capture started!\n');

    setTimeout(function() {
      console.log('\nStopping...');
      if (ffmpegProcess) ffmpegProcess.kill('SIGINT');
      setTimeout(function() {
        connection.socket.close();
        process.exit(0);
      }, 1000);
    }, 15000);
  });

  connection.on('message', function(data) {
    if (data.type !== 'Results') return;
    var transcript = data.channel && data.channel.alternatives && data.channel.alternatives[0] && data.channel.alternatives[0].transcript;
    if (!transcript || !transcript.trim()) return;

    if (data.is_final) {
      console.log('\nFINAL:', transcript);
    } else {
      process.stdout.write('\rLIVE: ' + transcript + '                              ');
    }
  });

  connection.on('error', function(err) {
    console.error('Error:', err.message || err);
  });

  connection.on('close', function() {
    console.log('\nConnection closed');
  });

  connection.connect();
  await connection.waitForOpen();
}

test().catch(function(e) { console.error('Error:', e.message); });
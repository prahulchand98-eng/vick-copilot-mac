const { DeepgramClient } = require('@deepgram/sdk');
const { spawn } = require('child_process');

const API_KEY = 'e901763f41f51324ed813987d4537a42e70c1fb8';

async function test() {
  console.log('Starting voice test...');
  console.log('Speak into your microphone for 15 seconds...\n');

  const deepgram = new DeepgramClient({ apiKey: API_KEY });

  const connection = await deepgram.listen.v1.connect({
    model: 'nova-3',
    language: 'en',
    smart_format: 'true',
    interim_results: 'true',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1
  });

  let soxProcess = null;

  connection.on('open', () => {
    console.log('Deepgram connected! Starting microphone...\n');

    soxProcess = spawn('sox', [
      '-t', 'waveaudio', '-d',
      '-t', 'raw',
      '-r', '16000',
      '-c', '1',
      '-b', '16',
      '-e', 'signed-integer',
      '--endian', 'little',
      '-'
    ]);

    soxProcess.stdout.on('data', (data) => {
      try {
        connection.socket.send(data);
      } catch (e) {
        console.error('Send error:', e.message);
      }
    });

    soxProcess.stderr.on('data', () => {
      // ignore SoX meter/progress output
    });

    soxProcess.on('error', (err) => {
      console.error('SoX error:', err.message);
    });

    console.log('Microphone started! Speak now...\n');

    setTimeout(() => {
      console.log('\nStopping...');
      if (soxProcess) soxProcess.kill();

      // optional but useful for final results
      try {
        if (typeof connection.finalize === 'function') {
          connection.finalize();
        }
      } catch (e) {}

      setTimeout(() => {
        connection.socket.close();
        process.exit(0);
      }, 1000);
    }, 15000);
  });

  connection.on('message', (data) => {
    if (data.type !== 'Results') return;

    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript || !transcript.trim()) return;

    if (data.is_final) {
      console.log('\nFINAL:', transcript);
    } else {
      process.stdout.write('\rLIVE: ' + transcript + '                    ');
    }
  });

  connection.on('error', (err) => {
    console.error('Deepgram error:', err.message || err);
  });

  connection.on('close', () => {
    console.log('\nConnection closed');
  });

  connection.connect();
  await connection.waitForOpen();
}

test().catch((e) => {
  console.error('Error:', e.message || e);
});
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    const ratio = sampleRate / 24000;
    const output = new Int16Array(Math.max(1, Math.floor(input.length / ratio)));
    let squareSum = 0;
    for (let index = 0; index < input.length; index += 1) squareSum += input[index] ** 2;
    for (let index = 0; index < output.length; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.max(start + 1, Math.min(input.length, Math.floor((index + 1) * ratio)));
      let sum = 0;
      for (let source = start; source < end; source += 1) sum += input[source];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      output[index] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    this.port.postMessage(
      { pcm: output.buffer, rms: Math.sqrt(squareSum / input.length) },
      [output.buffer],
    );
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

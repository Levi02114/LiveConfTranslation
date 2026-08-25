/**
 * 마이크 PCM 캡처 워크렛.
 *
 * - 80Hz 하이패스: 에어컨·진동 저음 잡음을 제거한다(전사 모델 방해 요소).
 * - 창 sinc 리샘플링: 기존 박스카(구간 평균) 다운샘플은 고주파가 접혀
 *   자음이 뭉개졌다. 출력 나이퀴스트에서 자른 sinc 커널로 24kHz 로 내린다.
 * - RMS 는 100ms 슬라이딩 창으로 낸다 — 128샘플 블록 단위 RMS 는 치찰음에서
 *   튀고 모음에서 가라앉아 폴백 VAD(audio-turn-detector)의 오동작 원인이었다.
 * - peak 는 음량 미터의 클리핑 표시가 쓴다.
 */
const KERNEL = 8; // 각 출력 샘플 양옆으로 보는 입력 샘플 수
const HPF_CUTOFF_HZ = 80;
const RMS_WINDOW_MS = 100; // RMS 슬라이딩 창 길이(폴백 VAD·음량 미터용)
const BATCH_SAMPLES = 960; // 24kHz 40ms — 작은 WS 프레임 폭증을 막는다.

function sinc(x) {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000;
    this.tail = new Float32Array(KERNEL * 2);
    this.nextOut = KERNEL; // 확장 버퍼(꼬리+현재 블록) 기준 다음 출력 위치
    // 1차 하이패스 상태
    this.hpfR = Math.exp((-2 * Math.PI * HPF_CUTOFF_HZ) / sampleRate);
    this.hpfPrevX = 0;
    this.hpfPrevY = 0;
    // 100ms sliding-window RMS ring
    this.winLen = Math.max(1, Math.round((sampleRate * RMS_WINDOW_MS) / 1000));
    this.winSquares = new Float32Array(this.winLen);
    this.winPos = 0;
    this.winCount = 0;
    this.winSum = 0;
    this.pending = new Int16Array(BATCH_SAMPLES);
    this.pendingLength = 0;
    this.pendingPeak = 0;
    this.pendingRms = 0;
  }

  queue(pcm, rms, peak) {
    let offset = 0;
    this.pendingRms = rms;
    this.pendingPeak = Math.max(this.pendingPeak, peak);
    while (offset < pcm.length) {
      const count = Math.min(pcm.length - offset, BATCH_SAMPLES - this.pendingLength);
      this.pending.set(pcm.subarray(offset, offset + count), this.pendingLength);
      this.pendingLength += count;
      offset += count;
      if (this.pendingLength !== BATCH_SAMPLES) continue;

      const batch = this.pending;
      this.pending = new Int16Array(BATCH_SAMPLES);
      this.pendingLength = 0;
      this.port.postMessage(
        { pcm: batch.buffer, rms: this.pendingRms, peak: this.pendingPeak },
        [batch.buffer],
      );
      this.pendingPeak = 0;
    }
  }

  highpass(input) {
    const out = new Float32Array(input.length);
    let prevX = this.hpfPrevX;
    let prevY = this.hpfPrevY;
    for (let i = 0; i < input.length; i += 1) {
      const y = input[i] - prevX + this.hpfR * prevY;
      prevX = input[i];
      prevY = y;
      out[i] = y;
    }
    this.hpfPrevX = prevX;
    this.hpfPrevY = prevY;
    return out;
  }

  process(inputs) {
    const raw = inputs[0]?.[0];
    if (!raw?.length) return true;

    let peak = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const value = raw[i];
      const abs = value < 0 ? -value : value;
      if (abs > peak) peak = abs;
      const square = value * value;
      this.winSum += square - this.winSquares[this.winPos];
      this.winSquares[this.winPos] = square;
      this.winPos = (this.winPos + 1) % this.winLen;
      if (this.winCount < this.winLen) this.winCount += 1;
    }
    const rms = Math.sqrt(this.winSum / this.winCount);

    // AudioContext가 요청한 24kHz를 지원하면 브라우저의 네이티브 리샘플러가
    // 이미 처리했다. 이 경로에서 16탭 sinc를 다시 돌리는 것은 순수한 CPU 낭비다.
    if (this.ratio === 1) {
      const pcm = new Int16Array(raw.length);
      let prevX = this.hpfPrevX;
      let prevY = this.hpfPrevY;
      for (let i = 0; i < raw.length; i += 1) {
        const sample = raw[i] - prevX + this.hpfR * prevY;
        prevX = raw[i];
        prevY = sample;
        const clamped = Math.max(-1, Math.min(1, sample));
        pcm[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      }
      this.hpfPrevX = prevX;
      this.hpfPrevY = prevY;
      this.queue(pcm, rms, peak);
      return true;
    }

    const input = this.highpass(raw);
    const ext = new Float32Array(this.tail.length + input.length);
    ext.set(this.tail);
    ext.set(input, this.tail.length);

    const out = [];
    while (this.nextOut + KERNEL < ext.length) {
      const center = this.nextOut;
      const left = Math.floor(center);
      let sum = 0;
      let wsum = 0;
      for (let i = left - KERNEL + 1; i <= left + KERNEL; i += 1) {
        if (i < 0 || i >= ext.length) continue;
        const distance = i - center;
        // 출력 나이퀴스트에서 자른 sinc 에 Hann 창을 씌운다.
        const weight = sinc(distance / this.ratio) * (0.5 + 0.5 * Math.cos((Math.PI * distance) / KERNEL));
        sum += ext[i] * weight;
        wsum += weight;
      }
      const sample = wsum ? sum / wsum : 0;
      out.push(Math.max(-1, Math.min(1, sample)));
      this.nextOut += this.ratio;
    }

    // 다음 블록을 위해 입력 꼬리를 보존하고 위치 기준을 되돌린다.
    this.nextOut -= input.length;
    this.tail.set(ext.subarray(ext.length - this.tail.length));

    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i += 1) {
      pcm[i] = out[i] < 0 ? out[i] * 32768 : out[i] * 32767;
    }
    this.queue(pcm, rms, peak);
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

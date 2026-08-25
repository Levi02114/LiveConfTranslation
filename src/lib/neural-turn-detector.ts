/**
 * Silero 신경망 VAD 기반 발화 구간 감지기.
 *
 * 기존 `AudioTurnDetector`(RMS 전용)는 고정 임계값이라 조용한 화자를 자르고
 * 키보드·에어컨 소음을 발화로 오인한다. 이 감지기는 vad-web(Silero ONNX)의
 * 음성 확률로 턴 끝을 확정한다. 자산 로드에 실패하면 null 을 돌려주어
 * 호출부가 RMS 감지기로 내려가게 한다.
 *
 * 오디오 자체는 WebRTC/WS 로 OpenAI 에 이미 흘러가고 있으므로, 여기서는
 * **커밋 타이밍만** 결정한다.
 */

// ponytail: 현장 마이크 편차가 크므로 오탐이 보이면 이 값들만 조정한다.
export const MAX_TURN_MS = 15_000;
const REDEMPTION_MS = 1_100; // 무음이 이 길이를 넘으면 턴 종료
const REDEMPTION_DELIBERATE_MS = 1_700; // 천천히 말하는 언어의 턴 종료 무음
const MIN_SPEECH_MS = 200;

/**
 * 타이어·싱할라어 화자는 문장 안에서도 길게 쉬는 경우가 많아 짧은 redemption
 * 에서 발화가 중간에 잘린다(실측 평가에서 확인). 후보 언어 중 하나라도 해당하면
 * 긴 쪽을 쓴다 — 통합 입력처럼 언어가 섞이면 보수적으로 기다리는 편이 낫다.
 */
const DELIBERATE_LANGS = new Set(["th", "si"]);

export function redemptionMsFor(langs: readonly string[]): number {
  return langs.some((lang) => DELIBERATE_LANGS.has(lang.toLowerCase().split("-")[0]))
    ? REDEMPTION_DELIBERATE_MS
    : REDEMPTION_MS;
}

type VadInstance = {
  destroy: () => Promise<void>;
};

/** VAD 이벤트를 저장 가능한 발화 턴으로 묶는다. 오디오 모델과 무관해 단위 검사한다. */
export class SpeechTurnCommitter {
  private maxTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private speechActive = false;
  private speechSinceCommit = false;

  constructor(private readonly onCommit: () => void) {}

  handleSpeechStart(): void {
    this.speechActive = true;
    this.speechSinceCommit = true;
    this.scheduleMaxTurn();
  }

  handleSpeechFrame(probability: number): void {
    if (this.speechActive && probability >= 0.35) this.speechSinceCommit = true;
  }

  handleSpeechEnd(): void {
    if (this.maxTurnTimer) clearTimeout(this.maxTurnTimer);
    this.maxTurnTimer = null;
    this.speechActive = false;
    if (this.speechSinceCommit) this.onCommit();
    this.speechSinceCommit = false;
  }

  handleMisfire(): void {
    this.reset();
  }

  destroy(): void {
    this.reset();
  }

  private reset(): void {
    if (this.maxTurnTimer) clearTimeout(this.maxTurnTimer);
    this.maxTurnTimer = null;
    this.speechActive = false;
    this.speechSinceCommit = false;
  }

  private scheduleMaxTurn(): void {
    if (this.maxTurnTimer) clearTimeout(this.maxTurnTimer);
    this.maxTurnTimer = setTimeout(() => {
      this.maxTurnTimer = null;
      if (!this.speechActive) return;
      if (this.speechSinceCommit) {
        this.speechSinceCommit = false;
        this.onCommit();
      }
      // 발화가 계속되는 동안 15초마다 다시 자른다.
      this.scheduleMaxTurn();
    }, MAX_TURN_MS);
  }
}

export class NeuralTurnDetector {
  private vad: VadInstance | null = null;
  private readonly turns: SpeechTurnCommitter;

  private constructor(onCommit: () => void) {
    this.turns = new SpeechTurnCommitter(onCommit);
  }

  /**
   * 스트림에 VAD 를 단다. 실패하면 null.
   * `stream` 은 호출부가 소유한다 — 여기서는 트랙을 멈추지 않는다.
   */
  static async create(
    stream: MediaStream,
    onCommit: () => void,
    options: { redemptionMs?: number; audioContext?: AudioContext } = {},
  ): Promise<NeuralTurnDetector | null> {
    const detector = new NeuralTurnDetector(onCommit);
    try {
      const { MicVAD } = await import("@ricky0123/vad-web");
      detector.vad = await MicVAD.new({
        model: "v5",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        // 스트림 소유권은 호출부에 둔다 — VAD 는 읽기만 한다.
        getStream: async () => stream,
        pauseStream: async () => {},
        resumeStream: async () => stream,
        startOnLoad: true,
        audioContext: options.audioContext,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        redemptionMs: options.redemptionMs ?? REDEMPTION_MS,
        minSpeechMs: MIN_SPEECH_MS,
        preSpeechPadMs: 100,
        submitUserSpeechOnPause: false,
        ortConfig: (ort) => {
          // 기본 wasm 한 벌만 배포한다(scripts/prepare-vad.mjs).
          ort.env.wasm.wasmPaths = "/vad/";
          ort.env.wasm.numThreads = 1;
        },
        onSpeechStart: () => detector.turns.handleSpeechStart(),
        onSpeechEnd: () => detector.turns.handleSpeechEnd(),
        onFrameProcessed: (probabilities) => detector.turns.handleSpeechFrame(probabilities.isSpeech),
        onVADMisfire: () => detector.turns.handleMisfire(),
      });
      return detector;
    } catch (error) {
      console.warn("[vad] 신경망 VAD 로드 실패 — RMS 감지기로 돌아갑니다", error);
      return null;
    }
  }

  async destroy(): Promise<void> {
    this.turns.destroy();
    const vad = this.vad;
    this.vad = null;
    await vad?.destroy();
  }
}

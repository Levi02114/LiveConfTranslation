/*
 * 코드에 박혀 있는 UI 문구.
 *
 * **이 파일은 DB 를 건드리지 않는다 — 클라이언트 번들에 들어가도 안전하다.**
 * 클라이언트 컴포넌트도 이 타입을 가져가므로 그 경계를 지켜야 한다.
 * DB 오버레이를 얹는 해석기는 `lib/i18n.ts` 에 있다.
 */
import type { LanguageCode } from "@/lib/languages";

/**
 * 입력·출력 페이지의 UI 문구.
 *
 * 참석자는 자기 언어 페이지만 본다. 거기에 한국어 "연결됨"이 떠 있으면 안 되므로
 * 화면에 나오는 모든 글자를 페이지 언어로 낸다.
 *
 * 관리자 화면도 테마·연결 상태처럼 공유하는 문구는 여기를 쓴다.
 *
 * ⚠️ 한국어 외 문구는 기계적으로 옮긴 초안이다. 실제 행사 전에 각 언어 사용자에게
 *    한 번 검수받는 것을 전제로 한다.
 */
export type UiStrings = {
  connection: { connected: string; reconnecting: string; disconnected: string };
  role: { input: string; output: string; combined: string; capture: string };
  input: {
    placeholder: string;
    send: string;
    sending: string;
    hint: string;
  };
  capture: {
    toggle: string;
    keyRequired: string;
    microphone: string;
    start: string;
    starting: string;
    stop: string;
    standby: string;
    listening: string;
    partial: string;
    insecure: string;
    busy: string;
    permission: string;
    lost: string;
    startFailed: string;
  };
  status: {
    waiting: string;
    noContent: string;
    lastInput: string;
    lastOutput: string;
    failed: string;
    newMessages: string;
  };
  meeting: { closed: string };
  appearance: {
    language: string;
    theme: string;
    light: string;
    dark: string;
    textSize: string;
    decrease: string;
    increase: string;
  };
  peers: { online: string; typing: string; you: string };
  error: { sendFailed: string; loadFailed: string; notFound: string };
};

const ko: UiStrings = {
  connection: { connected: "연결됨", reconnecting: "다시 연결 중", disconnected: "연결 끊김" },
  role: { input: "입력", output: "출력", combined: "통합 조회", capture: "음성 수집" },
  input: {
    placeholder: "세션 내용을 입력하세요",
    send: "보내기",
    sending: "보내는 중",
    hint: "Enter 로 전송 · Shift+Enter 로 줄바꿈",
  },
  capture: {
    toggle: "음성 입력 사용",
    keyRequired: "OpenAI API 키가 등록되지 않았습니다",
    microphone: "마이크",
    start: "전사 시작",
    starting: "시작하는 중",
    stop: "전사 중지",
    standby: "수집 대기 중",
    listening: "음성을 듣는 중",
    partial: "인식 중",
    insecure: "마이크는 HTTPS 주소에서만 사용할 수 있습니다",
    busy: "다른 기기에서 음성을 수집하고 있습니다",
    permission: "마이크를 사용할 수 없습니다",
    lost: "음성 수집 연결이 끊겼습니다",
    startFailed: "전사를 시작하지 못했습니다",
  },
  status: {
    waiting: "번역을 기다리는 중",
    noContent: "아직 내용이 없습니다",
    lastInput: "마지막 입력",
    lastOutput: "마지막 번역",
    failed: "번역 실패",
    newMessages: "새 문장",
  },
  meeting: { closed: "종료된 세션입니다" },
  appearance: {
    language: "화면 언어",
    theme: "테마",
    light: "밝게",
    dark: "어둡게",
    textSize: "글자 크기",
    decrease: "작게",
    increase: "크게",
  },
  peers: { online: "{count}명 접속 중", typing: "{count}명 입력 중", you: "나" },
  error: {
    sendFailed: "전송하지 못했습니다",
    loadFailed: "불러오지 못했습니다",
    notFound: "페이지를 찾을 수 없습니다",
  },
};

const vi: UiStrings = {
  connection: {
    connected: "Đã kết nối",
    reconnecting: "Đang kết nối lại",
    disconnected: "Mất kết nối",
  },
  role: { input: "Nhập liệu", output: "Bản dịch", combined: "Xem tổng hợp", capture: "Thu âm" },
  input: {
    placeholder: "Nhập nội dung phiên",
    send: "Gửi",
    sending: "Đang gửi",
    hint: "Enter để gửi · Shift+Enter để xuống dòng",
  },
  capture: {
    toggle: "Sử dụng nhập liệu bằng giọng nói",
    keyRequired: "Chưa đăng ký khóa API OpenAI",
    microphone: "Micrô",
    start: "Bắt đầu phiên âm",
    starting: "Đang bắt đầu",
    stop: "Dừng phiên âm",
    standby: "Đang chờ thu âm",
    listening: "Đang nghe",
    partial: "Đang nhận dạng",
    insecure: "Micrô chỉ dùng được qua địa chỉ HTTPS",
    busy: "Một thiết bị khác đang thu âm",
    permission: "Không thể sử dụng micrô",
    lost: "Kết nối thu âm đã bị ngắt",
    startFailed: "Không thể bắt đầu phiên âm",
  },
  status: {
    waiting: "Đang chờ bản dịch",
    noContent: "Chưa có nội dung",
    lastInput: "Lần nhập cuối",
    lastOutput: "Bản dịch cuối",
    failed: "Dịch thất bại",
    newMessages: "Câu mới",
  },
  meeting: { closed: "Phiên đã kết thúc" },
  appearance: {
    language: "Ngôn ngữ hiển thị",
    theme: "Giao diện",
    light: "Sáng",
    dark: "Tối",
    textSize: "Cỡ chữ",
    decrease: "Nhỏ hơn",
    increase: "Lớn hơn",
  },
  peers: {
    online: "{count} người đang kết nối",
    typing: "{count} người đang nhập",
    you: "Bạn",
  },
  error: {
    sendFailed: "Không gửi được",
    loadFailed: "Không tải được",
    notFound: "Không tìm thấy trang",
  },
};

const th: UiStrings = {
  connection: {
    connected: "เชื่อมต่อแล้ว",
    reconnecting: "กำลังเชื่อมต่อใหม่",
    disconnected: "การเชื่อมต่อขาด",
  },
  role: { input: "ป้อนข้อมูล", output: "คำแปล", combined: "มุมมองรวม", capture: "รับเสียง" },
  input: {
    placeholder: "พิมพ์เนื้อหาเซสชัน",
    send: "ส่ง",
    sending: "กำลังส่ง",
    hint: "กด Enter เพื่อส่ง · Shift+Enter เพื่อขึ้นบรรทัดใหม่",
  },
  capture: {
    toggle: "ใช้การป้อนข้อมูลด้วยเสียง",
    keyRequired: "ยังไม่ได้ลงทะเบียนคีย์ OpenAI API",
    microphone: "ไมโครโฟน",
    start: "เริ่มถอดเสียง",
    starting: "กำลังเริ่ม",
    stop: "หยุดถอดเสียง",
    standby: "รอรับเสียง",
    listening: "กำลังฟัง",
    partial: "กำลังรู้จำ",
    insecure: "ใช้ไมโครโฟนได้ผ่านที่อยู่ HTTPS เท่านั้น",
    busy: "อุปกรณ์อื่นกำลังรับเสียงอยู่",
    permission: "ไม่สามารถใช้ไมโครโฟนได้",
    lost: "การเชื่อมต่อรับเสียงถูกตัด",
    startFailed: "ไม่สามารถเริ่มการถอดเสียงได้",
  },
  status: {
    waiting: "กำลังรอคำแปล",
    noContent: "ยังไม่มีเนื้อหา",
    lastInput: "ป้อนข้อมูลล่าสุด",
    lastOutput: "คำแปลล่าสุด",
    failed: "แปลไม่สำเร็จ",
    newMessages: "ข้อความใหม่",
  },
  meeting: { closed: "เซสชันสิ้นสุดแล้ว" },
  appearance: {
    language: "ภาษาที่แสดง",
    theme: "ธีม",
    light: "สว่าง",
    dark: "มืด",
    textSize: "ขนาดตัวอักษร",
    decrease: "เล็กลง",
    increase: "ใหญ่ขึ้น",
  },
  peers: { online: "เชื่อมต่ออยู่ {count} คน", typing: "กำลังพิมพ์ {count} คน", you: "คุณ" },
  error: {
    sendFailed: "ส่งไม่สำเร็จ",
    loadFailed: "โหลดไม่สำเร็จ",
    notFound: "ไม่พบหน้านี้",
  },
};

const si: UiStrings = {
  connection: {
    connected: "සම්බන්ධයි",
    reconnecting: "නැවත සම්බන්ධ වෙමින්",
    disconnected: "සම්බන්ධතාව බිඳී ඇත",
  },
  role: { input: "ඇතුළත් කිරීම", output: "පරිවර්තනය", combined: "ඒකාබද්ධ දසුන", capture: "හඬ ග්‍රහණය" },
  input: {
    placeholder: "සැසි අන්තර්ගතය ටයිප් කරන්න",
    send: "යවන්න",
    sending: "යවමින්",
    hint: "යැවීමට Enter · නව පේළියකට Shift+Enter",
  },
  capture: {
    toggle: "හඬ ආදානය භාවිත කරන්න",
    keyRequired: "OpenAI API යතුර ලියාපදිංචි කර නැත",
    microphone: "මයික්‍රෆෝනය",
    start: "පිටපත් කිරීම අරඹන්න",
    starting: "අරඹමින්",
    stop: "පිටපත් කිරීම නවතන්න",
    standby: "හඬ සඳහා රැඳී සිටී",
    listening: "සවන් දෙමින්",
    partial: "හඳුනා ගනිමින්",
    insecure: "මයික්‍රෆෝනය HTTPS ලිපිනයකින් පමණක් භාවිත කළ හැක",
    busy: "වෙනත් උපාංගයක් හඬ ග්‍රහණය කරයි",
    permission: "මයික්‍රෆෝනය භාවිත කළ නොහැක",
    lost: "හඬ ග්‍රහණ සම්බන්ධතාව බිඳී ඇත",
    startFailed: "පිටපත් කිරීම ආරම්භ කළ නොහැකි විය",
  },
  status: {
    waiting: "පරිවර්තනය එනතුරු",
    noContent: "තවම අන්තර්ගතයක් නැත",
    lastInput: "අවසන් ඇතුළත් කිරීම",
    lastOutput: "අවසන් පරිවර්තනය",
    failed: "පරිවර්තනය අසාර්ථකයි",
    newMessages: "නව වාක්‍ය",
  },
  meeting: { closed: "සැසිය අවසන් වී ඇත" },
  appearance: {
    language: "සංදර්ශන භාෂාව",
    theme: "තේමාව",
    light: "ආලෝකමත්",
    dark: "අඳුරු",
    textSize: "අකුරු ප්‍රමාණය",
    decrease: "කුඩා",
    increase: "විශාල",
  },
  peers: {
    online: "{count} දෙනෙකු සම්බන්ධව සිටී",
    typing: "{count} දෙනෙකු ටයිප් කරමින්",
    you: "ඔබ",
  },
  error: {
    sendFailed: "යැවීමට නොහැකි විය",
    loadFailed: "පූරණය කිරීමට නොහැකි විය",
    notFound: "පිටුව හමු නොවීය",
  },
};

/** 코드에 박혀 있는 참석자 페이지 문구. 언어별 오버레이의 바탕이 된다. */
export const BUILTIN_UI: Record<LanguageCode, UiStrings> = { ko, vi, th, si };

/** 기계 번역이 실패하거나 빈 자리를 메울 때 쓰는 최종 폴백 */
export const FALLBACK_UI: UiStrings = ko;



/**
 * 관리자 화면(로그인·회의 목록) 문구.
 *
 * 참석자 페이지의 `UiStrings` 와 분리해 둔다. 그쪽은 페이지 부트스트랩 응답에
 * 그대로 실려 나가므로, 참석자가 볼 일 없는 관리자 어휘까지 함께 보낼 이유가 없다.
 *
 * ⚠️ 한국어 외 문구는 기계적으로 옮긴 초안이다. `UiStrings` 와 같은 전제로,
 *    실제 운영 전에 각 언어 사용자에게 검수받아야 한다.
 */
export type AdminStrings = {
  language: { label: string };
  home: { title: string; description: string; login: string; direct: string };
  login: {
    title: string;
    password: string;
    submit: string;
    pending: string;
    wrongPassword: string;
    failed: string;
  };
  list: {
    heading: string;
    logout: string;
    titlePlaceholder: string;
    languages: string;
    engine: string;
    fallbackEngine: string;
    noFallback: string;
    engineNoKey: string;
    /** OpenAI 를 골랐을 때만 나오는 언어모델 선택 라벨 */
    model: string;
    create: string;
    creating: string;
    loading: string;
    active: string;
    closed: string;
    noActive: string;
    noClosed: string;
    needTitle: string;
    needLanguages: string;
    createFailed: string;
    settingFailed: string;
    closeSession: string;
    closingSession: string;
    closeConfirm: string;
    closeFailed: string;
    deleteSession: string;
    deletingSession: string;
    deleteConfirm: string;
    deleteFailed: string;
  };
  dashboard: {
    close: string;
    closedNotice: string;
    unsupportedEngine: string;
    pages: string;
    participantGuide: string;
    input: string;
    output: string;
    capture: string;
    live: string;
    source: string;
    done: string;
    failed: string;
    copy: string;
    copied: string;
    copyFailed: string;
    openNew: string;
    showQr: string;
    downloadQr: string;
    closeQr: string;
    qrFailed: string;
    log: string;
    popup: string;
  };
  log: { notice: string; title: string; download: string; empty: string };
  keys: {
    button: string;
    title: string;
    close: string;
    note: string;
    none: string;
    registered: string;
    placeholder: string;
    replacePlaceholder: string;
    save: string;
    saving: string;
    remove: string;
    saveFailed: string;
    removeFailed: string;
  };
  languages: {
    add: string;
    search: string;
    noResults: string;
    translateWith: string;
    confirm: string;
    adding: string;
    addFailed: string;
    remove: string;
    removeFailed: string;
    inUse: string;
    builtin: string;
    unsupported: string;
    partial: string;
    close: string;
  };
  strings: {
    button: string;
    title: string;
    search: string;
    source: string;
    save: string;
    saving: string;
    revert: string;
    retranslate: string;
    retranslating: string;
    saveFailed: string;
    noChanges: string;
    manual: string;
    close: string;
    empty: string;
  };
};

const adminKo: AdminStrings = {
  language: { label: "화면 언어" },
  home: {
    title: "실시간 세션 번역",
    description: "세션을 열고 참석자에게 나눠 줄 주소를 받으려면 관리자로 로그인하세요.",
    login: "관리자 로그인",
    direct: "입력·참석 페이지는 관리자가 나눠 준 주소로 바로 들어가면 됩니다.",
  },
  login: {
    title: "관리자 로그인",
    password: "비밀번호",
    submit: "로그인",
    pending: "확인 중",
    wrongPassword: "비밀번호가 올바르지 않습니다",
    failed: "로그인에 실패했습니다",
  },
  list: {
    heading: "세션",
    logout: "로그아웃",
    titlePlaceholder: "세션 제목",
    languages: "언어",
    engine: "번역 엔진",
    fallbackEngine: "폴백 엔진",
    noFallback: "사용 안 함",
    engineNoKey: "키 없음",
    model: "언어모델",
    create: "세션 만들기",
    creating: "만드는 중",
    loading: "처리 중",
    active: "진행 중",
    closed: "종료됨",
    noActive: "진행 중인 세션이 없습니다",
    noClosed: "종료된 세션이 없습니다",
    needTitle: "세션 제목을 입력해 주세요",
    needLanguages: "서로 다른 언어를 두 개 이상 골라 주세요",
    createFailed: "세션을 만들지 못했습니다",
    settingFailed: "번역 엔진 설정을 저장하지 못했습니다",
    closeSession: "종료",
    closingSession: "종료 중",
    closeConfirm: "「{title}」 세션을 종료할까요? 종료 후에는 더 이상 입력할 수 없습니다.",
    closeFailed: "세션을 종료하지 못했습니다",
    deleteSession: "삭제",
    deletingSession: "삭제 중",
    deleteConfirm: "「{title}」 세션과 모든 기록을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    deleteFailed: "세션을 삭제하지 못했습니다",
  },
  dashboard: {
    close: "세션 종료",
    closedNotice: "세션이 종료되었습니다",
    unsupportedEngine:
      "{engine}은(는) {languages}을(를) 지원하지 않습니다 · 폴백 엔진: {fallback}",
    pages: "페이지 URL — 참석자에게 배포",
    participantGuide: "참가자 안내",
    input: "입력 (속기사)",
    output: "출력 (참석자)",
    capture: "음성 수집",
    live: "실시간 번역",
    source: "원문",
    done: "완료",
    failed: "실패",
    copy: "복사",
    copied: "복사됨",
    copyFailed: "복사 실패",
    openNew: "새 창 열기",
    showQr: "QR 표시",
    downloadQr: "이미지 다운로드",
    closeQr: "닫기",
    qrFailed: "QR을 만들지 못했습니다",
    log: "로그 보기 →",
    popup: "새 팝업 창",
  },
  log: {
    notice: "이 창은 로그 전용입니다 · 네비게이션 없음",
    title: "로그",
    download: ".txt 다운로드",
    empty: "표시할 로그가 없습니다",
  },
  keys: {
    button: "API 키 등록",
    title: "번역 엔진 API 키",
    close: "닫기",
    note: "키는 암호화되어 관리자 데이터베이스에 저장되며 화면으로 다시 꺼내 볼 수 없습니다.",
    none: "없음",
    registered: "등록됨",
    placeholder: "API 키",
    replacePlaceholder: "새 키로 덮어쓰기",
    save: "저장",
    saving: "저장 중",
    remove: "삭제",
    saveFailed: "키를 저장하지 못했습니다",
    removeFailed: "키를 지우지 못했습니다",
  },
  languages: {
    add: "언어 추가",
    search: "언어 검색",
    noResults: "결과가 없습니다",
    translateWith: "UI 문구 번역 엔진",
    confirm: "추가",
    adding: "추가하는 중",
    addFailed: "언어를 추가하지 못했습니다",
    remove: "제거",
    removeFailed: "언어를 제거하지 못했습니다",
    inUse: "세션에서 쓰인 언어는 제거할 수 없습니다",
    builtin: "기본 언어",
    unsupported: "미지원",
    partial: "번역하지 못한 문구",
    close: "닫기",
  },
  strings: {
    button: "문구 수정",
    title: "UI 문구",
    search: "문구 검색",
    source: "한국어 원문",
    save: "저장",
    saving: "저장 중",
    revert: "되돌리기",
    retranslate: "다시 번역",
    retranslating: "번역 중",
    saveFailed: "문구를 저장하지 못했습니다",
    noChanges: "바뀐 내용이 없습니다",
    manual: "수정됨",
    close: "닫기",
    empty: "문구가 없습니다",
  },
};

const adminVi: AdminStrings = {
  language: { label: "Ngôn ngữ hiển thị" },
  home: {
    title: "Dịch phiên theo thời gian thực",
    description: "Đăng nhập quản trị để mở phiên và nhận địa chỉ gửi cho người tham dự.",
    login: "Đăng nhập quản trị",
    direct: "Mở trang nhập liệu và trang người tham dự bằng địa chỉ do quản trị viên cung cấp.",
  },
  login: {
    title: "Đăng nhập quản trị",
    password: "Mật khẩu",
    submit: "Đăng nhập",
    pending: "Đang kiểm tra",
    wrongPassword: "Mật khẩu không đúng",
    failed: "Đăng nhập thất bại",
  },
  list: {
    heading: "Phiên",
    logout: "Đăng xuất",
    titlePlaceholder: "Tên phiên",
    languages: "Ngôn ngữ",
    engine: "Công cụ dịch",
    fallbackEngine: "Công cụ dự phòng",
    noFallback: "Không dùng",
    engineNoKey: "chưa có khóa",
    model: "Mô hình ngôn ngữ",
    create: "Tạo phiên",
    creating: "Đang tạo",
    loading: "Đang xử lý",
    active: "Đang diễn ra",
    closed: "Đã kết thúc",
    noActive: "Không có phiên nào đang diễn ra",
    noClosed: "Không có phiên nào đã kết thúc",
    needTitle: "Vui lòng nhập tên phiên",
    needLanguages: "Hãy chọn ít nhất hai ngôn ngữ khác nhau",
    createFailed: "Không tạo được phiên",
    settingFailed: "Không lưu được cài đặt công cụ dịch",
    closeSession: "Kết thúc",
    closingSession: "Đang kết thúc",
    closeConfirm: "Kết thúc phiên “{title}”? Sau đó sẽ không thể nhập thêm nội dung.",
    closeFailed: "Không kết thúc được phiên",
    deleteSession: "Xóa",
    deletingSession: "Đang xóa",
    deleteConfirm: "Xóa vĩnh viễn phiên “{title}” và toàn bộ dữ liệu? Không thể hoàn tác.",
    deleteFailed: "Không xóa được phiên",
  },
  dashboard: {
    close: "Kết thúc phiên",
    closedNotice: "Phiên đã kết thúc",
    unsupportedEngine:
      "{engine} không hỗ trợ {languages} · Công cụ dự phòng: {fallback}",
    pages: "URL trang — gửi cho người tham dự",
    participantGuide: "Hướng dẫn người tham dự",
    input: "Nhập liệu (người ghi tốc ký)",
    output: "Bản dịch (người tham dự)",
    capture: "Thu âm",
    live: "Dịch trực tiếp",
    source: "Nguồn",
    done: "Hoàn tất",
    failed: "Thất bại",
    copy: "Sao chép",
    copied: "Đã sao chép",
    copyFailed: "Sao chép thất bại",
    openNew: "Mở cửa sổ mới",
    showQr: "Hiện QR",
    downloadQr: "Tải ảnh xuống",
    closeQr: "Đóng",
    qrFailed: "Không tạo được mã QR",
    log: "Xem nhật ký →",
    popup: "Cửa sổ bật lên mới",
  },
  log: {
    notice: "Cửa sổ chỉ dành cho nhật ký · Không có điều hướng",
    title: "Nhật ký",
    download: "Tải .txt",
    empty: "Không có nhật ký để hiển thị",
  },
  keys: {
    button: "Đăng ký khóa API",
    title: "Khóa API của công cụ dịch",
    close: "Đóng",
    note: "Khóa được mã hóa, lưu trong cơ sở dữ liệu quản trị và không thể xem lại trên màn hình.",
    none: "Chưa có",
    registered: "Đã đăng ký",
    placeholder: "Khóa API",
    replacePlaceholder: "Ghi đè bằng khóa mới",
    save: "Lưu",
    saving: "Đang lưu",
    remove: "Xóa",
    saveFailed: "Không lưu được khóa",
    removeFailed: "Không xóa được khóa",
  },
  languages: {
    add: "Thêm ngôn ngữ",
    search: "Tìm ngôn ngữ",
    noResults: "Không có kết quả",
    translateWith: "Công cụ dịch giao diện",
    confirm: "Thêm",
    adding: "Đang thêm",
    addFailed: "Không thêm được ngôn ngữ",
    remove: "Xóa",
    removeFailed: "Không xóa được ngôn ngữ",
    inUse: "Không thể xóa ngôn ngữ đã dùng trong phiên",
    builtin: "Ngôn ngữ mặc định",
    unsupported: "Không hỗ trợ",
    partial: "Số câu chưa dịch được",
    close: "Đóng",
  },
  strings: {
    button: "Sửa văn bản",
    title: "Văn bản giao diện",
    search: "Tìm văn bản",
    source: "Bản gốc tiếng Hàn",
    save: "Lưu",
    saving: "Đang lưu",
    revert: "Khôi phục",
    retranslate: "Dịch lại",
    retranslating: "Đang dịch",
    saveFailed: "Không lưu được văn bản",
    noChanges: "Không có thay đổi",
    manual: "Đã sửa",
    close: "Đóng",
    empty: "Không có văn bản",
  },
};

const adminTh: AdminStrings = {
  language: { label: "ภาษาที่แสดง" },
  home: {
    title: "แปลเซสชันแบบเรียลไทม์",
    description: "เข้าสู่ระบบผู้ดูแลเพื่อเปิดเซสชันและรับที่อยู่สำหรับแจกจ่ายให้ผู้เข้าร่วม",
    login: "เข้าสู่ระบบผู้ดูแล",
    direct: "เปิดหน้าป้อนข้อมูลและหน้าผู้เข้าร่วมจากที่อยู่ที่ผู้ดูแลแจกจ่าย",
  },
  login: {
    title: "เข้าสู่ระบบผู้ดูแล",
    password: "รหัสผ่าน",
    submit: "เข้าสู่ระบบ",
    pending: "กำลังตรวจสอบ",
    wrongPassword: "รหัสผ่านไม่ถูกต้อง",
    failed: "เข้าสู่ระบบไม่สำเร็จ",
  },
  list: {
    heading: "เซสชัน",
    logout: "ออกจากระบบ",
    titlePlaceholder: "ชื่อเซสชัน",
    languages: "ภาษา",
    engine: "เครื่องมือแปล",
    fallbackEngine: "เครื่องมือสำรอง",
    noFallback: "ไม่ใช้",
    engineNoKey: "ไม่มีคีย์",
    model: "โมเดลภาษา",
    create: "สร้างเซสชัน",
    creating: "กำลังสร้าง",
    loading: "กำลังดำเนินการ",
    active: "กำลังดำเนินการ",
    closed: "สิ้นสุดแล้ว",
    noActive: "ไม่มีเซสชันที่กำลังดำเนินการ",
    noClosed: "ไม่มีเซสชันที่สิ้นสุดแล้ว",
    needTitle: "กรุณากรอกชื่อเซสชัน",
    needLanguages: "กรุณาเลือกภาษาที่ต่างกันอย่างน้อยสองภาษา",
    createFailed: "สร้างเซสชันไม่สำเร็จ",
    settingFailed: "บันทึกการตั้งค่าเครื่องมือแปลไม่สำเร็จ",
    closeSession: "สิ้นสุด",
    closingSession: "กำลังสิ้นสุด",
    closeConfirm: "สิ้นสุดเซสชัน “{title}” หรือไม่? หลังจากนั้นจะไม่สามารถป้อนข้อมูลเพิ่มได้",
    closeFailed: "สิ้นสุดเซสชันไม่สำเร็จ",
    deleteSession: "ลบ",
    deletingSession: "กำลังลบ",
    deleteConfirm: "ลบเซสชัน “{title}” และข้อมูลทั้งหมดอย่างถาวรหรือไม่? ไม่สามารถย้อนกลับได้",
    deleteFailed: "ลบเซสชันไม่สำเร็จ",
  },
  dashboard: {
    close: "สิ้นสุดเซสชัน",
    closedNotice: "เซสชันสิ้นสุดแล้ว",
    unsupportedEngine:
      "{engine} ไม่รองรับ {languages} · เครื่องมือสำรอง: {fallback}",
    pages: "URL หน้า — แจกจ่ายให้ผู้เข้าร่วม",
    participantGuide: "คู่มือผู้เข้าร่วม",
    input: "ป้อนข้อมูล (นักชวเลข)",
    output: "คำแปล (ผู้เข้าร่วม)",
    capture: "รับเสียง",
    live: "การแปลแบบเรียลไทม์",
    source: "ต้นฉบับ",
    done: "เสร็จ",
    failed: "ล้มเหลว",
    copy: "คัดลอก",
    copied: "คัดลอกแล้ว",
    copyFailed: "คัดลอกไม่สำเร็จ",
    openNew: "เปิดหน้าต่างใหม่",
    showQr: "แสดง QR",
    downloadQr: "ดาวน์โหลดรูปภาพ",
    closeQr: "ปิด",
    qrFailed: "สร้าง QR ไม่สำเร็จ",
    log: "ดูบันทึก →",
    popup: "หน้าต่างป๊อปอัปใหม่",
  },
  log: {
    notice: "หน้าต่างนี้ใช้สำหรับบันทึกเท่านั้น · ไม่มีเมนูนำทาง",
    title: "บันทึก",
    download: "ดาวน์โหลด .txt",
    empty: "ไม่มีบันทึกที่จะแสดง",
  },
  keys: {
    button: "ลงทะเบียนคีย์ API",
    title: "คีย์ API ของเครื่องมือแปล",
    close: "ปิด",
    note: "คีย์จะถูกเข้ารหัสและจัดเก็บในฐานข้อมูลผู้ดูแลระบบ โดยไม่สามารถเรียกดูบนหน้าจอได้อีก",
    none: "ไม่มี",
    registered: "ลงทะเบียนแล้ว",
    placeholder: "คีย์ API",
    replacePlaceholder: "เขียนทับด้วยคีย์ใหม่",
    save: "บันทึก",
    saving: "กำลังบันทึก",
    remove: "ลบ",
    saveFailed: "บันทึกคีย์ไม่สำเร็จ",
    removeFailed: "ลบคีย์ไม่สำเร็จ",
  },
  languages: {
    add: "เพิ่มภาษา",
    search: "ค้นหาภาษา",
    noResults: "ไม่พบผลลัพธ์",
    translateWith: "เครื่องมือแปลข้อความหน้าจอ",
    confirm: "เพิ่ม",
    adding: "กำลังเพิ่ม",
    addFailed: "เพิ่มภาษาไม่สำเร็จ",
    remove: "ลบ",
    removeFailed: "ลบภาษาไม่สำเร็จ",
    inUse: "ไม่สามารถลบภาษาที่ใช้ในเซสชันแล้ว",
    builtin: "ภาษาพื้นฐาน",
    unsupported: "ไม่รองรับ",
    partial: "ข้อความที่แปลไม่สำเร็จ",
    close: "ปิด",
  },
  strings: {
    button: "แก้ไขข้อความ",
    title: "ข้อความหน้าจอ",
    search: "ค้นหาข้อความ",
    source: "ต้นฉบับภาษาเกาหลี",
    save: "บันทึก",
    saving: "กำลังบันทึก",
    revert: "คืนค่า",
    retranslate: "แปลใหม่",
    retranslating: "กำลังแปล",
    saveFailed: "บันทึกข้อความไม่สำเร็จ",
    noChanges: "ไม่มีการเปลี่ยนแปลง",
    manual: "แก้ไขแล้ว",
    close: "ปิด",
    empty: "ไม่มีข้อความ",
  },
};

const adminSi: AdminStrings = {
  language: { label: "සංදර්ශන භාෂාව" },
  home: {
    title: "තත්‍ය කාලීන සැසි පරිවර්තනය",
    description: "සැසියක් විවෘත කර සහභාගිවන්නන්ට බෙදා දිය යුතු ලිපින ලබා ගැනීමට පරිපාලක ලෙස පිවිසෙන්න.",
    login: "පරිපාලක පිවිසුම",
    direct: "පරිපාලකයා ලබා දුන් ලිපිනයෙන් ඇතුළත් කිරීමේ සහ සහභාගිවන්නන්ගේ පිටු විවෘත කරන්න.",
  },
  login: {
    title: "පරිපාලක පිවිසුම",
    password: "මුරපදය",
    submit: "පිවිසෙන්න",
    pending: "පරීක්ෂා කරමින්",
    wrongPassword: "මුරපදය වැරදියි",
    failed: "පිවිසීම අසාර්ථකයි",
  },
  list: {
    heading: "සැසි",
    logout: "පිටවන්න",
    titlePlaceholder: "සැසි නම",
    languages: "භාෂා",
    engine: "පරිවර්තන එන්ජිම",
    fallbackEngine: "විකල්ප එන්ජිම",
    noFallback: "භාවිත නොකරන්න",
    engineNoKey: "යතුරක් නැත",
    model: "භාෂා ආකෘතිය",
    create: "සැසියක් සාදන්න",
    creating: "සාදමින්",
    loading: "සකසමින්",
    active: "ක්‍රියාත්මකයි",
    closed: "අවසන්",
    noActive: "ක්‍රියාත්මක සැසි නැත",
    noClosed: "අවසන් වූ සැසි නැත",
    needTitle: "සැසි නම ඇතුළත් කරන්න",
    needLanguages: "වෙනස් භාෂා දෙකක් හෝ වැඩි ගණනක් තෝරන්න",
    createFailed: "සැසිය සෑදිය නොහැකි විය",
    settingFailed: "පරිවර්තන එන්ජින් සැකසුම සුරැකිය නොහැකි විය",
    closeSession: "අවසන් කරන්න",
    closingSession: "අවසන් කරමින්",
    closeConfirm: "“{title}” සැසිය අවසන් කරන්නද? ඉන්පසු තවත් දත්ත ඇතුළත් කළ නොහැක.",
    closeFailed: "සැසිය අවසන් කළ නොහැකි විය",
    deleteSession: "මකන්න",
    deletingSession: "මකමින්",
    deleteConfirm: "“{title}” සැසිය සහ සියලු දත්ත ස්ථිරවම මකන්නද? මෙය ආපසු හැරවිය නොහැක.",
    deleteFailed: "සැසිය මකා දැමිය නොහැකි විය",
  },
  dashboard: {
    close: "සැසිය අවසන් කරන්න",
    closedNotice: "සැසිය අවසන් වී ඇත",
    unsupportedEngine:
      "{engine} {languages} සඳහා සහය නොදක්වයි · විකල්ප එන්ජිම: {fallback}",
    pages: "පිටු URL — සහභාගිවන්නන්ට බෙදා දෙන්න",
    participantGuide: "සහභාගිවන්නන්ගේ මාර්ගෝපදේශය",
    input: "ඇතුළත් කිරීම (කෙටි සටහන්කරු)",
    output: "පරිවර්තනය (සහභාගිවන්නා)",
    capture: "හඬ ග්‍රහණය",
    live: "තත්‍ය කාලීන පරිවර්තනය",
    source: "මූලාශ්‍රය",
    done: "සම්පූර්ණයි",
    failed: "අසාර්ථකයි",
    copy: "පිටපත් කරන්න",
    copied: "පිටපත් කළා",
    copyFailed: "පිටපත් කළ නොහැකි විය",
    openNew: "නව කවුළුවක විවෘත කරන්න",
    showQr: "QR පෙන්වන්න",
    downloadQr: "රූපය බාගන්න",
    closeQr: "වසන්න",
    qrFailed: "QR කේතය සෑදිය නොහැකි විය",
    log: "ලොගය බලන්න →",
    popup: "නව උත්පතන කවුළුව",
  },
  log: {
    notice: "මෙම කවුළුව ලොගය සඳහා පමණි · සංචාලනය නැත",
    title: "ලොගය",
    download: ".txt බාගන්න",
    empty: "පෙන්වීමට ලොග සටහන් නැත",
  },
  keys: {
    button: "API යතුර ලියාපදිංචිය",
    title: "පරිවර්තන එන්ජිමේ API යතුර",
    close: "වසන්න",
    note: "යතුරු සංකේතනය කර පරිපාලක දත්ත ගබඩාවේ තබන අතර තිරයෙන් නැවත බැලිය නොහැක.",
    none: "නැත",
    registered: "ලියාපදිංචියි",
    placeholder: "API යතුර",
    replacePlaceholder: "නව යතුරකින් ප්‍රතිස්ථාපනය",
    save: "සුරකින්න",
    saving: "සුරකිමින්",
    remove: "මකන්න",
    saveFailed: "යතුර සුරැකිය නොහැකි විය",
    removeFailed: "යතුර මැකිය නොහැකි විය",
  },
  languages: {
    add: "භාෂාවක් එක් කරන්න",
    search: "භාෂාව සොයන්න",
    noResults: "ප්‍රතිඵල නැත",
    translateWith: "අතුරුමුහුණත් පරිවර්තන එන්ජිම",
    confirm: "එක් කරන්න",
    adding: "එක් කරමින්",
    addFailed: "භාෂාව එක් කළ නොහැකි විය",
    remove: "ඉවත් කරන්න",
    removeFailed: "භාෂාව ඉවත් කළ නොහැකි විය",
    inUse: "සැසියක භාවිත වූ භාෂාවක් ඉවත් කළ නොහැක",
    builtin: "පෙරනිමි භාෂාව",
    unsupported: "සහාය නැත",
    partial: "පරිවර්තනය නොවූ පෙළ",
    close: "වසන්න",
  },
  strings: {
    button: "පෙළ සංස්කරණය",
    title: "අතුරුමුහුණත් පෙළ",
    search: "පෙළ සොයන්න",
    source: "කොරියානු මූලය",
    save: "සුරකින්න",
    saving: "සුරකිමින්",
    revert: "පෙර තත්ත්වයට",
    retranslate: "නැවත පරිවර්තනය",
    retranslating: "පරිවර්තනය කරමින්",
    saveFailed: "පෙළ සුරැකිය නොහැකි විය",
    noChanges: "වෙනසක් නැත",
    manual: "සංස්කරණය කළා",
    close: "වසන්න",
    empty: "පෙළ නැත",
  },
};

/** 코드에 박혀 있는 관리자 화면 문구 */
export const BUILTIN_ADMIN: Record<LanguageCode, AdminStrings> = {
  ko: adminKo,
  vi: adminVi,
  th: adminTh,
  si: adminSi,
};

export const FALLBACK_ADMIN: AdminStrings = adminKo;

/**
 * 중첩 객체를 점 경로 하나짜리 map 으로 편다.
 *
 * `{ list: { heading: "세션" } }` → `{ "list.heading": "세션" }`
 *
 * DB 는 행 단위로 저장하고 화면은 중첩 객체로 읽으므로 양방향 변환이 필요하다.
 * 값이 전부 문자열인 2단 구조만 다루면 되어 재귀가 단순하다.
 */
export function flattenStrings(source: object, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else if (value && typeof value === "object") {
      Object.assign(out, flattenStrings(value, path));
    }
  }

  return out;
}

/**
 * 평탄한 map 을 원래 모양으로 되돌린다.
 *
 * `base` 의 구조를 그대로 따라가며 값만 갈아 끼운다 — 이렇게 하면 DB 에 엉뚱한
 * 키가 들어 있어도 화면이 기대하는 모양이 깨지지 않고, 없는 키는 자동으로
 * `base` 값(=빌트인)이 남는다.
 */
export function applyStrings<T extends object>(base: T, overlay: Record<string, string>): T {
  const walk = (node: unknown, prefix: string): unknown => {
    if (typeof node === "string") {
      const replacement = overlay[prefix];
      return typeof replacement === "string" && replacement.trim() ? replacement : node;
    }
    if (!node || typeof node !== "object") return node;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = walk(value, prefix ? `${prefix}.${key}` : key);
    }
    return out;
  };

  return walk(base, "") as T;
}

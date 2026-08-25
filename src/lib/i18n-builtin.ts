/*
 * 코드에 박혀 있는 UI 문구.
 *
 * **이 파일은 DB 를 건드리지 않는다 — 클라이언트 번들에 들어가도 안전하다.**
 * 클라이언트 컴포넌트도 이 타입을 가져가므로 그 경계를 지켜야 한다.
 * DB 오버레이를 얹는 해석기는 `lib/i18n.ts` 에 있다.
 */
import { z } from "zod";

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
  role: {
    input: string;
    output: string;
    combined: string;
    combinedInput: string;
    capture: string;
  };
  input: {
    language: string;
    autoLanguage: string;
    placeholder: string;
    send: string;
    sending: string;
    hint: string;
    chooseLanguage: string;
    chooseLanguageNote: string;
    cancelLanguage: string;
  };
  message: {
    edit: string;
    save: string;
    cancel: string;
    saving: string;
    edited: string;
    editFailed: string;
    editConflict: string;
  };
  capture: {
    toggle: string;
    keyRequired: string;
    localUnavailable: string;
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
    invalidLanguage: string;
    fallback: string;
    level: string;
    levelTooQuiet: string;
    levelClipping: string;
  };
  status: {
    waiting: string;
    noContent: string;
    lastInput: string;
    lastOutput: string;
    failed: string;
    openaiBilling: string;
    openaiRateLimit: string;
    newMessages: string;
  };
  meeting: { closed: string };
  speaker: {
    label: string;
    placeholder: string;
    required: string;
    prompt: string;
    confirm: string;
    duplicate: string;
  };
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

/** 저장된 제공자 오류 코드를 현재 화면 언어의 안전한 안내로 바꾼다. */
export function translationFailureText(
  error: string | null | undefined,
  strings: UiStrings["status"],
): string {
  const normalized = error?.toLowerCase() ?? "";
  if (
    error === "openai-billing-limit" ||
    [
      "credit_balance_exhausted",
      "organization_spend_limit_exceeded",
      "project_spend_limit_exceeded",
      "organization_usage_limit_exceeded",
      "insufficient_quota",
      "current quota",
    ].some((marker) => normalized.includes(marker))
  ) return strings.openaiBilling;
  if (
    error === "openai-rate-limit" ||
    (normalized.includes("openai") && normalized.includes("429"))
  ) return strings.openaiRateLimit;
  return strings.failed;
}

const ko: UiStrings = {
  connection: { connected: "연결됨", reconnecting: "다시 연결 중", disconnected: "연결 끊김" },
  role: { input: "입력", output: "출력", combined: "통합 조회", combinedInput: "통합 입력", capture: "음성 수집" },
  input: {
    language: "입력 언어",
    autoLanguage: "자동 감지",
    placeholder: "세션 내용을 입력하세요",
    send: "보내기",
    sending: "보내는 중",
    hint: "Enter 로 전송 · Shift+Enter 로 줄바꿈",
    chooseLanguage: "입력 언어 선택",
    chooseLanguageNote: "언어를 확실히 감지하지 못했습니다. 이 문장의 언어를 골라 주세요.",
    cancelLanguage: "취소",
  },
  message: {
    edit: "수정",
    save: "저장",
    cancel: "취소",
    saving: "저장 중",
    edited: "수정됨",
    editFailed: "메시지를 수정하지 못했습니다",
    editConflict: "다른 수정이 먼저 반영되었습니다. 최신 내용을 확인해 주세요",
  },
  capture: {
    toggle: "자동 음성 입력 사용",
    keyRequired: "OpenAI API 키가 등록되지 않았습니다",
    localUnavailable: "로컬 음성 인식 모델이 설치되지 않았습니다",
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
    invalidLanguage: "선택한 입력 언어를 사용할 수 없습니다",
    fallback: "언어를 확인하지 못해 {language}(으)로 처리했습니다",
    level: "입력 음량",
    levelTooQuiet: "소리가 너무 작습니다 — 마이크를 가까이 하세요",
    levelClipping: "소리가 너무 큽니다 — 조금 떨어지세요",
  },
  status: {
    waiting: "번역을 기다리는 중",
    noContent: "아직 내용이 없습니다",
    lastInput: "마지막 입력",
    lastOutput: "마지막 번역",
    failed: "번역 실패",
    openaiBilling: "OpenAI API 크레딧 또는 사용 한도가 소진되었습니다. OpenAI 결제 및 사용 한도를 확인해 주세요.",
    openaiRateLimit: "OpenAI API 요청 한도를 일시적으로 초과했습니다. 잠시 후 다시 시도해 주세요.",
    newMessages: "새 문장",
  },
  meeting: { closed: "종료된 세션입니다" },
  speaker: {
    label: "닉네임",
    placeholder: "닉네임을 입력하세요",
    required: "입력하려면 닉네임이 필요합니다",
    prompt: "이 입력 페이지에서 사용할 닉네임을 입력해 주세요.",
    confirm: "확인",
    duplicate: "이미 사용 중인 닉네임입니다.",
  },
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
  role: { input: "Nhập liệu", output: "Bản dịch", combined: "Xem tổng hợp", combinedInput: "Nhập liệu tổng hợp", capture: "Thu âm" },
  input: {
    language: "Ngôn ngữ nhập",
    autoLanguage: "Tự động nhận diện",
    placeholder: "Nhập nội dung phiên",
    send: "Gửi",
    sending: "Đang gửi",
    hint: "Enter để gửi · Shift+Enter để xuống dòng",
    chooseLanguage: "Chọn ngôn ngữ nhập",
    chooseLanguageNote: "Không thể xác định chắc chắn ngôn ngữ. Hãy chọn ngôn ngữ của câu này.",
    cancelLanguage: "Hủy",
  },
  message: {
    edit: "Chỉnh sửa",
    save: "Lưu",
    cancel: "Hủy",
    saving: "Đang lưu",
    edited: "Đã chỉnh sửa",
    editFailed: "Không chỉnh sửa được tin nhắn",
    editConflict: "Một thay đổi khác đã được lưu trước. Hãy kiểm tra nội dung mới nhất",
  },
  capture: {
    toggle: "Sử dụng nhập liệu bằng giọng nói tự động",
    keyRequired: "Chưa đăng ký khóa API OpenAI",
    localUnavailable: "Chưa cài đặt mô hình nhận dạng giọng nói cục bộ",
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
    invalidLanguage: "Không thể sử dụng ngôn ngữ nhập đã chọn",
    fallback: "Không xác định được ngôn ngữ nên đã xử lý bằng {language}",
    level: "Âm lượng đầu vào",
    levelTooQuiet: "Âm thanh quá nhỏ — hãy lại gần micrô hơn",
    levelClipping: "Âm thanh quá lớn — hãy tránh xa micrô một chút",
  },
  status: {
    waiting: "Đang chờ bản dịch",
    noContent: "Chưa có nội dung",
    lastInput: "Lần nhập cuối",
    lastOutput: "Bản dịch cuối",
    failed: "Dịch thất bại",
    openaiBilling: "Tín dụng hoặc hạn mức sử dụng OpenAI API đã hết. Hãy kiểm tra phần thanh toán và hạn mức sử dụng OpenAI.",
    openaiRateLimit: "Đã tạm thời vượt quá giới hạn yêu cầu OpenAI API. Hãy thử lại sau ít phút.",
    newMessages: "Câu mới",
  },
  meeting: { closed: "Phiên đã kết thúc" },
  speaker: {
    label: "Tên hiển thị",
    placeholder: "Nhập tên hiển thị",
    required: "Cần tên hiển thị để nhập nội dung",
    prompt: "Nhập tên hiển thị bạn sẽ dùng trên trang nhập liệu này.",
    confirm: "Xác nhận",
    duplicate: "Tên hiển thị này đang được sử dụng.",
  },
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
  role: { input: "ป้อนข้อมูล", output: "คำแปล", combined: "มุมมองรวม", combinedInput: "ป้อนข้อมูลรวม", capture: "รับเสียง" },
  input: {
    language: "ภาษาที่ป้อน",
    autoLanguage: "ตรวจจับอัตโนมัติ",
    placeholder: "พิมพ์เนื้อหาเซสชัน",
    send: "ส่ง",
    sending: "กำลังส่ง",
    hint: "กด Enter เพื่อส่ง · Shift+Enter เพื่อขึ้นบรรทัดใหม่",
    chooseLanguage: "เลือกภาษาที่ป้อน",
    chooseLanguageNote: "ไม่สามารถระบุภาษาได้อย่างมั่นใจ โปรดเลือกภาษาของประโยคนี้",
    cancelLanguage: "ยกเลิก",
  },
  message: {
    edit: "แก้ไข",
    save: "บันทึก",
    cancel: "ยกเลิก",
    saving: "กำลังบันทึก",
    edited: "แก้ไขแล้ว",
    editFailed: "แก้ไขข้อความไม่สำเร็จ",
    editConflict: "มีการบันทึกการแก้ไขอื่นก่อนแล้ว โปรดตรวจสอบเนื้อหาล่าสุด",
  },
  capture: {
    toggle: "ใช้การป้อนข้อมูลด้วยเสียงอัตโนมัติ",
    keyRequired: "ยังไม่ได้ลงทะเบียนคีย์ OpenAI API",
    localUnavailable: "ยังไม่ได้ติดตั้งโมเดลรู้จำเสียงภายในเครื่อง",
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
    invalidLanguage: "ไม่สามารถใช้ภาษาที่เลือกได้",
    fallback: "ไม่สามารถระบุภาษาได้ จึงประมวลผลเป็น {language}",
    level: "ระดับเสียงที่เข้า",
    levelTooQuiet: "เสียงเบาเกินไป — โปรดเข้าใกล้ไมโครโฟน",
    levelClipping: "เสียงดังเกินไป — โปรดอยู่ห่างจากไมโครโฟนเล็กน้อย",
  },
  status: {
    waiting: "กำลังรอคำแปล",
    noContent: "ยังไม่มีเนื้อหา",
    lastInput: "ป้อนข้อมูลล่าสุด",
    lastOutput: "คำแปลล่าสุด",
    failed: "แปลไม่สำเร็จ",
    openaiBilling: "เครดิตหรือวงเงินการใช้งาน OpenAI API หมดแล้ว โปรดตรวจสอบการเรียกเก็บเงินและขีดจำกัดการใช้งาน OpenAI",
    openaiRateLimit: "เกินขีดจำกัดคำขอ OpenAI API ชั่วคราว โปรดลองอีกครั้งในภายหลัง",
    newMessages: "ข้อความใหม่",
  },
  meeting: { closed: "เซสชันสิ้นสุดแล้ว" },
  speaker: {
    label: "ชื่อที่แสดง",
    placeholder: "กรอกชื่อที่แสดง",
    required: "ต้องระบุชื่อก่อนป้อนข้อมูล",
    prompt: "กรอกชื่อที่จะแสดงในหน้าป้อนข้อมูลนี้",
    confirm: "ยืนยัน",
    duplicate: "ชื่อที่แสดงนี้มีผู้ใช้อยู่แล้ว",
  },
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
  role: { input: "ඇතුළත් කිරීම", output: "පරිවර්තනය", combined: "ඒකාබද්ධ දසුන", combinedInput: "ඒකාබද්ධ ඇතුළත් කිරීම", capture: "හඬ ග්‍රහණය" },
  input: {
    language: "ආදාන භාෂාව",
    autoLanguage: "ස්වයංක්‍රීයව හඳුනාගන්න",
    placeholder: "සැසි අන්තර්ගතය ටයිප් කරන්න",
    send: "යවන්න",
    sending: "යවමින්",
    hint: "යැවීමට Enter · නව පේළියකට Shift+Enter",
    chooseLanguage: "ආදාන භාෂාව තෝරන්න",
    chooseLanguageNote: "භාෂාව විශ්වාසයෙන් හඳුනාගත නොහැකි විය. මෙම වාක්‍යයේ භාෂාව තෝරන්න.",
    cancelLanguage: "අවලංගු කරන්න",
  },
  message: {
    edit: "සංස්කරණය",
    save: "සුරකින්න",
    cancel: "අවලංගු කරන්න",
    saving: "සුරකිමින්",
    edited: "සංස්කරණය කළා",
    editFailed: "පණිවිඩය සංස්කරණය කළ නොහැකි විය",
    editConflict: "වෙනත් සංස්කරණයක් මුලින් සුරැකිණි. නවතම අන්තර්ගතය පරීක්ෂා කරන්න",
  },
  capture: {
    toggle: "ස්වයංක්‍රීය හඬ ආදානය භාවිත කරන්න",
    keyRequired: "OpenAI API යතුර ලියාපදිංචි කර නැත",
    localUnavailable: "දේශීය හඬ හඳුනාගැනීමේ ආකෘතිය ස්ථාපනය කර නැත",
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
    invalidLanguage: "තෝරාගත් ආදාන භාෂාව භාවිත කළ නොහැක",
    fallback: "භාෂාව හඳුනාගත නොහැකි නිසා {language} ලෙස සැකසීය",
    level: "ආදාන ශබ්ද මට්ටම",
    levelTooQuiet: "හඬ ඉතා මෘදුයි — මයික්‍රෆෝනයට ළං වන්න",
    levelClipping: "හඬ ඉතා වැඩියි — මයික්‍රෆෝනයෙන් ටිකක් ඈත් වන්න",
  },
  status: {
    waiting: "පරිවර්තනය එනතුරු",
    noContent: "තවම අන්තර්ගතයක් නැත",
    lastInput: "අවසන් ඇතුළත් කිරීම",
    lastOutput: "අවසන් පරිවර්තනය",
    failed: "පරිවර්තනය අසාර්ථකයි",
    openaiBilling: "OpenAI API ණය හෝ භාවිත සීමාව අවසන් වී ඇත. OpenAI බිල්පත් සහ භාවිත සීමා පරීක්ෂා කරන්න.",
    openaiRateLimit: "OpenAI API ඉල්ලීම් සීමාව තාවකාලිකව ඉක්මවා ඇත. මඳ වේලාවකින් නැවත උත්සාහ කරන්න.",
    newMessages: "නව වාක්‍ය",
  },
  meeting: { closed: "සැසිය අවසන් වී ඇත" },
  speaker: {
    label: "පෙන්වන නම",
    placeholder: "පෙන්වන නම ඇතුළත් කරන්න",
    required: "ඇතුළත් කිරීමට නමක් අවශ්‍යයි",
    prompt: "මෙම ආදාන පිටුවේ භාවිත කරන පෙන්වන නම ඇතුළත් කරන්න.",
    confirm: "තහවුරු කරන්න",
    duplicate: "මෙම පෙන්වන නම දැනටමත් භාවිත වේ.",
  },
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
export const BUILTIN_UI = new Map<LanguageCode, UiStrings>([
  ["ko", ko],
  ["vi", vi],
  ["th", th],
  ["si", si],
]);

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
  passwordChange: {
    button: string;
    title: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    minimum: string;
    cancel: string;
    save: string;
    saving: string;
    success: string;
    invalidCurrent: string;
    tooShort: string;
    tooLong: string;
    samePassword: string;
    mismatch: string;
    failed: string;
    close: string;
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
    /** OpenAI 를 골랐을 때만 나오는 고정 언어모델 라벨 */
    model: string;
    transcriptionProvider: string;
    transcriptionOpenai: string;
    transcriptionLocal: string;
    notInstalled: string;
    localGlossaryUnsupported: string;
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
    backToAdmin: string;
    close: string;
    closedNotice: string;
    unsupportedEngine: string;
    pages: string;
    participantGuide: string;
    inputGuide: string;
    input: string;
    output: string;
    capture: string;
    combinedInput: string;
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
  settings: {
    heading: string;
    preset: string;
    meetingPreset: string;
    assemblyPreset: string;
    applyPreset: string;
    languages: string;
    addLanguage: string;
    selectLanguage: string;
    input: string;
    output: string;
    nickname: string;
    nicknameNote: string;
    combinedInput: string;
    combinedInputNote: string;
    combinedInputFallback: string;
    transcriptionContext: string;
    transcriptionContextNote: string;
    transcriptionContextPlaceholder: string;
    contextSave: string;
    save: string;
    saving: string;
    saved: string;
    saveFailed: string;
    locked: string;
    needLanguages: string;
    needInput: string;
    presetName: string;
    savePreset: string;
    updatePreset: string;
    deletePreset: string;
    deletePresetConfirm: string;
    presetSaved: string;
    presetFailed: string;
    presetLanguageMismatch: string;
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
  openaiUsage: {
    button: string;
    title: string;
    close: string;
    description: string;
    adminKey: string;
    configured: string;
    notConfigured: string;
    placeholder: string;
    replacePlaceholder: string;
    save: string;
    saving: string;
    remove: string;
    saveFailed: string;
    removeFailed: string;
    keyRequired: string;
    keyInvalid: string;
    permissionDenied: string;
    rateLimited: string;
    loadFailed: string;
    period: string;
    daily: string;
    weekly: string;
    loading: string;
    empty: string;
    input: string;
    cached: string;
    output: string;
    requests: string;
    cost: string;
    unknownCost: string;
    organizationNote: string;
    pricingNote: string;
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
  glossary: {
    button: string;
    title: string;
    add: string;
    download: string;
    upload: string;
    uploadReady: string;
    uploadFailed: string;
    source: string;
    translation: string;
    providerNote: string;
    save: string;
    saving: string;
    saveFailed: string;
    required: string;
    remove: string;
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
  passwordChange: {
    button: "비밀번호 변경",
    title: "관리자 비밀번호 변경",
    currentPassword: "현재 비밀번호",
    newPassword: "새 비밀번호",
    confirmPassword: "새 비밀번호 확인",
    minimum: "12자 이상 입력해 주세요",
    cancel: "취소",
    save: "변경",
    saving: "변경 중",
    success: "비밀번호가 변경되었습니다",
    invalidCurrent: "현재 비밀번호가 올바르지 않습니다",
    tooShort: "새 비밀번호는 12자 이상이어야 합니다",
    tooLong: "새 비밀번호는 128자 이하여야 합니다",
    samePassword: "새 비밀번호는 현재 비밀번호와 달라야 합니다",
    mismatch: "새 비밀번호 확인이 일치하지 않습니다",
    failed: "비밀번호를 변경하지 못했습니다",
    close: "닫기",
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
    transcriptionProvider: "음성 인식 엔진",
    transcriptionOpenai: "OpenAI 실시간 전사",
    transcriptionLocal: "로컬 AI (Whisper)",
    notInstalled: "설치되지 않음",
    localGlossaryUnsupported: "Local AI 번역에는 단어집이 적용되지 않습니다",
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
    backToAdmin: "관리 페이지로 돌아가기",
    close: "세션 종료",
    closedNotice: "세션이 종료되었습니다",
    unsupportedEngine:
      "{engine}은(는) {languages}을(를) 지원하지 않습니다 · 폴백 엔진: {fallback}",
    pages: "페이지 URL — 참석자에게 배포",
    participantGuide: "참가자 안내",
    inputGuide: "입력자 안내",
    input: "입력",
    output: "출력",
    capture: "음성 수집",
    combinedInput: "통합 입력",
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
  settings: {
    heading: "운영 설정",
    preset: "프리셋",
    meetingPreset: "회의",
    assemblyPreset: "집회",
    applyPreset: "적용",
    languages: "언어별 페이지",
    addLanguage: "언어 추가",
    selectLanguage: "언어 선택",
    input: "입력",
    output: "출력",
    nickname: "닉네임 사용",
    nicknameNote: "입력자가 이름을 정하고 모든 원문·번역·로그에 화자를 표시합니다.",
    combinedInput: "통합 입력 사용",
    combinedInputNote: "한 페이지에서 타자 또는 마이크로 여러 입력 언어를 자동 감지합니다.",
    combinedInputFallback: "언어 감지 실패 시 기본 언어",
    transcriptionContext: "음성 인식 참고 정보",
    transcriptionContextNote: "AI가 더 정확히 받아쓰도록 세션 주제, 사람 이름, 자주 나오는 용어를 적어 주세요. 다음 음성 인식 시작부터 적용됩니다.",
    transcriptionContextPlaceholder: "예: 신제품 출시 회의 · 이름: 김민수, Priya · 자주 나오는 용어: LiveConfTranslation, SLA",
    contextSave: "참고 정보 저장",
    save: "설정 저장",
    saving: "저장 중",
    saved: "설정이 저장되었습니다",
    saveFailed: "설정을 저장하지 못했습니다",
    locked: "첫 입력이 등록되어 운영 설정이 잠겼습니다.",
    needLanguages: "활성 언어를 두 개 이상 설정해 주세요",
    needInput: "입력 페이지를 하나 이상 켜 주세요",
    presetName: "프리셋 이름",
    savePreset: "새 프리셋 저장",
    updatePreset: "프리셋 덮어쓰기",
    deletePreset: "프리셋 삭제",
    deletePresetConfirm: "이 프리셋을 삭제할까요?",
    presetSaved: "프리셋이 저장되었습니다",
    presetFailed: "프리셋을 처리하지 못했습니다",
    presetLanguageMismatch: "선택한 세션 언어와 프리셋 언어가 일치하지 않습니다",
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
  openaiUsage: {
    button: "사용량 조회",
    title: "OpenAI 사용량",
    close: "닫기",
    description: "조직 Usage API에서 모델별 토큰과 예상 비용을 조회합니다.",
    adminKey: "OpenAI Admin API 키",
    configured: "등록됨",
    notConfigured: "등록 필요",
    placeholder: "Admin API 키",
    replacePlaceholder: "새 Admin API 키로 덮어쓰기",
    save: "저장",
    saving: "저장 중",
    remove: "삭제",
    saveFailed: "Admin API 키를 저장하지 못했습니다",
    removeFailed: "Admin API 키를 지우지 못했습니다",
    keyRequired: "사용량 조회용 Admin API 키를 먼저 등록해 주세요.",
    keyInvalid: "Admin API 키가 올바르지 않습니다.",
    permissionDenied: "이 키에는 조직 사용량을 조회할 권한이 없습니다.",
    rateLimited: "OpenAI 사용량 조회 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
    loadFailed: "OpenAI 사용량을 불러오지 못했습니다.",
    period: "조회 기간",
    daily: "일간 · 최근 24시간",
    weekly: "주간 · 최근 7일",
    loading: "사용량을 불러오는 중",
    empty: "선택한 기간의 사용량이 없습니다.",
    input: "입력 토큰",
    cached: "캐시 입력",
    output: "출력 토큰",
    requests: "요청 수",
    cost: "예상 비용",
    unknownCost: "계산 불가",
    organizationNote: "조회값은 이 앱만이 아니라 Admin API 키가 속한 OpenAI 조직 전체 사용량입니다.",
    pricingNote: "예상 비용은 2026-08-25에 확인한 OpenAI 공식 모델별 Standard 요금으로 계산합니다. 배치·서비스 등급·장문 컨텍스트·가격 변경에 따라 실제 청구액과 다를 수 있습니다.",
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
  glossary: {
    button: "단어집",
    title: "번역 단어집",
    add: "단어 추가",
    download: "CSV 다운로드",
    upload: "CSV 업로드",
    uploadReady: "CSV를 불러왔습니다 · 저장을 눌러 적용하세요",
    uploadFailed: "CSV 파일을 불러오지 못했습니다",
    source: "원단어",
    translation: "번역 단어",
    providerNote:
      "OpenAI에는 항상 적용됩니다. DeepL은 지원 언어쌍에 적용되며, 현재 Google API 키 방식은 단어집을 지원하지 않습니다.",
    save: "저장",
    saving: "저장 중",
    saveFailed: "단어집을 저장하지 못했습니다",
    required: "등록된 모든 언어의 단어를 입력해 주세요",
    remove: "단어 삭제",
    close: "닫기",
    empty: "등록된 단어가 없습니다",
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
  passwordChange: {
    button: "Đổi mật khẩu",
    title: "Đổi mật khẩu quản trị",
    currentPassword: "Mật khẩu hiện tại",
    newPassword: "Mật khẩu mới",
    confirmPassword: "Xác nhận mật khẩu mới",
    minimum: "Nhập ít nhất 12 ký tự",
    cancel: "Hủy",
    save: "Đổi",
    saving: "Đang đổi",
    success: "Mật khẩu đã được thay đổi",
    invalidCurrent: "Mật khẩu hiện tại không đúng",
    tooShort: "Mật khẩu mới phải có ít nhất 12 ký tự",
    tooLong: "Mật khẩu mới không được quá 128 ký tự",
    samePassword: "Mật khẩu mới phải khác mật khẩu hiện tại",
    mismatch: "Xác nhận mật khẩu mới không khớp",
    failed: "Không đổi được mật khẩu",
    close: "Đóng",
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
    transcriptionProvider: "Công cụ nhận dạng giọng nói",
    transcriptionOpenai: "Phiên âm thời gian thực OpenAI",
    transcriptionLocal: "AI cục bộ (Whisper)",
    notInstalled: "Chưa cài đặt",
    localGlossaryUnsupported: "Bản dịch AI cục bộ không áp dụng bảng thuật ngữ",
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
    backToAdmin: "Quay lại trang quản trị",
    close: "Kết thúc phiên",
    closedNotice: "Phiên đã kết thúc",
    unsupportedEngine:
      "{engine} không hỗ trợ {languages} · Công cụ dự phòng: {fallback}",
    pages: "URL trang — gửi cho người tham dự",
    participantGuide: "Hướng dẫn người tham dự",
    inputGuide: "Hướng dẫn người nhập",
    input: "Nhập liệu",
    output: "Bản dịch",
    capture: "Thu âm",
    combinedInput: "Nhập liệu tổng hợp",
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
  settings: {
    heading: "Cài đặt vận hành",
    preset: "Mẫu cài đặt",
    meetingPreset: "Cuộc họp",
    assemblyPreset: "Hội nghị",
    applyPreset: "Áp dụng",
    languages: "Trang theo ngôn ngữ",
    addLanguage: "Thêm ngôn ngữ",
    selectLanguage: "Chọn ngôn ngữ",
    input: "Nhập liệu",
    output: "Bản dịch",
    nickname: "Dùng tên hiển thị",
    nicknameNote: "Người nhập đặt tên và tên người nói xuất hiện trong bản gốc, bản dịch và nhật ký.",
    combinedInput: "Dùng trang nhập liệu tổng hợp",
    combinedInputNote: "Tự động nhận diện nhiều ngôn ngữ nhập bằng bàn phím hoặc micrô trên một trang.",
    combinedInputFallback: "Ngôn ngữ mặc định khi không nhận diện được",
    transcriptionContext: "Thông tin hỗ trợ nhận dạng giọng nói",
    transcriptionContextNote: "Nhập chủ đề phiên, tên người và các thuật ngữ thường gặp để AI ghi lại chính xác hơn. Áp dụng từ lần bắt đầu nhận dạng giọng nói tiếp theo.",
    transcriptionContextPlaceholder: "Ví dụ: Họp ra mắt sản phẩm mới · Tên: Kim Min-su, Priya · Thuật ngữ thường gặp: LiveConfTranslation, SLA",
    contextSave: "Lưu thông tin hỗ trợ",
    save: "Lưu cài đặt",
    saving: "Đang lưu",
    saved: "Đã lưu cài đặt",
    saveFailed: "Không lưu được cài đặt",
    locked: "Cài đặt đã khóa vì nội dung đầu tiên đã được gửi.",
    needLanguages: "Hãy bật ít nhất hai ngôn ngữ",
    needInput: "Hãy bật ít nhất một trang nhập liệu",
    presetName: "Tên mẫu",
    savePreset: "Lưu mẫu mới",
    updatePreset: "Ghi đè mẫu",
    deletePreset: "Xóa mẫu",
    deletePresetConfirm: "Xóa mẫu này?",
    presetSaved: "Đã lưu mẫu",
    presetFailed: "Không xử lý được mẫu",
    presetLanguageMismatch: "Ngôn ngữ của phiên đã chọn không khớp với ngôn ngữ của mẫu",
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
  openaiUsage: {
    button: "Xem mức sử dụng",
    title: "Mức sử dụng OpenAI",
    close: "Đóng",
    description: "Xem số token và chi phí ước tính theo mô hình từ API Usage của tổ chức.",
    adminKey: "Khóa OpenAI Admin API",
    configured: "Đã đăng ký",
    notConfigured: "Cần đăng ký",
    placeholder: "Khóa Admin API",
    replacePlaceholder: "Ghi đè bằng khóa Admin API mới",
    save: "Lưu",
    saving: "Đang lưu",
    remove: "Xóa",
    saveFailed: "Không lưu được khóa Admin API",
    removeFailed: "Không xóa được khóa Admin API",
    keyRequired: "Hãy đăng ký khóa Admin API để xem mức sử dụng.",
    keyInvalid: "Khóa Admin API không hợp lệ.",
    permissionDenied: "Khóa này không có quyền xem mức sử dụng của tổ chức.",
    rateLimited: "Đã vượt giới hạn truy vấn mức sử dụng. Hãy thử lại sau.",
    loadFailed: "Không tải được mức sử dụng OpenAI.",
    period: "Khoảng thời gian",
    daily: "Ngày · 24 giờ qua",
    weekly: "Tuần · 7 ngày qua",
    loading: "Đang tải mức sử dụng",
    empty: "Không có mức sử dụng trong khoảng đã chọn.",
    input: "Token đầu vào",
    cached: "Đầu vào đã lưu đệm",
    output: "Token đầu ra",
    requests: "Số yêu cầu",
    cost: "Chi phí ước tính",
    unknownCost: "Không tính được",
    organizationNote: "Số liệu là tổng mức sử dụng của toàn bộ tổ chức OpenAI chứa khóa Admin API, không chỉ riêng ứng dụng này.",
    pricingNote: "Chi phí ước tính được tính theo giá Standard chính thức của từng mô hình OpenAI, được kiểm tra ngày 25-08-2026. Hóa đơn thực tế có thể khác do batch, hạng dịch vụ, ngữ cảnh dài hoặc thay đổi giá.",
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
  glossary: {
    button: "Bảng thuật ngữ",
    title: "Bảng thuật ngữ dịch",
    add: "Thêm thuật ngữ",
    download: "Tải CSV",
    upload: "Tải lên CSV",
    uploadReady: "Đã tải CSV · Nhấn Lưu để áp dụng",
    uploadFailed: "Không đọc được tệp CSV",
    source: "Thuật ngữ gốc",
    translation: "Thuật ngữ dịch",
    providerNote:
      "Luôn áp dụng với OpenAI. DeepL áp dụng cho các cặp ngôn ngữ được hỗ trợ; chế độ khóa API Google hiện tại không hỗ trợ bảng thuật ngữ.",
    save: "Lưu",
    saving: "Đang lưu",
    saveFailed: "Không lưu được bảng thuật ngữ",
    required: "Hãy nhập thuật ngữ cho mọi ngôn ngữ đã đăng ký",
    remove: "Xóa thuật ngữ",
    close: "Đóng",
    empty: "Chưa có thuật ngữ",
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
  passwordChange: {
    button: "เปลี่ยนรหัสผ่าน",
    title: "เปลี่ยนรหัสผ่านผู้ดูแล",
    currentPassword: "รหัสผ่านปัจจุบัน",
    newPassword: "รหัสผ่านใหม่",
    confirmPassword: "ยืนยันรหัสผ่านใหม่",
    minimum: "กรุณากรอกอย่างน้อย 12 ตัวอักษร",
    cancel: "ยกเลิก",
    save: "เปลี่ยน",
    saving: "กำลังเปลี่ยน",
    success: "เปลี่ยนรหัสผ่านแล้ว",
    invalidCurrent: "รหัสผ่านปัจจุบันไม่ถูกต้อง",
    tooShort: "รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร",
    tooLong: "รหัสผ่านใหม่ต้องไม่เกิน 128 ตัวอักษร",
    samePassword: "รหัสผ่านใหม่ต้องต่างจากรหัสผ่านปัจจุบัน",
    mismatch: "การยืนยันรหัสผ่านใหม่ไม่ตรงกัน",
    failed: "เปลี่ยนรหัสผ่านไม่สำเร็จ",
    close: "ปิด",
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
    transcriptionProvider: "เครื่องมือรู้จำเสียง",
    transcriptionOpenai: "ถอดเสียงแบบเรียลไทม์ OpenAI",
    transcriptionLocal: "AI ภายในเครื่อง (Whisper)",
    notInstalled: "ยังไม่ได้ติดตั้ง",
    localGlossaryUnsupported: "การแปลด้วย AI ภายในเครื่องไม่ใช้คลังคำศัพท์",
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
    backToAdmin: "กลับไปหน้าผู้ดูแล",
    close: "สิ้นสุดเซสชัน",
    closedNotice: "เซสชันสิ้นสุดแล้ว",
    unsupportedEngine:
      "{engine} ไม่รองรับ {languages} · เครื่องมือสำรอง: {fallback}",
    pages: "URL หน้า — แจกจ่ายให้ผู้เข้าร่วม",
    participantGuide: "คู่มือผู้เข้าร่วม",
    inputGuide: "คู่มือผู้ป้อนข้อมูล",
    input: "ป้อนข้อมูล",
    output: "คำแปล",
    capture: "รับเสียง",
    combinedInput: "ป้อนข้อมูลรวม",
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
  settings: {
    heading: "การตั้งค่าการใช้งาน",
    preset: "ค่าที่ตั้งไว้",
    meetingPreset: "การประชุม",
    assemblyPreset: "การชุมนุม",
    applyPreset: "นำไปใช้",
    languages: "หน้าตามภาษา",
    addLanguage: "เพิ่มภาษา",
    selectLanguage: "เลือกภาษา",
    input: "ป้อนข้อมูล",
    output: "คำแปล",
    nickname: "ใช้ชื่อที่แสดง",
    nicknameNote: "ผู้ป้อนข้อมูลกำหนดชื่อ และแสดงผู้พูดในต้นฉบับ คำแปล และบันทึกทั้งหมด",
    combinedInput: "ใช้หน้าป้อนข้อมูลรวม",
    combinedInputNote: "ตรวจจับหลายภาษาจากการพิมพ์หรือไมโครโฟนโดยอัตโนมัติในหน้าเดียว",
    combinedInputFallback: "ภาษาเริ่มต้นเมื่อตรวจจับไม่ได้",
    transcriptionContext: "ข้อมูลช่วยการรู้จำเสียง",
    transcriptionContextNote: "ระบุหัวข้อของเซสชัน ชื่อบุคคล และคำศัพท์ที่พบบ่อย เพื่อให้ AI ถอดเสียงได้แม่นยำขึ้น มีผลเมื่อเริ่มการรู้จำเสียงครั้งถัดไป",
    transcriptionContextPlaceholder: "เช่น ประชุมเปิดตัวผลิตภัณฑ์ใหม่ · ชื่อ: Kim Min-su, Priya · คำที่พบบ่อย: LiveConfTranslation, SLA",
    contextSave: "บันทึกข้อมูลช่วยเหลือ",
    save: "บันทึกการตั้งค่า",
    saving: "กำลังบันทึก",
    saved: "บันทึกการตั้งค่าแล้ว",
    saveFailed: "บันทึกการตั้งค่าไม่สำเร็จ",
    locked: "การตั้งค่าถูกล็อกหลังจากส่งข้อความแรกแล้ว",
    needLanguages: "กรุณาเปิดใช้งานอย่างน้อยสองภาษา",
    needInput: "กรุณาเปิดหน้าป้อนข้อมูลอย่างน้อยหนึ่งหน้า",
    presetName: "ชื่อค่าที่ตั้งไว้",
    savePreset: "บันทึกค่าใหม่",
    updatePreset: "เขียนทับค่าที่ตั้งไว้",
    deletePreset: "ลบค่าที่ตั้งไว้",
    deletePresetConfirm: "ลบค่าที่ตั้งไว้นี้หรือไม่?",
    presetSaved: "บันทึกค่าที่ตั้งไว้แล้ว",
    presetFailed: "ดำเนินการกับค่าที่ตั้งไว้ไม่สำเร็จ",
    presetLanguageMismatch: "ภาษาของเซสชันที่เลือกไม่ตรงกับภาษาของค่าที่ตั้งไว้",
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
  openaiUsage: {
    button: "ดูการใช้งาน",
    title: "การใช้งาน OpenAI",
    close: "ปิด",
    description: "ดูจำนวนโทเค็นและค่าใช้จ่ายโดยประมาณแยกตามโมเดลจาก Usage API ขององค์กร",
    adminKey: "คีย์ OpenAI Admin API",
    configured: "ลงทะเบียนแล้ว",
    notConfigured: "ต้องลงทะเบียน",
    placeholder: "คีย์ Admin API",
    replacePlaceholder: "เขียนทับด้วยคีย์ Admin API ใหม่",
    save: "บันทึก",
    saving: "กำลังบันทึก",
    remove: "ลบ",
    saveFailed: "บันทึกคีย์ Admin API ไม่สำเร็จ",
    removeFailed: "ลบคีย์ Admin API ไม่สำเร็จ",
    keyRequired: "โปรดลงทะเบียนคีย์ Admin API สำหรับดูการใช้งานก่อน",
    keyInvalid: "คีย์ Admin API ไม่ถูกต้อง",
    permissionDenied: "คีย์นี้ไม่มีสิทธิ์ดูการใช้งานขององค์กร",
    rateLimited: "เกินขีดจำกัดการดูการใช้งาน โปรดลองอีกครั้งภายหลัง",
    loadFailed: "โหลดการใช้งาน OpenAI ไม่สำเร็จ",
    period: "ช่วงเวลา",
    daily: "รายวัน · 24 ชั่วโมงล่าสุด",
    weekly: "รายสัปดาห์ · 7 วันล่าสุด",
    loading: "กำลังโหลดการใช้งาน",
    empty: "ไม่มีการใช้งานในช่วงเวลาที่เลือก",
    input: "โทเค็นขาเข้า",
    cached: "ขาเข้าจากแคช",
    output: "โทเค็นขาออก",
    requests: "จำนวนคำขอ",
    cost: "ค่าใช้จ่ายโดยประมาณ",
    unknownCost: "คำนวณไม่ได้",
    organizationNote: "ข้อมูลนี้เป็นการใช้งานรวมของทั้งองค์กร OpenAI ที่คีย์ Admin API สังกัด ไม่ใช่เฉพาะแอปนี้",
    pricingNote: "ค่าใช้จ่ายโดยประมาณคำนวณจากราคา Standard อย่างเป็นทางการของแต่ละโมเดล OpenAI ที่ตรวจสอบเมื่อ 25-08-2026 ยอดจริงอาจต่างกันตามแบตช์ ระดับบริการ บริบทยาว หรือการเปลี่ยนราคา",
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
  glossary: {
    button: "อภิธานศัพท์",
    title: "อภิธานศัพท์การแปล",
    add: "เพิ่มคำศัพท์",
    download: "ดาวน์โหลด CSV",
    upload: "อัปโหลด CSV",
    uploadReady: "โหลด CSV แล้ว · กดบันทึกเพื่อใช้งาน",
    uploadFailed: "อ่านไฟล์ CSV ไม่สำเร็จ",
    source: "คำต้นฉบับ",
    translation: "คำแปล",
    providerNote:
      "ใช้กับ OpenAI เสมอ ส่วน DeepL ใช้กับคู่ภาษาที่รองรับ และโหมดคีย์ API ของ Google ปัจจุบันไม่รองรับอภิธานศัพท์",
    save: "บันทึก",
    saving: "กำลังบันทึก",
    saveFailed: "บันทึกอภิธานศัพท์ไม่สำเร็จ",
    required: "กรุณากรอกคำศัพท์สำหรับทุกภาษาที่ลงทะเบียน",
    remove: "ลบคำศัพท์",
    close: "ปิด",
    empty: "ยังไม่มีคำศัพท์",
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
  passwordChange: {
    button: "මුරපදය වෙනස් කරන්න",
    title: "පරිපාලක මුරපදය වෙනස් කරන්න",
    currentPassword: "වත්මන් මුරපදය",
    newPassword: "නව මුරපදය",
    confirmPassword: "නව මුරපදය තහවුරු කරන්න",
    minimum: "අවම වශයෙන් අක්ෂර 12ක් ඇතුළත් කරන්න",
    cancel: "අවලංගු කරන්න",
    save: "වෙනස් කරන්න",
    saving: "වෙනස් කරමින්",
    success: "මුරපදය වෙනස් කරන ලදී",
    invalidCurrent: "වත්මන් මුරපදය නිවැරදි නොවේ",
    tooShort: "නව මුරපදය අවම වශයෙන් අක්ෂර 12ක් විය යුතුය",
    tooLong: "නව මුරපදය අක්ෂර 128කට නොවැඩි විය යුතුය",
    samePassword: "නව මුරපදය වත්මන් මුරපදයෙන් වෙනස් විය යුතුය",
    mismatch: "නව මුරපද තහවුරු කිරීම නොගැළපේ",
    failed: "මුරපදය වෙනස් කළ නොහැකි විය",
    close: "වසන්න",
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
    transcriptionProvider: "හඬ හඳුනාගැනීමේ එන්ජිම",
    transcriptionOpenai: "OpenAI සජීවී පිටපත් කිරීම",
    transcriptionLocal: "දේශීය AI (Whisper)",
    notInstalled: "ස්ථාපනය කර නැත",
    localGlossaryUnsupported: "දේශීය AI පරිවර්තනයට පදකෝෂය යෙදෙන්නේ නැත",
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
    backToAdmin: "පරිපාලක පිටුවට ආපසු යන්න",
    close: "සැසිය අවසන් කරන්න",
    closedNotice: "සැසිය අවසන් වී ඇත",
    unsupportedEngine:
      "{engine} {languages} සඳහා සහය නොදක්වයි · විකල්ප එන්ජිම: {fallback}",
    pages: "පිටු URL — සහභාගිවන්නන්ට බෙදා දෙන්න",
    participantGuide: "සහභාගිවන්නන්ගේ මාර්ගෝපදේශය",
    inputGuide: "ඇතුළත් කරන්නන්ගේ මාර්ගෝපදේශය",
    input: "ඇතුළත් කිරීම",
    output: "පරිවර්තනය",
    capture: "හඬ ග්‍රහණය",
    combinedInput: "ඒකාබද්ධ ඇතුළත් කිරීම",
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
  settings: {
    heading: "මෙහෙයුම් සැකසුම්",
    preset: "පෙරසැකසුම",
    meetingPreset: "රැස්වීම",
    assemblyPreset: "මහජන රැස්වීම",
    applyPreset: "යොදන්න",
    languages: "භාෂා අනුව පිටු",
    addLanguage: "භාෂාවක් එක් කරන්න",
    selectLanguage: "භාෂාව තෝරන්න",
    input: "ඇතුළත් කිරීම",
    output: "පරිවර්තනය",
    nickname: "පෙන්වන නම භාවිත කරන්න",
    nicknameNote: "ඇතුළත් කරන්නා නමක් තෝරන අතර සියලු මූලාශ්‍ර, පරිවර්තන සහ ලොග්වල කථිකයා පෙන්වයි.",
    combinedInput: "ඒකාබද්ධ ඇතුළත් කිරීම භාවිත කරන්න",
    combinedInputNote: "එක් පිටුවක යතුරු ලියනයෙන් හෝ මයික්‍රෆෝනයෙන් භාෂා කිහිපයක් ස්වයංක්‍රීයව හඳුනා ගනී.",
    combinedInputFallback: "භාෂාව හඳුනාගත නොහැකි විට පෙරනිමි භාෂාව",
    transcriptionContext: "හඬ හඳුනාගැනීම සඳහා උපකාරක තොරතුරු",
    transcriptionContextNote: "AI හට වඩා නිවැරදිව පිටපත් කිරීමට, සැසියේ මාතෘකාව, පුද්ගල නම් සහ නිතර භාවිත වන පද ඇතුළත් කරන්න. ඊළඟ හඬ හඳුනාගැනීම ආරම්භයේ සිට යෙදේ.",
    transcriptionContextPlaceholder: "උදා: නව නිෂ්පාදන හඳුන්වාදීමේ සැසිය · නම්: Kim Min-su, Priya · නිතර භාවිත වන පද: LiveConfTranslation, SLA",
    contextSave: "උපකාරක තොරතුරු සුරකින්න",
    save: "සැකසුම් සුරකින්න",
    saving: "සුරකිමින්",
    saved: "සැකසුම් සුරැකිණි",
    saveFailed: "සැකසුම් සුරැකිය නොහැකි විය",
    locked: "පළමු පණිවිඩය යැවූ පසු සැකසුම් අගුළු දමා ඇත.",
    needLanguages: "අවම වශයෙන් භාෂා දෙකක් සක්‍රිය කරන්න",
    needInput: "අවම වශයෙන් එක් ඇතුළත් කිරීමේ පිටුවක් සක්‍රිය කරන්න",
    presetName: "පෙරසැකසුම් නම",
    savePreset: "නව පෙරසැකසුම සුරකින්න",
    updatePreset: "පෙරසැකසුම නැවත ලියන්න",
    deletePreset: "පෙරසැකසුම මකන්න",
    deletePresetConfirm: "මෙම පෙරසැකසුම මකන්නද?",
    presetSaved: "පෙරසැකසුම සුරැකිණි",
    presetFailed: "පෙරසැකසුම සැකසිය නොහැකි විය",
    presetLanguageMismatch: "තෝරාගත් සැසි භාෂා පෙරසැකසුම් භාෂා සමඟ නොගැළපේ",
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
  openaiUsage: {
    button: "භාවිතය බලන්න",
    title: "OpenAI භාවිතය",
    close: "වසන්න",
    description: "සංවිධාන Usage API මඟින් ආකෘති අනුව ටෝකන සහ ඇස්තමේන්තුගත පිරිවැය බලන්න.",
    adminKey: "OpenAI Admin API යතුර",
    configured: "ලියාපදිංචියි",
    notConfigured: "ලියාපදිංචිය අවශ්‍යයි",
    placeholder: "Admin API යතුර",
    replacePlaceholder: "නව Admin API යතුරකින් ප්‍රතිස්ථාපනය",
    save: "සුරකින්න",
    saving: "සුරකිමින්",
    remove: "මකන්න",
    saveFailed: "Admin API යතුර සුරැකිය නොහැකි විය",
    removeFailed: "Admin API යතුර මැකිය නොහැකි විය",
    keyRequired: "භාවිතය බැලීමට Admin API යතුරක් ලියාපදිංචි කරන්න.",
    keyInvalid: "Admin API යතුර වලංගු නොවේ.",
    permissionDenied: "මෙම යතුරට සංවිධාන භාවිතය බැලීමේ අවසර නැත.",
    rateLimited: "භාවිතය විමසීමේ සීමාව ඉක්මවා ඇත. පසුව නැවත උත්සාහ කරන්න.",
    loadFailed: "OpenAI භාවිතය පූරණය කළ නොහැකි විය.",
    period: "කාල පරාසය",
    daily: "දිනපතා · පසුගිය පැය 24",
    weekly: "සතිපතා · පසුගිය දින 7",
    loading: "භාවිතය පූරණය කරමින්",
    empty: "තෝරාගත් කාලයට භාවිතයක් නැත.",
    input: "ආදාන ටෝකන",
    cached: "හැඹිලි ආදානය",
    output: "ප්‍රතිදාන ටෝකන",
    requests: "ඉල්ලීම්",
    cost: "ඇස්තමේන්තුගත පිරිවැය",
    unknownCost: "ගණනය කළ නොහැක",
    organizationNote: "මෙය මෙම යෙදුමට පමණක් නොව Admin API යතුර අයත් මුළු OpenAI සංවිධානයේම භාවිතයයි.",
    pricingNote: "ඇස්තමේන්තුගත පිරිවැය 2026-08-25 දින තහවුරු කළ එක් එක් OpenAI ආකෘතියේ නිල Standard මිල අනුව ගණනය කෙරේ. batch, සේවා මට්ටම, දිගු සන්දර්භ හෝ මිල වෙනස්වීම් නිසා සැබෑ බිල වෙනස් විය හැක.",
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
  glossary: {
    button: "පද මාලාව",
    title: "පරිවර්තන පද මාලාව",
    add: "පදයක් එක් කරන්න",
    download: "CSV බාගන්න",
    upload: "CSV උඩුගත කරන්න",
    uploadReady: "CSV පූරණය කළා · යෙදීමට සුරකින්න ඔබන්න",
    uploadFailed: "CSV ගොනුව කියවිය නොහැක",
    source: "මුල් පදය",
    translation: "පරිවර්තන පදය",
    providerNote:
      "OpenAI සඳහා සැමවිටම යෙදේ. DeepL සහය දක්වන භාෂා යුගල සඳහා යෙදෙන අතර වත්මන් Google API යතුරු ක්‍රමය පද මාලා සඳහා සහය නොදක්වයි.",
    save: "සුරකින්න",
    saving: "සුරකිමින්",
    saveFailed: "පද මාලාව සුරැකිය නොහැකි විය",
    required: "ලියාපදිංචි සියලු භාෂා සඳහා පද ඇතුළත් කරන්න",
    remove: "පදය මකන්න",
    close: "වසන්න",
    empty: "ලියාපදිංචි පද නැත",
  },
};

/** 코드에 박혀 있는 관리자 화면 문구 */
export const BUILTIN_ADMIN = new Map<LanguageCode, AdminStrings>([
  ["ko", adminKo],
  ["vi", adminVi],
  ["th", adminTh],
  ["si", adminSi],
]);

export const FALLBACK_ADMIN: AdminStrings = adminKo;

/**
 * 중첩 객체를 점 경로 하나짜리 map 으로 편다.
 *
 * `{ list: { heading: "세션" } }` → `{ "list.heading": "세션" }`
 *
 * DB 는 행 단위로 저장하고 화면은 중첩 객체로 읽으므로 양방향 변환이 필요하다.
 * 값이 전부 문자열인 2단 구조만 다루면 되어 재귀가 단순하다.
 */
const stringGroupsSchema = z.record(z.string(), z.record(z.string(), z.string()));

export function flattenStrings(source: UiStrings | AdminStrings): Map<string, string> {
  const out = new Map<string, string>();
  for (const [group, entries] of Object.entries(stringGroupsSchema.parse(source))) {
    for (const [key, value] of Object.entries(entries)) out.set(`${group}.${key}`, value);
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
export function applyStrings<T extends UiStrings | AdminStrings>(
  base: T,
  overlay: ReadonlyMap<string, string>,
): T {
  const result = structuredClone(base);
  const groups = stringGroupsSchema.parse(result);
  for (const [group, entries] of Object.entries(groups)) {
    for (const [key, value] of Object.entries(entries)) {
      const replacement = overlay.get(`${group}.${key}`);
      entries[key] = replacement?.trim() ? replacement : value;
    }
  }
  Object.assign(result, groups);
  return result;
}

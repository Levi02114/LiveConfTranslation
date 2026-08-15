import type { LanguageCode } from "@/lib/languages";

/**
 * 입력·출력 페이지의 UI 문구.
 *
 * 참석자는 자기 언어 페이지만 본다. 거기에 한국어 "연결됨"이 떠 있으면 안 되므로
 * 화면에 나오는 모든 글자를 페이지 언어로 낸다.
 *
 * 관리자 화면은 여기를 쓰지 않는다 — 운영자 전용이라 한국어로 고정한다.
 *
 * ⚠️ 한국어 외 문구는 기계적으로 옮긴 초안이다. 실제 행사 전에 각 언어 사용자에게
 *    한 번 검수받는 것을 전제로 한다.
 */
export type UiStrings = {
  connection: { connected: string; reconnecting: string; disconnected: string };
  role: { input: string; output: string; combined: string };
  input: {
    placeholder: string;
    send: string;
    sending: string;
    hint: string;
  };
  status: {
    waiting: string;
    noContent: string;
    lastInput: string;
    lastOutput: string;
    failed: string;
  };
  meeting: { closed: string };
  appearance: {
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
  role: { input: "입력", output: "출력", combined: "통합 보기" },
  input: {
    placeholder: "회의 내용을 입력하세요",
    send: "보내기",
    sending: "보내는 중",
    hint: "Enter 로 전송 · Shift+Enter 로 줄바꿈",
  },
  status: {
    waiting: "번역을 기다리는 중",
    noContent: "아직 내용이 없습니다",
    lastInput: "마지막 입력",
    lastOutput: "마지막 번역",
    failed: "번역 실패",
  },
  meeting: { closed: "종료된 회의입니다" },
  appearance: {
    theme: "테마",
    light: "밝게",
    dark: "어둡게",
    textSize: "글자 크기",
    decrease: "작게",
    increase: "크게",
  },
  peers: { online: "명 접속 중", typing: "입력 중", you: "나" },
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
  role: { input: "Nhập liệu", output: "Bản dịch", combined: "Xem tổng hợp" },
  input: {
    placeholder: "Nhập nội dung cuộc họp",
    send: "Gửi",
    sending: "Đang gửi",
    hint: "Enter để gửi · Shift+Enter để xuống dòng",
  },
  status: {
    waiting: "Đang chờ bản dịch",
    noContent: "Chưa có nội dung",
    lastInput: "Lần nhập cuối",
    lastOutput: "Bản dịch cuối",
    failed: "Dịch thất bại",
  },
  meeting: { closed: "Cuộc họp đã kết thúc" },
  appearance: {
    theme: "Giao diện",
    light: "Sáng",
    dark: "Tối",
    textSize: "Cỡ chữ",
    decrease: "Nhỏ hơn",
    increase: "Lớn hơn",
  },
  peers: { online: "người đang kết nối", typing: "đang nhập", you: "Bạn" },
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
  role: { input: "ป้อนข้อมูล", output: "คำแปล", combined: "มุมมองรวม" },
  input: {
    placeholder: "พิมพ์เนื้อหาการประชุม",
    send: "ส่ง",
    sending: "กำลังส่ง",
    hint: "กด Enter เพื่อส่ง · Shift+Enter เพื่อขึ้นบรรทัดใหม่",
  },
  status: {
    waiting: "กำลังรอคำแปล",
    noContent: "ยังไม่มีเนื้อหา",
    lastInput: "ป้อนข้อมูลล่าสุด",
    lastOutput: "คำแปลล่าสุด",
    failed: "แปลไม่สำเร็จ",
  },
  meeting: { closed: "การประชุมสิ้นสุดแล้ว" },
  appearance: {
    theme: "ธีม",
    light: "สว่าง",
    dark: "มืด",
    textSize: "ขนาดตัวอักษร",
    decrease: "เล็กลง",
    increase: "ใหญ่ขึ้น",
  },
  peers: { online: "คนที่เชื่อมต่ออยู่", typing: "กำลังพิมพ์", you: "คุณ" },
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
  role: { input: "ඇතුළත් කිරීම", output: "පරිවර්තනය", combined: "ඒකාබද්ධ දසුන" },
  input: {
    placeholder: "රැස්වීමේ අන්තර්ගතය ටයිප් කරන්න",
    send: "යවන්න",
    sending: "යවමින්",
    hint: "යැවීමට Enter · නව පේළියකට Shift+Enter",
  },
  status: {
    waiting: "පරිවර්තනය එනතුරු",
    noContent: "තවම අන්තර්ගතයක් නැත",
    lastInput: "අවසන් ඇතුළත් කිරීම",
    lastOutput: "අවසන් පරිවර්තනය",
    failed: "පරිවර්තනය අසාර්ථකයි",
  },
  meeting: { closed: "රැස්වීම අවසන් වී ඇත" },
  appearance: {
    theme: "තේමාව",
    light: "ආලෝකමත්",
    dark: "අඳුරු",
    textSize: "අකුරු ප්‍රමාණය",
    decrease: "කුඩා",
    increase: "විශාල",
  },
  peers: { online: "දෙනෙකු සම්බන්ධව සිටී", typing: "ටයිප් කරමින්", you: "ඔබ" },
  error: {
    sendFailed: "යැවීමට නොහැකි විය",
    loadFailed: "පූරණය කිරීමට නොහැකි විය",
    notFound: "පිටුව හමු නොවීය",
  },
};

const DICTIONARIES: Record<LanguageCode, UiStrings> = { ko, vi, th, si };

export function getStrings(lang: LanguageCode): UiStrings {
  return DICTIONARIES[lang];
}

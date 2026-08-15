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
    newMessages: string;
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
    newMessages: "새 문장",
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
    newMessages: "Câu mới",
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
    newMessages: "ข้อความใหม่",
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
    newMessages: "නව වාක්‍ය",
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
    engineNoKey: string;
    create: string;
    creating: string;
    active: string;
    closed: string;
    noActive: string;
    noClosed: string;
    needTitle: string;
    needLanguages: string;
    createFailed: string;
  };
  keys: {
    button: string;
    title: string;
    close: string;
    note: string;
    none: string;
    registered: string;
    fromEnv: string;
    placeholder: string;
    replacePlaceholder: string;
    save: string;
    saving: string;
    remove: string;
    saveFailed: string;
    removeFailed: string;
  };
};

const adminKo: AdminStrings = {
  language: { label: "화면 언어" },
  login: {
    title: "관리자 로그인",
    password: "비밀번호",
    submit: "로그인",
    pending: "확인 중",
    wrongPassword: "비밀번호가 올바르지 않습니다",
    failed: "로그인에 실패했습니다",
  },
  list: {
    heading: "회의",
    logout: "로그아웃",
    titlePlaceholder: "회의 제목",
    languages: "언어",
    engine: "번역 엔진",
    engineNoKey: "키 없음",
    create: "회의 만들기",
    creating: "만드는 중",
    active: "진행 중",
    closed: "종료됨",
    noActive: "진행 중인 회의가 없습니다",
    noClosed: "종료된 회의가 없습니다",
    needTitle: "회의 제목을 입력해 주세요",
    needLanguages: "서로 다른 언어를 두 개 이상 골라 주세요",
    createFailed: "회의를 만들지 못했습니다",
  },
  keys: {
    button: "API 키 등록",
    title: "번역 엔진 API 키",
    close: "닫기",
    note: "키는 암호화해서 저장되며 화면으로 다시 꺼내 볼 수 없습니다. 등록한 키가 환경변수보다 우선합니다.",
    none: "없음",
    registered: "등록됨",
    fromEnv: "환경변수",
    placeholder: "API 키",
    replacePlaceholder: "새 키로 덮어쓰기",
    save: "저장",
    saving: "저장 중",
    remove: "삭제",
    saveFailed: "키를 저장하지 못했습니다",
    removeFailed: "키를 지우지 못했습니다",
  },
};

const adminVi: AdminStrings = {
  language: { label: "Ngôn ngữ hiển thị" },
  login: {
    title: "Đăng nhập quản trị",
    password: "Mật khẩu",
    submit: "Đăng nhập",
    pending: "Đang kiểm tra",
    wrongPassword: "Mật khẩu không đúng",
    failed: "Đăng nhập thất bại",
  },
  list: {
    heading: "Cuộc họp",
    logout: "Đăng xuất",
    titlePlaceholder: "Tên cuộc họp",
    languages: "Ngôn ngữ",
    engine: "Công cụ dịch",
    engineNoKey: "chưa có khóa",
    create: "Tạo cuộc họp",
    creating: "Đang tạo",
    active: "Đang diễn ra",
    closed: "Đã kết thúc",
    noActive: "Không có cuộc họp nào đang diễn ra",
    noClosed: "Không có cuộc họp nào đã kết thúc",
    needTitle: "Vui lòng nhập tên cuộc họp",
    needLanguages: "Hãy chọn ít nhất hai ngôn ngữ khác nhau",
    createFailed: "Không tạo được cuộc họp",
  },
  keys: {
    button: "Đăng ký khóa API",
    title: "Khóa API của công cụ dịch",
    close: "Đóng",
    note: "Khóa được mã hóa khi lưu và không thể xem lại trên màn hình. Khóa đã đăng ký được ưu tiên hơn biến môi trường.",
    none: "Chưa có",
    registered: "Đã đăng ký",
    fromEnv: "Biến môi trường",
    placeholder: "Khóa API",
    replacePlaceholder: "Ghi đè bằng khóa mới",
    save: "Lưu",
    saving: "Đang lưu",
    remove: "Xóa",
    saveFailed: "Không lưu được khóa",
    removeFailed: "Không xóa được khóa",
  },
};

const adminTh: AdminStrings = {
  language: { label: "ภาษาที่แสดง" },
  login: {
    title: "เข้าสู่ระบบผู้ดูแล",
    password: "รหัสผ่าน",
    submit: "เข้าสู่ระบบ",
    pending: "กำลังตรวจสอบ",
    wrongPassword: "รหัสผ่านไม่ถูกต้อง",
    failed: "เข้าสู่ระบบไม่สำเร็จ",
  },
  list: {
    heading: "การประชุม",
    logout: "ออกจากระบบ",
    titlePlaceholder: "ชื่อการประชุม",
    languages: "ภาษา",
    engine: "เครื่องมือแปล",
    engineNoKey: "ไม่มีคีย์",
    create: "สร้างการประชุม",
    creating: "กำลังสร้าง",
    active: "กำลังดำเนินการ",
    closed: "สิ้นสุดแล้ว",
    noActive: "ไม่มีการประชุมที่กำลังดำเนินการ",
    noClosed: "ไม่มีการประชุมที่สิ้นสุดแล้ว",
    needTitle: "กรุณากรอกชื่อการประชุม",
    needLanguages: "กรุณาเลือกภาษาที่ต่างกันอย่างน้อยสองภาษา",
    createFailed: "สร้างการประชุมไม่สำเร็จ",
  },
  keys: {
    button: "ลงทะเบียนคีย์ API",
    title: "คีย์ API ของเครื่องมือแปล",
    close: "ปิด",
    note: "คีย์จะถูกเข้ารหัสก่อนจัดเก็บและไม่สามารถเรียกดูได้อีก คีย์ที่ลงทะเบียนไว้จะถูกใช้ก่อนตัวแปรสภาพแวดล้อม",
    none: "ไม่มี",
    registered: "ลงทะเบียนแล้ว",
    fromEnv: "ตัวแปรสภาพแวดล้อม",
    placeholder: "คีย์ API",
    replacePlaceholder: "เขียนทับด้วยคีย์ใหม่",
    save: "บันทึก",
    saving: "กำลังบันทึก",
    remove: "ลบ",
    saveFailed: "บันทึกคีย์ไม่สำเร็จ",
    removeFailed: "ลบคีย์ไม่สำเร็จ",
  },
};

const adminSi: AdminStrings = {
  language: { label: "සංදර්ශන භාෂාව" },
  login: {
    title: "පරිපාලක පිවිසුම",
    password: "මුරපදය",
    submit: "පිවිසෙන්න",
    pending: "පරීක්ෂා කරමින්",
    wrongPassword: "මුරපදය වැරදියි",
    failed: "පිවිසීම අසාර්ථකයි",
  },
  list: {
    heading: "රැස්වීම්",
    logout: "පිටවන්න",
    titlePlaceholder: "රැස්වීමේ නම",
    languages: "භාෂා",
    engine: "පරිවර්තන එන්ජිම",
    engineNoKey: "යතුරක් නැත",
    create: "රැස්වීමක් සාදන්න",
    creating: "සාදමින්",
    active: "ක්‍රියාත්මකයි",
    closed: "අවසන්",
    noActive: "ක්‍රියාත්මක රැස්වීම් නැත",
    noClosed: "අවසන් වූ රැස්වීම් නැත",
    needTitle: "රැස්වීමේ නම ඇතුළත් කරන්න",
    needLanguages: "වෙනස් භාෂා දෙකක් හෝ වැඩි ගණනක් තෝරන්න",
    createFailed: "රැස්වීම සෑදිය නොහැකි විය",
  },
  keys: {
    button: "API යතුර ලියාපදිංචිය",
    title: "පරිවර්තන එන්ජිමේ API යතුර",
    close: "වසන්න",
    note: "යතුරු සංකේතනය කර ගබඩා කෙරේ; තිරයෙන් නැවත බැලිය නොහැක. ලියාපදිංචි යතුරට පරිසර විචල්‍යයට වඩා ප්‍රමුඛත්වය ලැබේ.",
    none: "නැත",
    registered: "ලියාපදිංචියි",
    fromEnv: "පරිසර විචල්‍යය",
    placeholder: "API යතුර",
    replacePlaceholder: "නව යතුරකින් ප්‍රතිස්ථාපනය",
    save: "සුරකින්න",
    saving: "සුරකිමින්",
    remove: "මකන්න",
    saveFailed: "යතුර සුරැකිය නොහැකි විය",
    removeFailed: "යතුර මැකිය නොහැකි විය",
  },
};

const ADMIN: Record<LanguageCode, AdminStrings> = {
  ko: adminKo,
  vi: adminVi,
  th: adminTh,
  si: adminSi,
};

export function getAdminStrings(lang: LanguageCode): AdminStrings {
  return ADMIN[lang];
}

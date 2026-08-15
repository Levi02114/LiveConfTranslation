import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 로컬 네트워크의 다른 기기(참석자 휴대폰 등)에서 개발 서버에 붙을 때
  // Next.js 의 교차 출처 경고를 피하려면 여기에 접속 주소를 추가한다.
  // allowedDevOrigins: ["192.168.0.10"],
};

export default nextConfig;

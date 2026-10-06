/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["fasttext.wasm"],
  headers() {
    return [{ source: "/admin/zoom/:path*", headers: [
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      // Next's existing inline hydration/theme scripts are retained on this scoped route.
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
    ] }];
  },
  // 로컬 네트워크의 다른 기기에서 개발 서버에 붙일 주소가 정해지면
  // allowedDevOrigins: ["192.168.0.10"],
};

export default nextConfig;

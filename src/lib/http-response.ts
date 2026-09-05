const MIN_COMPRESS_BYTES = 1024;

function acceptsGzip(value: string | null): boolean {
  return value?.split(",").some((entry) => {
    const [encoding, ...parameters] = entry.split(";").map((part) => part.trim().toLowerCase());
    if (encoding !== "gzip" && encoding !== "*") return false;
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  }) ?? false;
}

/** 직접 만든 HTML/JSON도 Next 페이지와 같이 gzip으로 전송한다. */
export function compressedTextResponse(
  request: Request,
  body: string,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  const bytes = new TextEncoder().encode(body);
  if (
    bytes.byteLength < MIN_COMPRESS_BYTES ||
    !acceptsGzip(request.headers.get("accept-encoding"))
  ) {
    return new Response(body, { ...init, headers });
  }

  headers.set("content-encoding", "gzip");
  headers.set("vary", "Accept-Encoding");
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    { ...init, headers },
  );
}

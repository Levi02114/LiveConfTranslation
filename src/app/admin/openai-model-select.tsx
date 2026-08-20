"use client";

/** OpenAI 번역은 검증된 단일 모델만 사용하므로 선택지가 아니라 고정값으로 보여 준다. */
export function OpenaiModelSelect({
  label,
  model,
  hidden,
}: {
  label: string;
  model: string;
  hidden: boolean;
}) {
  if (hidden) return null;

  return (
    <>
      <span className="font-mono text-[11px] text-muted">{label}</span>
      <output className="max-w-full border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px]">
        {model}
      </output>
    </>
  );
}

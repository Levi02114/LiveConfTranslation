import { z } from "zod";

export const sessionConfigSchema = z
  .object({
    languages: z
      .array(
        z.object({
          lang: z.string().trim().min(1).max(35),
          inputEnabled: z.boolean(),
          outputEnabled: z.boolean(),
        }),
      )
      .min(2),
    speakerLabels: z.boolean(),
    combinedInputFallbackLang: z.string().trim().min(1).max(35).nullable().default(null),
  })
  .superRefine((config, context) => {
    const codes = config.languages.map((row) => row.lang);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({ code: "custom", message: "언어가 중복되었습니다" });
    }
    if (config.languages.filter((row) => row.inputEnabled || row.outputEnabled).length < 2) {
      context.addIssue({ code: "custom", message: "활성 언어가 두 개 이상 필요합니다" });
    }
    if (!config.languages.some((row) => row.inputEnabled)) {
      context.addIssue({ code: "custom", message: "입력 언어가 하나 이상 필요합니다" });
    }
    if (
      config.combinedInputFallbackLang &&
      !config.languages.some(
        (row) => row.lang === config.combinedInputFallbackLang && row.inputEnabled,
      )
    ) {
      context.addIssue({ code: "custom", message: "통합 입력 기본 언어가 올바르지 않습니다" });
    }
  });

export const presetSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(80),
  config: sessionConfigSchema,
});

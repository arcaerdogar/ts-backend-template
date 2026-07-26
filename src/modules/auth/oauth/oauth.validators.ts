import { z } from "zod";

// start gövdesi: şu an ek parametre almıyor (successRedirect env'den sabittir,
// open-redirect'i engellemek için client'tan alınmaz). Şema zinciri tutarlılık
// ve ileri genişleme için burada.
export const oauthStartSchema = z.object({});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const oauthExchangeSchema = z.object({
  exchangeCode: z.string().min(1),
});

import { Injectable, inject } from '@angular/core';
import { AIError, GenerativeModel, GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import { aiConfig } from '../../environments/firebase.config';
import { RawExtraction } from '../core/receipt';
import { Backend } from './backend';
import { FirebaseBackend } from './firebase-backend';
import { ReadError, ReadRequest, ReceiptReader } from './receipt-reader';

/** JSON shape Gemini must return (structured output). */
const RESPONSE_SCHEMA = Schema.object({
  properties: {
    documentType: Schema.enumString({ enum: ['receipt', 'invoice', 'bill', 'payslip', 'bank_statement', 'other'] }),
    issuer: Schema.string({ description: 'Merchant, company or employer name' }),
    currency: Schema.string({ description: '3-letter ISO currency code of the document' }),
    transactions: Schema.array({
      items: Schema.object({
        properties: {
          direction: Schema.enumString({ enum: ['in', 'out'] }),
          amount: Schema.number(),
          currency: Schema.string(),
          date: Schema.string({ description: 'YYYY-MM-DD' }),
          description: Schema.string(),
          category: Schema.string(),
        },
        optionalProperties: ['currency', 'date', 'category'],
      }),
    }),
    payslip: Schema.object({
      properties: {
        employer: Schema.string(),
        payPeriod: Schema.string(),
        payDate: Schema.string({ description: 'YYYY-MM-DD' }),
        grossPay: Schema.number(),
        netPay: Schema.number(),
        deductions: Schema.array({ items: Schema.object({ properties: { name: Schema.string(), amount: Schema.number() } }) }),
      },
      optionalProperties: ['employer', 'payPeriod', 'payDate', 'grossPay', 'netPay', 'deductions'],
    }),
    warnings: Schema.array({ items: Schema.string() }),
  },
  optionalProperties: ['issuer', 'currency', 'payslip', 'warnings'],
});

/**
 * Reads receipts, invoices, payslips and statements with Gemini through Firebase AI Logic.
 * Uses the Gemini Developer API, which has a free tier on the Spark plan.
 */
@Injectable()
export class GeminiReader extends ReceiptReader {
  readonly label = 'Gemini (Google AI)';
  readonly privacyNote =
    "Files are sent to Google's Gemini AI to be read. On the free tier Google may use them to improve its products, and human reviewers may see them.";
  private readonly backend = inject(Backend) as FirebaseBackend;
  private models: GenerativeModel[] | null = null;
  /** Index of the first model that worked, so later files skip unavailable ones. */
  private working = 0;

  // AI Logic in this project rejects normal App Check tokens ("token is invalid") and accepts only
  // limited-use tokens (replay protection). Each request then fetches its own short-lived token.
  private getModels(): GenerativeModel[] {
    if (!this.models) {
      const ai = getAI(this.backend.app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
      this.models = aiConfig.models.map((model) =>
        getGenerativeModel(ai, { model, generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 } }, { timeout: 60_000 }),
      );
    }
    return this.models;
  }

  /** Tiny request used by the connection check in Setup. */
  async ping(): Promise<{ ok: boolean; detail: string }> {
    const ai = getAI(this.backend.app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
    const errors: string[] = [];
    for (const model of aiConfig.models) {
      const t0 = performance.now();
      try {
        const res = await withTimeout(getGenerativeModel(ai, { model }, { timeout: 30_000 }).generateContent('Reply with the single word OK.'), 35_000);
        return { ok: true, detail: `${model} answered "${res.response.text().trim().slice(0, 20)}" in ${Math.round(performance.now() - t0)} ms.` };
      } catch (e) {
        const d = details(e);
        errors.push(`${model}: ${e instanceof ReadError ? e.message : serverReason(d)}`);
        if (!isModelUnavailable(e)) break;
      }
    }
    return { ok: false, detail: errors.join(' | ').slice(0, 600) };
  }

  async read(req: ReadRequest): Promise<RawExtraction> {
    const models = this.getModels();
    let lastError: unknown = null;
    for (let i = this.working; i < models.length; i++) {
      try {
        // Hard stop so the screen never hangs on "Reading…" (e.g. while App Check can't get a token).
        const res = await withTimeout(
          models[i].generateContent([{ type: 'text', text: req.prompt }, { type: 'inlineData', inlineData: { mimeType: req.mime, data: req.data } }]),
          75_000,
        );
        this.working = i;
        const text = res.response.text();
        try {
          return JSON.parse(text) as RawExtraction;
        } catch {
          throw new ReadError("The AI's answer couldn't be read. Try again or enter it manually.", true);
        }
      } catch (e) {
        if (e instanceof ReadError) throw e;
        lastError = e;
        if (isModelUnavailable(e) && i < models.length - 1) continue; // try the next model
        break;
      }
    }
    throw toReadError(lastError);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ReadError('Reading took too long and was stopped. Check your connection and try again; if it keeps happening, the App Check setup may be incomplete (see README).', true)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function details(e: unknown): { code: string; status: number; message: string } {
  const err = e as AIError & { customErrorData?: { status?: number; statusText?: string } };
  return { code: String(err?.code ?? ''), status: Number(err?.customErrorData?.status ?? 0), message: String(err?.message ?? '') };
}

/** The server's own explanation, trimmed, so a failure can be diagnosed from a screenshot. */
function serverReason(d: { status: number; message: string }): string {
  const m = d.message.replace(/^.*?\]\s*/, '').replace(/\s*\[\{.*$/, '').replace(/https?:\/\/\S+/g, '').trim();
  return `HTTP ${d.status || 'n/a'}${m ? ': ' + m.slice(0, 160) : ''}`;
}

function isModelUnavailable(e: unknown): boolean {
  const d = details(e);
  return d.status === 404 || ((d.status === 400 || d.status === 403) && /model/i.test(d.message) && /not (found|supported|available)|no longer|deprecated|access/i.test(d.message));
}

function toReadError(e: unknown): ReadError {
  console.error('Receipt scan failed', e);
  const d = details(e);
  const why = ` (${serverReason(d)})`;
  if (d.code === 'api-not-enabled' || /has not been used|is disabled|SERVICE_DISABLED/i.test(d.message))
    return new ReadError('Receipt scanning is not switched on yet. In the Firebase console open AI Services → AI Logic → Get started → Gemini Developer API, wait a few minutes, then try again.' + why);
  if (d.status === 429 || /quota|RESOURCE_EXHAUSTED|rate limit/i.test(d.message))
    return new ReadError('The free AI limit is used up for now. Wait a minute (or until tomorrow for the daily limit) and try again, or enter it manually.' + why, true);
  if (isModelUnavailable(e))
    return new ReadError('None of the AI models in the app config are available to this project. Update aiConfig.models in firebase.config.ts.' + why);
  if (/app.?check/i.test(d.message))
    return new ReadError('The AI service rejected this app (App Check). Check the App Check setup in the README.' + why);
  if (d.status === 403 && /api key|referer|referrer|blocked|PERMISSION_DENIED/i.test(d.message))
    return new ReadError("The project's API key isn't allowed to use the AI service. In Google Cloud Console → Credentials, allow the Firebase AI Logic API for this key." + why);
  if (d.status === 400 && /size|too large|payload/i.test(d.message))
    return new ReadError('That file is too large to read. Try a smaller photo or a single-page PDF.' + why);
  if (/safety|blocked/i.test(d.message)) return new ReadError('The AI declined to read this file. Enter it manually.' + why);
  if (!d.status && /Failed to fetch|NetworkError|Load failed|network/i.test(d.message))
    return new ReadError("Couldn't reach the AI service. Check your connection and try again." + why, true);
  return new ReadError("Couldn't read this file. Try again, use a clearer photo, or enter it manually." + why, true);
}

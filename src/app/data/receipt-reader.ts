import { RawExtraction } from '../core/receipt';

export interface ReadRequest {
  /** base64 without data: prefix */
  data: string;
  mime: string;
  prompt: string;
}

/** Friendly, actionable failure from a reader. */
export class ReadError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

/** Reads one document and returns structured data. Implementations: GeminiReader, DemoReader. */
export abstract class ReceiptReader {
  abstract readonly label: string;
  /** Shown before upload so people know where their files go. */
  abstract readonly privacyNote: string;
  abstract read(req: ReadRequest): Promise<RawExtraction>;
}

/** Used in demo mode (no Firebase project): returns clearly-labelled sample values so the flow can be tried. */
export class DemoReader extends ReceiptReader {
  readonly label = 'Demo reader (sample values)';
  readonly privacyNote = 'Demo mode: files stay in this browser and sample values are filled in so you can try the review screen.';
  async read(req: ReadRequest): Promise<RawExtraction> {
    await new Promise((r) => setTimeout(r, 400));
    const today = new Date().toISOString().slice(0, 10);
    if (/pdf/.test(req.mime)) {
      return {
        documentType: 'payslip', currency: 'MYR', issuer: 'Sample Employer Sdn Bhd', transactions: [],
        payslip: { employer: 'Sample Employer Sdn Bhd', payPeriod: 'this month', payDate: today, grossPay: 9800, netPay: 8150.6, deductions: [{ name: 'EPF', amount: 1078 }, { name: 'PCB', amount: 524.4 }, { name: 'SOCSO', amount: 47 }] },
        warnings: ['Demo mode: these are sample values, not read from your file.'],
      };
    }
    return {
      documentType: 'receipt', currency: 'MYR', issuer: 'Sample Mart',
      transactions: [{ direction: 'out', amount: 64.9, date: today, description: 'Sample Mart groceries', category: 'Groceries' }],
      warnings: ['Demo mode: these are sample values, not read from your file.'],
    };
  }
}

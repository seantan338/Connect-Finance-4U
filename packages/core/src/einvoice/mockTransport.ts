/**
 * Mock MyInvois transport —— 没配 sandbox 凭据时用,模拟 LHDN 返回假 UUID + Valid。
 * 确定性(不用 Date/random),方便测试。真 sandbox 接上后自动换 httpTransport。
 */
import { sha256Hex } from './hash.js';
import type { MyInvoisTransport, StatusResult, SubmitDocument, SubmitResult } from './types.js';

export class MockMyInvoisTransport implements MyInvoisTransport {
  readonly name = 'mock';

  async submit(docs: SubmitDocument[]): Promise<SubmitResult> {
    const accepted = docs.map((d) => ({
      uuid: 'MOCK-' + sha256Hex(d.codeNumber).slice(0, 24).toUpperCase(),
      invoiceCodeNumber: d.codeNumber,
      longId: 'LID-' + sha256Hex(d.document).slice(0, 16).toUpperCase(),
    }));
    return {
      submissionUid: 'SUB-' + sha256Hex(docs.map((d) => d.codeNumber).join(',')).slice(0, 16).toUpperCase(),
      accepted,
      rejected: [],
    };
  }

  async getStatus(uuid: string): Promise<StatusResult> {
    return {
      uuid,
      status: 'Valid',
      longId: 'LID-' + uuid.slice(5, 21),
      validation: { status: 'Valid', validationSteps: [] },
    };
  }
}

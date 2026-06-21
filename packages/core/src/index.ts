// @cf4u/core — accounting domain logic.
//
// M1.1 · Step 4 将在此实现(测试优先),目前为 scaffold:
//   - createJournalEntry(lines[])  校验 Σdebit=Σcredit,不平则拒绝
//   - postEntry(id)                draft → posted,触发 DB trigger
//   - getTrialBalance(orgId, periodId)  汇总 debit/credit,断言总额相等
//
// 不在 Step 1 实现(不往下冲)。

export {};

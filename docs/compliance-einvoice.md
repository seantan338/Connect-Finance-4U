# Compliance Spec — MyInvois e-Invoice (LHDN)

> Phase 0 deliverable(Roadmap 里一直 ☐)。M1.3 的地基。
> 来源:LHDN MyInvois SDK v1.1 + 开源 TS 实现。**标 ⚠️ 的是要 Sean 拍板/补的缺口。**
> 铁律 4:e-Invoice 原生内置,落点是 `einvoice_submissions`(payload 55 字段 JSONB / uuid / status / validation / 签名)。

## 1. 范围(M1.3)
- 文档类型:Invoice(`01`)、Credit Note(`02`)、Debit Note(`03`)、Self-billed(`11/12/13`)——对应 `invoices.doc_type` + `direction`。
- 渠道:MyInvois **API 直连**(`channel='api'`)。Peppol(`channel='peppol'`)留 Phase 2。
- 目标:issued 发票 → 构造 MyInvois 文档 → 签名 → 提交 sandbox → 拿 **UUID + Valid**。

## 2. 提交流程(状态机)
```
invoice.status='issued'
   └─ build MyInvois document (本 spec 的字段映射)
        └─ sign (XAdES/JAdES,需 LHDN 数字证书)        ⚠️ 证书 Sean 申请
             └─ base64 + SHA256 → POST /api/v1.0/documentsubmissions
                  ├─ accepted → einvoice_submissions(status=pending, uuid, submission_uid)
                  │     └─ poll GET /api/v1.0/documents/{uuid}/details
                  │          ├─ Valid   → status=valid,   存 qr_url(validation link)
                  │          └─ Invalid → status=invalid, 存 validation 结果
                  └─ rejected → status=rejected, 存原因
```
- 认证:`POST {identity}/connect/token`,`grant_type=client_credentials`,`scope=InvoicingAPI`。
- Base URL:SANDBOX `https://preprod-api.myinvois.hasil.gov.my`,PROD `https://api.myinvois.hasil.gov.my`。
- QR / 验证链接:`{portal}/{uuid}/share/{longId}`。

## 3. 字段映射(我们 schema → MyInvois v1.1)

### Supplier(开票方 = 我们 org)
| MyInvois | 来源 | 备注 |
|---|---|---|
| TIN | `organizations.tin` | 必填 |
| Registration No + scheme | `organizations.brn` (scheme=BRN) | 必填 |
| SST Registration | `organizations.sst_no` | 有则填,否则 'NA' |
| Legal Name | `organizations.legal_name` | 必填 |
| MSIC code + 业务描述 | ⚠️ **schema 没有** | MyInvois 必填(5 位 MSIC)→ 见缺口 G1 |
| Address(行/城市/邮编/州/国) | ⚠️ **org 无 address** | 必填 → 缺口 G1 |
| Contact phone / email | ⚠️ **org 无** | phone 必填 → 缺口 G1 |

### Buyer(对手方 = contact)
| MyInvois | 来源 | 备注 |
|---|---|---|
| TIN | `contacts.tin` | 必填(B2B);B2C 用通用 TIN `EI00000000010` ⚠️ G2 |
| Registration No | `contacts.brn` | |
| SST No | `contacts.sst_no` | |
| Name | `contacts.name` | 必填 |
| Address | `contacts.address` (JSONB) | ⚠️ 结构未定 → G3 |
| Email | `contacts.email` | |

### 发票头
| MyInvois | 来源 |
|---|---|
| InvoiceTypeCode + listVersionID='1.1' | `invoices.doc_type`+`direction` → 01/02/03/11.. |
| Invoice number (codeNumber) | `invoices.invoice_no` |
| IssueDate / IssueTime (UTC) | `invoices.issue_date`(time 用提交时刻 UTC) |
| DocumentCurrencyCode | `invoices.currency` |
| 汇率 | `journal_lines.fx_rate`(非 MYR 时)|

### 行(invoice_lines)
| MyInvois | 来源 | 备注 |
|---|---|---|
| Classification code + listID | `invoice_lines.classification` | ⚠️ 必填,目前建发票没填 → G4 |
| Description | `invoice_lines.description` | |
| Quantity / Unit (unitCode) | `invoice_lines.qty` / ⚠️ 无 UOM → 默认 `C62` G5 |
| Unit Price / LineExtensionAmount | `invoice_lines.unit_price` / `line_total` | |
| Tax category code + percent + amount | `tax_codes` | ⚠️ 类别码缺 → G6 |

### 税 & 合计
- TaxTotal / TaxSubtotal:taxableAmount=`invoices.subtotal`,taxAmount=`invoices.tax_total`,category+percent。
- LegalMonetaryTotal:lineExtensionAmount=subtotal,taxExclusiveAmount=subtotal,taxInclusiveAmount=grand_total,payableAmount=grand_total。

## 4. ⚠️ 缺口 / 待 Sean 拍板
- **G1 Supplier profile**:org 缺 address / MSIC / phone(MyInvois 必填)。
  → 方案:给 org 加这些字段(改 schema.sql + migration),或先用「supplier profile 配置」注入。**M1.3 先用配置注入,不阻塞;要不要进 schema 你定。**
- **G2 B2C buyer**:个人买家无 TIN → 用 LHDN 通用 TIN + NRIC。要不要支持 B2C?
- **G3 contact.address 结构**:定一个 JSON 形状(lines[]/city/postcode/state/country)。
- **G4 line classification**:MyInvois 每行必填分类码。建发票表单要加这个字段(UI 跟进)。
- **G5 UOM**:行无计量单位,默认 `C62`(unit)。要不要支持 UOM?
- **G6 tax 类别码**:`tax_codes` 只有 rate,没有 MyInvois 税类(01 Sales / 02 Service / 06 NA / E Exempt)。SST-6 到底算 Service Tax(02)还是 Sales Tax(01)?→ 建议给 `tax_codes` 加一列 `myinvois_category`。**M1.3 先按 rate>0→'01'、rate==0→'06' 兜底并告警。**
- **G7 数字证书**:提交须 XAdES/JAdES 签名,要 LHDN 认可的数字证书(Sean 申请,`action-items` 第 1 条)。没证书 sandbox 也只能到「提交」拿不到 Valid。

## 5. 配置(env,沿用双连接串风格)
```
MYINVOIS_ENV=sandbox|prod        # 不设 = mock(本地演示)
MYINVOIS_CLIENT_ID=...
MYINVOIS_CLIENT_SECRET=...
MYINVOIS_SUPPLIER_MSIC=62010     # G1 临时配置
# 数字证书路径/密钥 G7 待定
```
**没配 = 自动用 mock transport**(返回假 UUID + valid),前端照样能演示整条流程;配上凭据自动切真 sandbox。

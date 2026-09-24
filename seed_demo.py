"""
DocVault Demo Data Seeder
Seeds realistic demo documents into DynamoDB for the actual authenticated demo user.
Run: python seed_demo.py
"""
import boto3
import json
from decimal import Decimal
from datetime import datetime, timezone

# ─── Configuration ─────────────────────────────────────────────────────────────

REGION = "us-east-1"
DOCUMENTS_TABLE = "docvault-documents-dev"
AUDIT_TABLE = "docvault-audit-dev"

# The sub (userId) for demo@docvault.app — from Cognito JWT
DEMO_USER_ID = "14788418-1031-7020-1a43-f3d91454a8fb"


# ─── Demo Documents ────────────────────────────────────────────────────────────

DEMO_DOCS = [
    # 1. Laptop Invoice
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-laptop-2026-001",
        "status": "READY",
        "originalFilename": "dell_xps15_invoice.pdf",
        "filename": "dell_xps15_invoice.pdf",
        "contentType": "application/pdf",
        "mimeType": "application/pdf",
        "fileSize": 245760,
        "documentType": "RECEIPT",
        "category": "PURCHASE",
        "title": "Dell XPS 15 — Croma Electronics",
        "summary": "Purchase receipt for Dell XPS 15 9530 laptop from Croma Electronics. Total INR 1,34,990 with 2-year manufacturer warranty and 14-day return window.",
        "merchant": "Croma Electronics",
        "purchaseDate": "2026-07-15",
        "productName": "Dell XPS 15 9530",
        "amount": Decimal("134990"),
        "currency": "INR",
        "invoiceNumber": "CRM-2026-089432",
        "serialNumber": "DXP1593KL204891",
        "warrantyPeriod": "2 years",
        "warrantyStartDate": "2026-07-15",
        "warrantyEndDate": "2028-07-15",
        "returnPeriod": "14 days",
        "returnDeadline": "2026-07-29",
        "paymentMethod": "DEBIT_CARD",
        "keywords": ["laptop", "dell", "xps", "croma", "electronics", "purchase"],
        "s3Key": "uploads/demo/demo-laptop-2026-001.pdf",
        "createdAt": "2026-07-15T10:30:00+00:00",
        "updatedAt": "2026-07-15T10:31:00+00:00",
        "processedAt": "2026-07-15T10:32:00+00:00",
    },
    # 2. iPhone Receipt
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-phone-2026-001",
        "status": "READY",
        "originalFilename": "iphone15pro_receipt.jpg",
        "filename": "iphone15pro_receipt.jpg",
        "contentType": "image/jpeg",
        "mimeType": "image/jpeg",
        "fileSize": 1843200,
        "documentType": "RECEIPT",
        "category": "PURCHASE",
        "title": "iPhone 15 Pro Max — Apple Store",
        "summary": "Purchase receipt for iPhone 15 Pro Max 256GB from Apple Store Bangalore. Amount INR 1,59,900 with 1-year Apple warranty.",
        "merchant": "Apple Store Bangalore",
        "purchaseDate": "2026-06-20",
        "productName": "iPhone 15 Pro Max 256GB",
        "amount": Decimal("159900"),
        "currency": "INR",
        "invoiceNumber": "APL-BLR-2026-043211",
        "serialNumber": "C3TXN7RQPL1M",
        "warrantyPeriod": "1 year",
        "warrantyStartDate": "2026-06-20",
        "warrantyEndDate": "2027-06-20",
        "returnPeriod": "15 days",
        "returnDeadline": "2026-07-05",
        "paymentMethod": "UPI",
        "keywords": ["iphone", "apple", "smartphone", "mobile", "purchase"],
        "s3Key": "uploads/demo/demo-phone-2026-001.jpg",
        "createdAt": "2026-06-20T14:20:00+00:00",
        "updatedAt": "2026-06-20T14:21:00+00:00",
        "processedAt": "2026-06-20T14:22:00+00:00",
    },
    # 3. Sony Headphones
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-headphones-2026-001",
        "status": "READY",
        "originalFilename": "sony_wh1000xm5_receipt.jpg",
        "filename": "sony_wh1000xm5_receipt.jpg",
        "contentType": "image/jpeg",
        "mimeType": "image/jpeg",
        "fileSize": 892416,
        "documentType": "RECEIPT",
        "category": "PURCHASE",
        "title": "Sony WH-1000XM5 — Amazon India",
        "summary": "Purchase receipt for Sony WH-1000XM5 noise-cancelling headphones from Amazon India. INR 29,990 with 1-year warranty.",
        "merchant": "Amazon India",
        "purchaseDate": "2026-08-01",
        "productName": "Sony WH-1000XM5 Headphones",
        "amount": Decimal("29990"),
        "currency": "INR",
        "invoiceNumber": "AMZ-IN-2026-83729841",
        "serialNumber": "SN-WH1000XM5-7834KL",
        "warrantyPeriod": "1 year",
        "warrantyStartDate": "2026-08-01",
        "warrantyEndDate": "2027-08-01",
        "returnPeriod": "10 days",
        "returnDeadline": "2026-08-11",
        "paymentMethod": "UPI",
        "keywords": ["sony", "headphones", "amazon", "electronics", "audio"],
        "s3Key": "uploads/demo/demo-headphones-2026-001.jpg",
        "createdAt": "2026-08-01T09:15:00+00:00",
        "updatedAt": "2026-08-01T09:16:00+00:00",
        "processedAt": "2026-08-01T09:17:00+00:00",
    },
    # 4. Health Insurance Policy
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-insurance-2026-001",
        "status": "READY",
        "originalFilename": "health_insurance_star_health.pdf",
        "filename": "health_insurance_star_health.pdf",
        "contentType": "application/pdf",
        "mimeType": "application/pdf",
        "fileSize": 512000,
        "documentType": "INSURANCE",
        "category": "INSURANCE",
        "title": "Health Insurance Policy — Star Health",
        "summary": "Comprehensive individual health insurance policy from Star Health Insurance. Coverage INR 5,00,000 for hospitalization, surgeries, and day care procedures. Valid April 2026 to March 2027.",
        "issuer": "Star Health and Allied Insurance",
        "documentNumber": "P/191117/01/2026/000234",
        "issueDate": "2026-04-01",
        "expiryDate": "2027-03-31",
        "personName": "Demo User",
        "organization": "Star Health and Allied Insurance",
        "importantDates": ["2026-04-01 - Policy start", "2027-03-31 - Policy renewal"],
        "importantAmounts": ["500000 INR - Sum insured"],
        "keywords": ["health insurance", "mediclaim", "star health", "coverage", "hospitalization", "policy"],
        "entities": ["Star Health and Allied Insurance"],
        "s3Key": "uploads/demo/demo-insurance-2026-001.pdf",
        "createdAt": "2026-04-01T08:00:00+00:00",
        "updatedAt": "2026-04-01T08:01:00+00:00",
        "processedAt": "2026-04-01T08:02:00+00:00",
    },
    # 5. B.Tech Degree Certificate
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-degree-2025-001",
        "status": "READY",
        "originalFilename": "btech_degree_certificate_vtu.pdf",
        "filename": "btech_degree_certificate_vtu.pdf",
        "contentType": "application/pdf",
        "mimeType": "application/pdf",
        "fileSize": 1024000,
        "documentType": "EDUCATION",
        "category": "EDUCATION",
        "title": "B.Tech Degree Certificate — VTU",
        "summary": "Bachelor of Technology degree in Computer Science Engineering from AMC Engineering College, affiliated to Visvesvaraya Technological University (VTU), Bangalore. Graduated June 2025.",
        "issuer": "Visvesvaraya Technological University (VTU)",
        "documentNumber": "VTU/CS/2025/04839",
        "issueDate": "2025-06-15",
        "personName": "Demo User",
        "organization": "AMC Engineering College",
        "keywords": ["degree", "btech", "computer science", "engineering", "VTU", "graduation", "education"],
        "entities": ["AMC Engineering College", "VTU", "Bangalore"],
        "s3Key": "uploads/demo/demo-degree-2025-001.pdf",
        "createdAt": "2026-01-10T11:00:00+00:00",
        "updatedAt": "2026-01-10T11:01:00+00:00",
        "processedAt": "2026-01-10T11:02:00+00:00",
    },
    # 6. PAN Card
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-pan-001",
        "status": "READY",
        "originalFilename": "pan_card_scan.jpg",
        "filename": "pan_card_scan.jpg",
        "contentType": "image/jpeg",
        "mimeType": "image/jpeg",
        "fileSize": 204800,
        "documentType": "IDENTITY",
        "category": "IDENTITY",
        "title": "PAN Card",
        "summary": "Permanent Account Number (PAN) card issued by Income Tax Department of India. Valid government-issued photo identity document for financial transactions.",
        "issuer": "Income Tax Department, Government of India",
        "documentNumber": "ABCDE1234F",
        "personName": "Demo User",
        "keywords": ["PAN", "identity", "tax", "income tax", "government ID", "photo ID"],
        "entities": ["Income Tax Department"],
        "s3Key": "uploads/demo/demo-pan-001.jpg",
        "createdAt": "2026-01-05T09:00:00+00:00",
        "updatedAt": "2026-01-05T09:01:00+00:00",
        "processedAt": "2026-01-05T09:02:00+00:00",
    },
    # 7. College Fee Receipt
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-college-fee-2024-001",
        "status": "READY",
        "originalFilename": "college_fee_receipt_ay2024.pdf",
        "filename": "college_fee_receipt_ay2024.pdf",
        "contentType": "application/pdf",
        "mimeType": "application/pdf",
        "fileSize": 307200,
        "documentType": "RECEIPT",
        "category": "EDUCATION",
        "title": "College Tuition Fee Receipt AY 2024-25 — AMC",
        "summary": "Annual tuition fee payment receipt for academic year 2024-25 from AMC Engineering College, Bangalore. Amount INR 85,000 paid via NEFT bank transfer.",
        "merchant": "AMC Engineering College",
        "purchaseDate": "2024-07-20",
        "productName": "Tuition Fee AY 2024-25",
        "amount": Decimal("85000"),
        "currency": "INR",
        "invoiceNumber": "AMC/FEE/2024/03892",
        "paymentMethod": "NEFT",
        "keywords": ["college fee", "tuition", "education", "AMC", "academic fee"],
        "s3Key": "uploads/demo/demo-college-fee-2024-001.pdf",
        "createdAt": "2024-07-20T10:00:00+00:00",
        "updatedAt": "2024-07-20T10:01:00+00:00",
        "processedAt": "2024-07-20T10:02:00+00:00",
    },
    # 8. Internship Offer Letter
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-offer-letter-2026-001",
        "status": "READY",
        "originalFilename": "internship_offer_techcorp.pdf",
        "filename": "internship_offer_techcorp.pdf",
        "contentType": "application/pdf",
        "mimeType": "application/pdf",
        "fileSize": 409600,
        "documentType": "EMPLOYMENT",
        "category": "EMPLOYMENT",
        "title": "Internship Offer Letter — TechCorp India",
        "summary": "Software Engineering internship offer letter from TechCorp India Pvt Ltd for 6-month internship from October 2026 to March 2027. Monthly stipend INR 25,000.",
        "issuer": "TechCorp India Pvt Ltd",
        "documentNumber": "TC/HR/2026/INT/0892",
        "issueDate": "2026-09-01",
        "personName": "Demo User",
        "organization": "TechCorp India Pvt Ltd",
        "importantDates": ["2026-10-01 - Joining date", "2027-03-31 - End date"],
        "importantAmounts": ["25000 INR per month - Stipend"],
        "keywords": ["internship", "offer letter", "employment", "software engineering", "TechCorp"],
        "entities": ["TechCorp India Pvt Ltd"],
        "s3Key": "uploads/demo/demo-offer-letter-2026-001.pdf",
        "createdAt": "2026-09-01T15:00:00+00:00",
        "updatedAt": "2026-09-01T15:01:00+00:00",
        "processedAt": "2026-09-01T15:02:00+00:00",
    },
    # 9. Bank Statement
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-bank-stmt-2026-001",
        "status": "READY",
        "originalFilename": "sbi_bank_statement_aug2026.pdf",
        "filename": "sbi_bank_statement_aug2026.pdf",
        "contentType": "application/pdf",
        "mimeType": "application/pdf",
        "fileSize": 204800,
        "documentType": "FINANCIAL",
        "category": "FINANCIAL",
        "title": "SBI Bank Statement — August 2026",
        "summary": "SBI Savings Account statement for August 2026. Shows salary credits, UPI transactions, and utility payments. Account maintained at Bangalore branch.",
        "issuer": "State Bank of India",
        "documentNumber": "XXXXXXX8901",
        "issueDate": "2026-09-01",
        "personName": "Demo User",
        "organization": "State Bank of India",
        "importantAmounts": ["45000 INR - Salary credit"],
        "keywords": ["bank statement", "SBI", "savings account", "transactions", "financial"],
        "entities": ["State Bank of India", "Bangalore"],
        "s3Key": "uploads/demo/demo-bank-stmt-2026-001.pdf",
        "createdAt": "2026-09-05T10:00:00+00:00",
        "updatedAt": "2026-09-05T10:01:00+00:00",
        "processedAt": "2026-09-05T10:02:00+00:00",
    },
    # 10. Aadhaar Card placeholder
    {
        "userId": DEMO_USER_ID,
        "documentId": "demo-aadhaar-001",
        "status": "READY",
        "originalFilename": "aadhaar_masked.jpg",
        "filename": "aadhaar_masked.jpg",
        "contentType": "image/jpeg",
        "mimeType": "image/jpeg",
        "fileSize": 256000,
        "documentType": "IDENTITY",
        "category": "IDENTITY",
        "title": "Aadhaar Card (Masked)",
        "summary": "Masked Aadhaar Card — a 12-digit unique identity number issued by UIDAI. Used as proof of identity and address for various official purposes.",
        "issuer": "Unique Identification Authority of India (UIDAI)",
        "documentNumber": "XXXX XXXX 4567",
        "personName": "Demo User",
        "keywords": ["aadhaar", "UIDAI", "identity", "biometric", "government ID", "address proof"],
        "entities": ["UIDAI"],
        "s3Key": "uploads/demo/demo-aadhaar-001.jpg",
        "createdAt": "2026-01-08T09:00:00+00:00",
        "updatedAt": "2026-01-08T09:01:00+00:00",
        "processedAt": "2026-01-08T09:02:00+00:00",
    },
]


def seed():
    dynamo = boto3.resource("dynamodb", region_name=REGION)
    docs_table = dynamo.Table(DOCUMENTS_TABLE)
    audit_table = dynamo.Table(AUDIT_TABLE)

    print(f"\n🌱 Seeding DocVault demo data")
    print(f"   User: {DEMO_USER_ID}")
    print(f"   Table: {DOCUMENTS_TABLE}")
    print(f"   Documents: {len(DEMO_DOCS)}\n")

    seeded = 0
    for doc in DEMO_DOCS:
        try:
            docs_table.put_item(Item=doc)
            seeded += 1
            print(f"  ✓ {doc['title']}")
        except Exception as e:
            print(f"  ✗ {doc.get('title', doc['documentId'])}: {e}")

    # Seed a few audit events
    import uuid
    ts = datetime.now(timezone.utc).isoformat()
    audit_events = [
        {"userId": DEMO_USER_ID, "timestampEventId": f"{ts}#audit-1", "eventType": "DOCUMENT_UPLOADED", "details": {"documentId": "demo-laptop-2026-001"}, "createdAt": ts},
        {"userId": DEMO_USER_ID, "timestampEventId": f"{ts}#audit-2", "eventType": "DOCUMENT_PROCESSED", "details": {"documentId": "demo-laptop-2026-001", "type": "RECEIPT"}, "createdAt": ts},
    ]
    for ev in audit_events:
        try:
            audit_table.put_item(Item=ev)
        except Exception:
            pass

    print(f"\n✅ Seeded {seeded}/{len(DEMO_DOCS)} documents")
    print(f"   Demo user email: demo@docvault.app")
    print(f"   Demo user password: DocVault2026!")
    return seeded


if __name__ == "__main__":
    seed()

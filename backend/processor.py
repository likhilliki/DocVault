"""
DocVault Document Processor Lambda — v2
S3-triggered async processor.
Uses Amazon Nova Pro (cross-region inference profile) for multimodal document analysis.
"""

import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

# ─── Logging ─────────────────────────────────────────────────────────────────

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def log(event_type, document_id=None, user_id=None, status=None, **extra):
    record = {
        "eventType": event_type,
        "documentId": document_id,
        "userId": user_id,
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    record.update(extra)
    logger.info(json.dumps(record, default=str))


# ─── AWS Clients ─────────────────────────────────────────────────────────────

_dynamodb = None
_s3 = None
_bedrock = None


def get_dynamodb():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb


def get_s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def get_bedrock():
    global _bedrock
    if _bedrock is None:
        region = os.environ.get("AWS_REGION", "us-east-1")
        _bedrock = boto3.client("bedrock-runtime", region_name=region)
    return _bedrock


# ─── Environment ─────────────────────────────────────────────────────────────

DOCUMENTS_TABLE = os.environ["DOCUMENTS_TABLE"]
BUCKET_NAME = os.environ["BUCKET_NAME"]
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")

# ─── Constants ───────────────────────────────────────────────────────────────

# Nova Pro supports these image types
NOVA_IMAGE_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}

VALID_DOCUMENT_TYPES = {
    "RECEIPT", "INSURANCE", "IDENTITY", "EDUCATION", "EMPLOYMENT",
    "FINANCIAL", "WARRANTY", "MEDICAL_DOCUMENT", "LEGAL", "TRAVEL",
    "TAX", "OTHER",
}

VALID_PAYMENT_METHODS = {
    "CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI", "NET_BANKING",
    "WALLET", "CHEQUE", "NEFT", "RTGS", "OTHER", "UNKNOWN",
}

DATE_FIELDS = {
    "issueDate", "expiryDate", "purchaseDate", "warrantyEndDate",
    "returnDeadline", "warrantyStartDate",
}

# ─── Analysis Prompts ─────────────────────────────────────────────────────────

ANALYSIS_PROMPT = """You are an expert document analysis AI for DocVault, a personal document vault.

Analyze the provided document and extract structured information.

Return ONLY a valid JSON object (no markdown, no code fences, no explanation) with these fields:

Required fields:
- documentType: one of RECEIPT, INSURANCE, IDENTITY, EDUCATION, EMPLOYMENT, FINANCIAL, WARRANTY, MEDICAL_DOCUMENT, LEGAL, TRAVEL, TAX, OTHER
- title: descriptive title for the document
- summary: 2-3 sentence summary
- issuer: organization/entity that issued this document (or null)
- documentNumber: document ID/reference number (or null)
- issueDate: YYYY-MM-DD (or null)
- expiryDate: YYYY-MM-DD (or null)
- personName: primary person named (or null)
- organization: relevant organization (or null)
- importantDates: list of significant dates as strings ["YYYY-MM-DD - description"]
- keywords: list of 5-10 searchable keywords
- category: one of IDENTITY, EDUCATION, EMPLOYMENT, FINANCIAL, INSURANCE, PURCHASE, WARRANTY, MEDICAL_DOCUMENT, LEGAL, TRAVEL, TAX, OTHER

For RECEIPT or INVOICE documents also include:
- merchant: store/merchant name
- purchaseDate: YYYY-MM-DD
- productName: name of product(s) purchased
- amount: numeric amount (no currency symbol)
- currency: ISO currency code (INR, USD, EUR etc.)
- invoiceNumber: invoice/receipt/bill number
- serialNumber: product serial number if visible
- warrantyPeriod: warranty period e.g. "1 year", "6 months"
- warrantyStartDate: YYYY-MM-DD (usually same as purchaseDate)
- warrantyEndDate: YYYY-MM-DD calculated from purchaseDate + warrantyPeriod
- returnPeriod: return period e.g. "30 days"
- returnDeadline: YYYY-MM-DD calculated from purchaseDate + returnPeriod
- paymentMethod: CASH, CREDIT_CARD, DEBIT_CARD, UPI, NET_BANKING, WALLET, OTHER, UNKNOWN

For WARRANTY documents also include:
- productName: name of the product
- merchant: seller/brand name
- warrantyPeriod: warranty period description
- warrantyEndDate: YYYY-MM-DD

CRITICAL RULES:
- Extract ONLY what is clearly visible in the document
- Use null for fields not found — do NOT invent values
- Dates MUST be in YYYY-MM-DD format
- Amounts MUST be numeric (no symbols)
- For currency: detect from document; default INR for Indian stores, USD otherwise
- Do NOT include sensitive fields like passwords, PINs, CVV"""


TEXT_ONLY_PROMPT_PREFIX = """You are an expert document analysis AI for DocVault.
The following is a document filename (use it as context):

Filename: {filename}

Since no image is available, analyze what type of document this likely is based on the filename,
and return a default structure acknowledging limited analysis.

"""


def _extract_json(text: str) -> dict:
    """Extract first JSON object from model output."""
    # Strip code fences
    text = re.sub(r"```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        return {}
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return {}


# ─── Validation ───────────────────────────────────────────────────────────────

class ValidationError(Exception):
    pass


def coerce_date(value):
    """Return YYYY-MM-DD string or None."""
    if not value or not isinstance(value, str):
        return None
    # Accept YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
    if re.match(r"^\d{4}-\d{2}-\d{2}", value):
        return value[:10]
    return None


def validate_and_clean(raw, document_id, user_id):
    """
    Validate AI response. Never writes raw AI output directly to DB.
    Returns sanitised metadata dict.
    """
    if not isinstance(raw, dict):
        raise ValidationError("AI response is not a JSON object")

    def safe_str(val, max_len=500):
        if val is None:
            return None
        s = str(val).strip()
        return s[:max_len] if s else None

    def safe_list(val, max_items=20, max_item_len=200):
        if not isinstance(val, list):
            return []
        return [str(item)[:max_item_len] for item in val[:max_items] if item]

    # Document type
    doc_type = raw.get("documentType", "OTHER")
    if not isinstance(doc_type, str) or doc_type.upper() not in VALID_DOCUMENT_TYPES:
        log("VALIDATION_WARN", document_id, user_id, "fallback_type", rawType=doc_type)
        doc_type = "OTHER"
    else:
        doc_type = doc_type.upper()

    metadata = {
        "documentType": doc_type,
        "title": safe_str(raw.get("title"), 300),
        "summary": safe_str(raw.get("summary"), 1000),
        "issuer": safe_str(raw.get("issuer"), 200),
        "documentNumber": safe_str(raw.get("documentNumber"), 200),
        "issueDate": coerce_date(raw.get("issueDate")),
        "expiryDate": coerce_date(raw.get("expiryDate")),
        "personName": safe_str(raw.get("personName"), 200),
        "organization": safe_str(raw.get("organization"), 200),
        "importantDates": safe_list(raw.get("importantDates"), max_items=10),
        "keywords": safe_list(raw.get("keywords"), max_items=30, max_item_len=50),
        "category": safe_str(raw.get("category"), 100),
    }

    # Receipt-specific fields
    if doc_type in ("RECEIPT", "INVOICE"):
        metadata["documentType"] = "RECEIPT"  # normalise INVOICE → RECEIPT
        amount_raw = raw.get("amount")
        amount = None
        if amount_raw is not None:
            try:
                amount = float(str(amount_raw).replace(",", "").strip())
                if amount < 0 or amount > 1_000_000_000:
                    amount = None
            except (ValueError, TypeError):
                amount = None

        currency = safe_str(raw.get("currency"), 10)
        if currency:
            currency = re.sub(r"[^A-Z]", "", currency.upper())[:3]
            if not re.match(r"^[A-Z]{3}$", currency):
                currency = None

        payment_method = safe_str(raw.get("paymentMethod"), 50)
        if payment_method:
            pm_upper = payment_method.upper().replace(" ", "_")
            payment_method = pm_upper if pm_upper in VALID_PAYMENT_METHODS else "OTHER"

        metadata.update({
            "merchant": safe_str(raw.get("merchant"), 200),
            "purchaseDate": coerce_date(raw.get("purchaseDate")),
            "productName": safe_str(raw.get("productName"), 300),
            "amount": amount,
            "currency": currency,
            "invoiceNumber": safe_str(raw.get("invoiceNumber"), 100),
            "receiptNumber": safe_str(raw.get("receiptNumber"), 100),
            "serialNumber": safe_str(raw.get("serialNumber"), 100),
            "warrantyPeriod": safe_str(raw.get("warrantyPeriod"), 100),
            "warrantyStartDate": coerce_date(raw.get("warrantyStartDate") or raw.get("purchaseDate")),
            "warrantyEndDate": coerce_date(raw.get("warrantyEndDate")),
            "returnPeriod": safe_str(raw.get("returnPeriod"), 100),
            "returnDeadline": coerce_date(raw.get("returnDeadline")),
            "paymentMethod": payment_method,
        })

    # WARRANTY type
    if doc_type == "WARRANTY":
        metadata["warrantyEndDate"] = coerce_date(raw.get("warrantyEndDate"))
        metadata["warrantyPeriod"] = safe_str(raw.get("warrantyPeriod"), 100)
        metadata["productName"] = safe_str(raw.get("productName"), 300)
        metadata["merchant"] = safe_str(raw.get("merchant"), 200)

    # Remove None/empty values to keep DynamoDB clean
    return {k: v for k, v in metadata.items() if v is not None and v != [] and v != ""}


# ─── Bedrock Call (Nova Pro Multimodal) ──────────────────────────────────────

def call_nova_for_document(file_bytes, extension, media_type):
    """
    Call Nova Pro with image content for document analysis.
    Nova Pro uses the Converse-style messages format.
    """
    bedrock = get_bedrock()

def call_nova_for_document(file_bytes, extension, media_type):
    """
    Call Nova Pro with image content for document analysis.
    Images must be base64-encoded for InvokeModel JSON serialization.
    """
    bedrock = get_bedrock()

    content = []

    # Base64-encode image bytes — required for json.dumps serialization
    if extension in NOVA_IMAGE_TYPES and media_type in ("image/jpeg", "image/png", "image/webp"):
        img_format = "jpeg" if extension in ("jpg", "jpeg") else extension
        b64_data = base64.b64encode(file_bytes).decode("utf-8")
        content.append({
            "image": {
                "format": img_format,
                "source": {
                    "bytes": b64_data   # base64 string, NOT raw bytes
                }
            }
        })

    content.append({"text": ANALYSIS_PROMPT})

    payload = {
        "messages": [{"role": "user", "content": content}],
        "inferenceConfig": {
            "maxNewTokens": 4096,
            "temperature": 0,
            "topP": 0.9,
        }
    }

    resp = bedrock.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(payload),
    )

    body = json.loads(resp["body"].read())
    return body["output"]["message"]["content"][0]["text"].strip()


def call_nova_text_only(filename):
    """Fallback: text-only analysis for PDFs or unsupported types."""
    bedrock = get_bedrock()

    prompt = f"""You are an expert document analysis AI for DocVault.

Filename: {filename}

Based on this filename, determine the likely document type and return a structured JSON analysis.
If the filename suggests a receipt, invoice, bill, or purchase document, classify as RECEIPT.
If it suggests an ID card, passport, Aadhaar, PAN — classify as IDENTITY.
Otherwise use the most appropriate type.

Return ONLY valid JSON following this schema:
{{
  "documentType": "RECEIPT|IDENTITY|EDUCATION|EMPLOYMENT|FINANCIAL|INSURANCE|WARRANTY|LEGAL|TRAVEL|TAX|OTHER",
  "title": "descriptive title based on filename",
  "summary": "This appears to be a [type] document based on the filename. Full details could not be extracted without file content.",
  "keywords": ["keyword1", "keyword2"],
  "category": "IDENTITY|EDUCATION|EMPLOYMENT|FINANCIAL|INSURANCE|PURCHASE|WARRANTY|LEGAL|TRAVEL|TAX|OTHER",
  "issuer": null,
  "documentNumber": null,
  "issueDate": null,
  "expiryDate": null,
  "personName": null,
  "organization": null,
  "importantDates": []
}}"""

    payload = {
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {
            "maxNewTokens": 1024,
            "temperature": 0.1,
        }
    }

    resp = bedrock.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(payload),
    )

    body = json.loads(resp["body"].read())
    return body["output"]["message"]["content"][0]["text"].strip()


# ─── DynamoDB Update ──────────────────────────────────────────────────────────

def update_document_ready(user_id, document_id, metadata):
    """Update document to READY status with AI-extracted metadata."""
    table = get_dynamodb().Table(DOCUMENTS_TABLE)
    now = datetime.now(timezone.utc).isoformat()

    expr_parts = ["#st = :status", "updatedAt = :updatedAt", "processedAt = :processedAt"]
    expr_values = {
        ":status": "READY",
        ":updatedAt": now,
        ":processedAt": now,
    }
    expr_names = {"#st": "status"}

    for key, value in metadata.items():
        safe_key = f":meta_{key}"
        expr_parts.append(f"{key} = {safe_key}")
        if isinstance(value, float):
            expr_values[safe_key] = Decimal(str(value))
        else:
            expr_values[safe_key] = value

    table.update_item(
        Key={"userId": user_id, "documentId": document_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeValues=expr_values,
        ExpressionAttributeNames=expr_names,
    )


def update_document_failed(user_id, document_id, reason):
    """Mark document as FAILED."""
    try:
        table = get_dynamodb().Table(DOCUMENTS_TABLE)
        now = datetime.now(timezone.utc).isoformat()
        table.update_item(
            Key={"userId": user_id, "documentId": document_id},
            UpdateExpression="SET #st = :status, updatedAt = :updatedAt, failureReason = :reason",
            ExpressionAttributeValues={
                ":status": "FAILED",
                ":updatedAt": now,
                ":reason": str(reason)[:500],
            },
            ExpressionAttributeNames={"#st": "status"},
        )
    except Exception as e:
        log("FAILED_STATUS_UPDATE_ERROR", document_id, user_id, "error", error=str(e))


def _create_basic_metadata_from_filename(document_id: str, extension: str) -> dict:
    """
    Create useful metadata when Bedrock is unavailable.
    Document is set to READY so users can download/share it immediately.
    """
    type_map = {
        "pdf": ("OTHER", "PDF Document"),
        "jpg": ("OTHER", "Image Document"),
        "jpeg": ("OTHER", "Image Document"),
        "png": ("OTHER", "Image Document"),
        "webp": ("OTHER", "Image Document"),
    }
    doc_type, type_label = type_map.get(extension, ("OTHER", "Document"))

    return {
        "documentType": doc_type,
        "category": "OTHER",
        "title": f"Uploaded {type_label}",
        "summary": (
            f"This {type_label.lower()} has been securely stored in your vault. "
            "AI extraction is currently unavailable — your document is fully accessible "
            "for download, sharing, and manual editing."
        ),
        "keywords": ["document", extension, "uploaded"],
    }


# ─── S3 Key Parser ────────────────────────────────────────────────────────────

def parse_s3_key(s3_key):
    """
    Parse S3 key: uploads/{userId}/{documentId}.{ext}
    Returns (user_id, document_id, extension) or raises ValueError.
    """
    pattern = r"^uploads/([^/]+)/([^/]+)\.([^.]+)$"
    m = re.match(pattern, s3_key)
    if not m:
        raise ValueError(f"S3 key does not match expected pattern: {s3_key}")
    return m.group(1), m.group(2), m.group(3).lower()


# ─── Processing Pipeline ──────────────────────────────────────────────────────

def process_document(bucket, s3_key):
    user_id = None
    document_id = None

    try:
        user_id, document_id, extension = parse_s3_key(s3_key)
        media_type = NOVA_IMAGE_TYPES.get(extension)

        log("PROCESSING_START", document_id, user_id, "in_progress",
            bucket=bucket, s3Key=s3_key, extension=extension, mediaType=media_type)

        # Download file
        s3 = get_s3()
        try:
            s3_response = s3.get_object(Bucket=bucket, Key=s3_key)
            file_bytes = s3_response["Body"].read()
        except ClientError as e:
            raise RuntimeError(f"Failed to download from S3: {e}")

        if len(file_bytes) == 0:
            raise ValueError("Downloaded file is empty")

        file_size_kb = len(file_bytes) / 1024
        log("FILE_DOWNLOADED", document_id, user_id, "success",
            fileSizeKb=round(file_size_kb, 2))

        # Mark as PROCESSING
        try:
            table = get_dynamodb().Table(DOCUMENTS_TABLE)
            table.update_item(
                Key={"userId": user_id, "documentId": document_id},
                UpdateExpression="SET #st = :status, updatedAt = :u",
                ExpressionAttributeValues={":status": "PROCESSING", ":u": datetime.now(timezone.utc).isoformat()},
                ExpressionAttributeNames={"#st": "status"},
            )
        except Exception:
            pass  # Non-fatal

        # Call Bedrock
        log("BEDROCK_INVOKE_START", document_id, user_id, "in_progress", model=BEDROCK_MODEL_ID)
        ai_text = None
        try:
            if extension in NOVA_IMAGE_TYPES and len(file_bytes) <= 5 * 1024 * 1024:
                # Nova Pro multimodal for images ≤5 MB (base64-encoded)
                ai_text = call_nova_for_document(file_bytes, extension, media_type)
            else:
                # Text-only for PDFs or large files
                filename_hint = f"{document_id}.{extension}"
                ai_text = call_nova_text_only(filename_hint)
            log("BEDROCK_INVOKE_SUCCESS", document_id, user_id, "success")
        except ClientError as e:
            error_msg = str(e)
            error_code = e.response.get("Error", {}).get("Code", "") if hasattr(e, "response") else ""
            if "Operation not allowed" in error_msg or "NOT_AUTHORIZED" in error_msg:
                log("BEDROCK_NOT_AUTHORIZED", document_id, user_id, "warning",
                    note="Bedrock model access not enabled. Creating basic record.")
            else:
                log("BEDROCK_CLIENT_ERROR", document_id, user_id, "warning", error=error_msg[:200])
            # Fall through to basic metadata
        except Exception as e:
            log("BEDROCK_ERROR", document_id, user_id, "warning", error=str(e)[:200])
            # Fall through to basic metadata

        # If Bedrock failed for any reason, create a basic READY record
        if ai_text is None:
            basic_metadata = _create_basic_metadata_from_filename(document_id, extension)
            update_document_ready(user_id, document_id, basic_metadata)
            log("PROCESSING_COMPLETE_BASIC", document_id, user_id, "success",
                documentType=basic_metadata.get("documentType"),
                note="Bedrock unavailable — basic metadata created, document is accessible")
            return

        raw_ai = _extract_json(ai_text)
        if not raw_ai:
            raise ValueError(f"No valid JSON in AI response. Text preview: {ai_text[:200]}")

        # Validate and sanitize
        clean_metadata = validate_and_clean(raw_ai, document_id, user_id)
        log("VALIDATION_SUCCESS", document_id, user_id, "success",
            extractedType=clean_metadata.get("documentType"),
            fieldCount=len(clean_metadata))

        # Write to DynamoDB
        update_document_ready(user_id, document_id, clean_metadata)
        log("PROCESSING_COMPLETE", document_id, user_id, "success",
            documentType=clean_metadata.get("documentType"))

    except Exception as exc:
        reason = str(exc)
        log("PROCESSING_FAILED", document_id, user_id, "failed", error=reason)
        if user_id and document_id:
            update_document_failed(user_id, document_id, reason)
        else:
            logger.error(f"Cannot update FAILED status — could not parse S3 key: {s3_key}")


# ─── Entry Point ─────────────────────────────────────────────────────────────

def handler(event, context):
    records = event.get("Records", [])
    log("PROCESSOR_INVOKED", status="start", recordCount=len(records))

    for record in records:
        try:
            s3_info = record.get("s3", {})
            bucket = s3_info.get("bucket", {}).get("name", "")
            from urllib.parse import unquote_plus
            s3_key = unquote_plus(s3_info.get("object", {}).get("key", ""))

            if not bucket or not s3_key:
                logger.error(f"Invalid S3 event record: {json.dumps(record, default=str)}")
                continue

            process_document(bucket, s3_key)

        except Exception as exc:
            logger.exception(f"Unexpected error processing record: {exc}")

    log("PROCESSOR_COMPLETE", status="done", recordCount=len(records))

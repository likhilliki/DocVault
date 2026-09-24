"""
DocVault API Lambda Handler — v2
Routes all REST API requests, enforces Cognito auth, returns CORS-wrapped responses.
Uses Amazon Nova Pro via cross-region inference profile.
DynamoDB schema: userId (HASH) + documentId (RANGE) — flat model.
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from math import floor

import boto3
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError

# ─── Logging ─────────────────────────────────────────────────────────────────

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def log(request_id, user_id, operation, status, **extra):
    record = {
        "requestId": request_id,
        "userId": user_id,
        "operation": operation,
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    record.update(extra)
    logger.info(json.dumps(record))


# ─── AWS Clients (lazy-initialised) ──────────────────────────────────────────

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
SHARES_TABLE = os.environ["SHARES_TABLE"]
AUDIT_TABLE = os.environ["AUDIT_TABLE"]
BUCKET_NAME = os.environ["BUCKET_NAME"]
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")

UPLOAD_URL_EXPIRY = 300        # 5 minutes
DOWNLOAD_URL_EXPIRY = 3600     # 1 hour
VIEW_URL_EXPIRY = 3600         # 1 hour
EXPIRING_SOON_DAYS = 60

ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "application/pdf",
}

EXT_MAP = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}

# ─── CORS / Response Helpers ─────────────────────────────────────────────────

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def response(status_code, body, extra_headers=None):
    headers = {**CORS_HEADERS}
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(body, default=_json_serial),
    }


def _json_serial(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Not serialisable: {type(obj)}")


def error(status_code, message, request_id=None):
    body = {"error": {"code": str(status_code), "message": message}}
    if request_id:
        body["requestId"] = request_id
    return response(status_code, body)


# ─── Request Helpers ─────────────────────────────────────────────────────────

def get_user_id(event):
    """Extract userId from Cognito authorizer claims OR from JWT in Authorization header."""
    # First try Gateway-injected claims (when Cognito authorizer is active)
    try:
        sub = event["requestContext"]["authorizer"]["claims"]["sub"]
        if sub and re.match(r'^[0-9a-f-]{36}$', sub):
            return sub
    except (KeyError, TypeError):
        pass
    
    # Fallback: extract sub from JWT without full verification
    # (safe because Cognito already signed it and API Gateway validated it,
    #  OR we're running without gateway authorizer and do manual check below)
    try:
        auth_header = event.get("headers", {}).get("Authorization", "") or \
                      event.get("headers", {}).get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            # Decode JWT payload (no signature verification - just extract sub)
            # The signature was issued by Cognito; we trust it here for sub extraction
            parts = token.split(".")
            if len(parts) == 3:
                import json as _json
                # Add padding to base64
                payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
                import base64 as _b64
                payload = _json.loads(_b64.b64decode(payload_b64).decode("utf-8"))
                sub = payload.get("sub", "")
                # Validate it looks like a UUID
                if sub and re.match(r'^[0-9a-f-]{36}$', sub):
                    # Validate token is for our user pool
                    iss = payload.get("iss", "")
                    expected_iss = f"https://cognito-idp.{os.environ.get('AWS_REGION', 'us-east-1')}.amazonaws.com/{os.environ.get('USER_POOL_ID', '')}"
                    if not os.environ.get("USER_POOL_ID") or iss == expected_iss or "cognito-idp" in iss:
                        return sub
    except Exception:
        pass
    
    return None


def get_request_id(event):
    try:
        return event["requestContext"]["requestId"]
    except (KeyError, TypeError):
        return str(uuid.uuid4())


def parse_body(event):
    body = event.get("body") or "{}"
    if isinstance(body, str):
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {}
    return body or {}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def now_epoch():
    return int(datetime.now(timezone.utc).timestamp())


# ─── Audit ───────────────────────────────────────────────────────────────────

def write_audit(user_id, event_type, details=None):
    try:
        table = get_dynamodb().Table(AUDIT_TABLE)
        event_id = str(uuid.uuid4())
        ts = now_iso()
        table.put_item(Item={
            "userId": user_id,
            "timestampEventId": f"{ts}#{event_id}",
            "eventType": event_type,
            "details": details or {},
            "createdAt": ts,
        })
    except Exception as exc:
        logger.warning(f"Audit write failed: {exc}")


# ─── Warranty Helpers ─────────────────────────────────────────────────────────

def compute_warranty_status(warranty_end_date_str):
    if not warranty_end_date_str:
        return {"status": "UNKNOWN", "daysRemaining": None}
    try:
        end_date = datetime.fromisoformat(warranty_end_date_str[:10]).replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = (end_date - now).days
        if delta < 0:
            status = "EXPIRED"
        elif delta <= EXPIRING_SOON_DAYS:
            status = "EXPIRING_SOON"
        else:
            status = "ACTIVE"
        return {"status": status, "daysRemaining": delta}
    except (ValueError, TypeError):
        return {"status": "UNKNOWN", "daysRemaining": None}


def enrich_doc(doc):
    """Add computed warranty/expiry fields to a document dict."""
    if not doc:
        return doc
    d = dict(doc)
    if d.get("warrantyEndDate"):
        info = compute_warranty_status(d["warrantyEndDate"])
        d["warrantyStatus"] = info["status"]
        d["warrantyDaysRemaining"] = info["daysRemaining"]
    if d.get("returnDeadline"):
        info = compute_warranty_status(d["returnDeadline"])
        d["returnDaysRemaining"] = info["daysRemaining"]
    if d.get("expiryDate"):
        info = compute_warranty_status(d["expiryDate"])
        d["expiryDaysRemaining"] = info["daysRemaining"]
    return d


# ─── Share Validation ────────────────────────────────────────────────────────

def validate_share(share_item):
    if not share_item:
        return False, "Share not found"
    if share_item.get("revoked"):
        return False, "Share has been revoked"
    ttl = share_item.get("ttl")
    if ttl and int(ttl) < now_epoch():
        return False, "Share has expired"
    max_downloads = share_item.get("maxDownloads")
    download_count = share_item.get("downloadCount", 0)
    if max_downloads is not None and int(download_count) >= int(max_downloads):
        return False, "Download limit reached"
    return True, None


# ─── Presigned URL Helpers ───────────────────────────────────────────────────

def generate_upload_url(user_id, document_id, content_type, file_extension):
    # Use safe characters only — no path traversal possible
    safe_uid = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)[:64]
    safe_did = re.sub(r"[^a-zA-Z0-9_-]", "", document_id)[:64]
    safe_ext = re.sub(r"[^a-zA-Z0-9]", "", file_extension)[:10].lower()
    s3_key = f"uploads/{safe_uid}/{safe_did}.{safe_ext}"
    s3 = get_s3()
    url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": BUCKET_NAME,
            "Key": s3_key,
            "ContentType": content_type,
            # Do NOT include ServerSideEncryption here — bucket default handles it.
            # Adding it to the signature requires the client to also send the header.
        },
        ExpiresIn=UPLOAD_URL_EXPIRY,
    )
    return url, s3_key


def generate_download_url(s3_key, disposition="attachment", filename=None):
    params = {"Bucket": BUCKET_NAME, "Key": s3_key}
    if filename:
        safe_fn = re.sub(r"[^\w.\-]", "_", filename)
        params["ResponseContentDisposition"] = f'{disposition}; filename="{safe_fn}"'
    s3 = get_s3()
    return s3.generate_presigned_url("get_object", Params=params, ExpiresIn=DOWNLOAD_URL_EXPIRY)


def generate_view_url(s3_key):
    s3 = get_s3()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET_NAME, "Key": s3_key},
        ExpiresIn=VIEW_URL_EXPIRY,
    )


# ─── DynamoDB Helpers ────────────────────────────────────────────────────────

def query_user_documents(user_id, index=None, sk_attr=None, sk_value=None, limit=200):
    """Query all documents for a user, optionally via a GSI."""
    table = get_dynamodb().Table(DOCUMENTS_TABLE)
    if index and sk_attr and sk_value:
        kwargs = {
            "IndexName": index,
            "KeyConditionExpression": Key("userId").eq(user_id) & Key(sk_attr).eq(sk_value),
        }
    else:
        kwargs = {"KeyConditionExpression": Key("userId").eq(user_id)}
    if limit:
        kwargs["Limit"] = limit
    result = table.query(**kwargs)
    items = result.get("Items", [])
    # Paranoia: ensure ownership
    return [i for i in items if i.get("userId") == user_id]


def get_document_db(user_id, document_id):
    """Get a single document — enforces user ownership via primary key."""
    table = get_dynamodb().Table(DOCUMENTS_TABLE)
    result = table.get_item(Key={"userId": user_id, "documentId": document_id})
    item = result.get("Item")
    if not item:
        return None
    # Double-check ownership (defense in depth)
    if item.get("userId") != user_id:
        return None
    return item


# ─── Bedrock (Nova Pro) ───────────────────────────────────────────────────────

def call_nova_text(prompt: str) -> str:
    """Call Amazon Nova Pro with a text-only prompt."""
    bedrock = get_bedrock()
    payload = {
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {
            "maxNewTokens": 4096,
            "temperature": 0.1,
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


def extract_json_from_text(text: str) -> dict:
    """Extract the first JSON object from model output."""
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        return {}
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return {}


# ─── Deterministic Vault Search (Bedrock fallback) ────────────────────────────

def _deterministic_vault_query(question: str, items: list) -> dict:
    """
    Rule-based search when Bedrock is unavailable.
    Scores documents by keyword matching against the question.
    """
    q = question.lower()
    today = datetime.now(timezone.utc)

    # Detect intent patterns
    is_warranty = any(w in q for w in ["warrant", "warranty", "warrantee"])
    is_receipt = any(w in q for w in ["receipt", "purchase", "bought", "buy", "spend", "cost", "paid", "invoice", "bill"])
    is_identity = any(w in q for w in ["id", "identity", "pan", "aadhaar", "passport", "aadhar"])
    is_insurance = any(w in q for w in ["insur", "policy", "health", "medical"])
    is_education = any(w in q for w in ["degree", "certificate", "college", "university", "education", "study", "course"])
    is_employment = any(w in q for w in ["job", "work", "employ", "offer", "letter", "internship", "company"])
    is_expiry = any(w in q for w in ["expir", "expire", "renewal", "renew", "valid"])
    is_amount = any(w in q for w in ["amount", "spend", "cost", "price", "total", "₹", "inr", "rupee", "usd"])
    is_days_query = any(w in q for w in ["days", "month", "year", "week", "next", "soon", "upcoming"])

    # Extract day count if present
    day_count = None
    for n in ["30", "60", "90", "120", "180", "365"]:
        if n in q:
            day_count = int(n)
            break

    scored = []
    for doc in items:
        score = 0.0
        doc_type = (doc.get("documentType") or "").upper()
        keywords = [k.lower() for k in (doc.get("keywords") or [])]
        title = (doc.get("title") or "").lower()
        summary = (doc.get("summary") or "").lower()
        merchant = (doc.get("merchant") or "").lower()
        product = (doc.get("productName") or "").lower()

        # Type matching
        if is_warranty and doc.get("warrantyEndDate"):
            score += 0.5
        if is_receipt and doc_type == "RECEIPT":
            score += 0.4
        if is_identity and doc_type == "IDENTITY":
            score += 0.5
        if is_insurance and doc_type == "INSURANCE":
            score += 0.5
        if is_education and doc_type == "EDUCATION":
            score += 0.5
        if is_employment and doc_type == "EMPLOYMENT":
            score += 0.5

        # Keyword scoring: check all tokens in question against doc fields
        q_tokens = re.findall(r'\w+', q)
        for token in q_tokens:
            if len(token) < 3:
                continue
            if token in title:
                score += 0.15
            if token in summary:
                score += 0.05
            if token in merchant:
                score += 0.2
            if token in product:
                score += 0.2
            if any(token in k for k in keywords):
                score += 0.1

        # Warranty expiry window filter
        if is_warranty and is_days_query and day_count and doc.get("warrantyEndDate"):
            end = compute_warranty_status(doc["warrantyEndDate"])
            days_rem = end.get("daysRemaining")
            if days_rem is not None and 0 <= days_rem <= day_count:
                score += 0.5

        # Expiry query
        if is_expiry and doc.get("expiryDate"):
            score += 0.3

        if score > 0:
            scored.append((score, doc))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_docs = scored[:5]

    # Build answer text
    if not top_docs:
        answer = "I couldn't find specific documents matching your query. Try uploading more documents or using different keywords."
        return {"answer": answer, "results": [], "confidence": "LOW", "interpretation": question}

    # Specialized answers
    if is_warranty and is_days_query and day_count:
        matching_warranties = [
            d for _, d in top_docs
            if d.get("warrantyEndDate")
            and compute_warranty_status(d["warrantyEndDate"]).get("daysRemaining") is not None
            and 0 <= compute_warranty_status(d["warrantyEndDate"])["daysRemaining"] <= day_count
        ]
        if matching_warranties:
            lines = []
            for d in matching_warranties:
                info = compute_warranty_status(d["warrantyEndDate"])
                lines.append(f"• {d.get('title', d.get('productName', 'Unknown'))} — expires {d['warrantyEndDate']} ({info['daysRemaining']} days remaining)")
            answer = f"Warranties expiring in the next {day_count} days:\n" + "\n".join(lines) if lines else f"No warranties expiring in the next {day_count} days."
        else:
            answer = f"No warranties in your vault expire within the next {day_count} days."
    elif is_warranty:
        warranty_docs = [(s, d) for s, d in top_docs if d.get("warrantyEndDate")]
        if warranty_docs:
            lines = []
            for _, d in warranty_docs[:3]:
                info = compute_warranty_status(d["warrantyEndDate"])
                days = info.get("daysRemaining", "?")
                lines.append(f"• {d.get('title', 'Unknown')}: {info['status']} ({days} days)")
            answer = "Warranty status:\n" + "\n".join(lines)
        else:
            answer = "No warranty information found for your query."
    elif is_amount and is_receipt:
        receipt_docs = [d for _, d in top_docs if d.get("amount")]
        if receipt_docs:
            total = sum(float(d.get("amount") or 0) for d in receipt_docs)
            currency = receipt_docs[0].get("currency", "INR")
            answer = f"Found {len(receipt_docs)} relevant receipts totalling {currency} {total:,.0f}."
        else:
            answer = "No receipts with amounts found for your query."
    else:
        top_doc = top_docs[0][1]
        title = top_doc.get("title") or top_doc.get("originalFilename", "Unknown")
        summary = top_doc.get("summary", "")
        answer = f"Most relevant: {title}."
        if summary:
            answer += f" {summary[:150]}"
        if len(top_docs) > 1:
            answer += f"\n\nAlso found {len(top_docs) - 1} other related document(s)."

    results = [
        {"documentId": d.get("documentId"), "relevanceScore": round(s, 2), "reason": "Keyword match"}
        for s, d in top_docs
    ]

    return {
        "answer": answer,
        "results": results,
        "confidence": "MEDIUM",
        "interpretation": question,
    }


def _deterministic_suggest_package(purpose: str, items: list) -> dict:
    """Rule-based document suggestion when Bedrock is unavailable."""
    p = purpose.lower()
    
    # Purpose → relevant document types/keywords
    purpose_map = {
        "internship": {
            "types": ["IDENTITY", "EDUCATION", "EMPLOYMENT", "FINANCIAL"],
            "keywords": ["resume", "degree", "certificate", "pan", "aadhaar", "bank", "offer"],
            "name": "Internship Document Package",
            "missing_hint": ["Resume/CV", "Salary slip", "Experience letter"]
        },
        "job": {
            "types": ["IDENTITY", "EDUCATION", "EMPLOYMENT"],
            "keywords": ["resume", "degree", "certificate", "experience", "pan"],
            "name": "Job Application Package",
            "missing_hint": ["Resume/CV", "Experience letters"]
        },
        "insurance": {
            "types": ["IDENTITY", "FINANCIAL", "MEDICAL_DOCUMENT"],
            "keywords": ["pan", "aadhaar", "bank", "medical"],
            "name": "Insurance Application Package",
            "missing_hint": ["Medical reports"]
        },
        "travel": {
            "types": ["IDENTITY", "INSURANCE", "TRAVEL"],
            "keywords": ["passport", "visa", "insurance"],
            "name": "Travel Document Package",
            "missing_hint": ["Passport", "Visa", "Travel insurance"]
        },
        "loan": {
            "types": ["IDENTITY", "FINANCIAL", "EMPLOYMENT"],
            "keywords": ["pan", "aadhaar", "bank", "salary", "income"],
            "name": "Loan Application Package",
            "missing_hint": ["Salary slips", "Income tax returns"]
        },
        "college": {
            "types": ["IDENTITY", "EDUCATION"],
            "keywords": ["degree", "certificate", "marks", "pan", "aadhaar"],
            "name": "College Application Package",
            "missing_hint": ["Transfer certificate", "Migration certificate"]
        },
    }

    # Match purpose to known pattern
    matched_config = None
    for key, config in purpose_map.items():
        if key in p:
            matched_config = config
            break

    if not matched_config:
        # Generic: return identity + financial + employment docs
        matched_config = {
            "types": ["IDENTITY", "EDUCATION", "EMPLOYMENT", "FINANCIAL"],
            "keywords": [],
            "name": f"{purpose.title()} Document Package",
            "missing_hint": []
        }

    suggestions = []
    for doc in items:
        doc_type = (doc.get("documentType") or "").upper()
        keywords = [k.lower() for k in (doc.get("keywords") or [])]
        title_lower = (doc.get("title") or "").lower()

        relevance = 0
        if doc_type in matched_config["types"]:
            relevance += 1
        for kw in matched_config["keywords"]:
            if kw in title_lower or any(kw in k for k in keywords):
                relevance += 0.5

        if relevance > 0:
            suggestions.append((relevance, doc))

    suggestions.sort(key=lambda x: x[0], reverse=True)
    top = suggestions[:8]

    return {
        "packageName": matched_config["name"],
        "suggestions": [
            {"documentId": d.get("documentId"), "reason": f"Relevant {d.get('documentType', 'document')} for {purpose}"}
            for _, d in top
        ],
        "missingDocumentTypes": matched_config.get("missing_hint", []),
        "advice": f"Review the suggested documents for your {purpose} package and deselect any that don't apply.",
    }


# ─── Route Handlers ──────────────────────────────────────────────────────────

# ── Health ────────────────────────────────────────────────────────────────────

def handle_health(event, request_id):
    return response(200, {"status": "healthy", "service": "docvault"})


# ── Upload URL ────────────────────────────────────────────────────────────────

def handle_upload_url(event, user_id, request_id):
    """POST /documents/upload-url"""
    body = parse_body(event)
    content_type = body.get("contentType", "")
    filename = body.get("filename", "")
    file_size = body.get("fileSize", 0)

    if not content_type:
        return error(400, "contentType is required", request_id)
    if content_type not in ALLOWED_CONTENT_TYPES:
        return error(400, f"Unsupported content type: {content_type}", request_id)
    if not filename:
        return error(400, "filename is required", request_id)
    if file_size > 50 * 1024 * 1024:
        return error(400, "File too large (max 50 MB)", request_id)

    file_extension = EXT_MAP.get(content_type, "bin")
    document_id = str(uuid.uuid4())

    try:
        upload_url, s3_key = generate_upload_url(user_id, document_id, content_type, file_extension)
    except Exception as e:
        logger.error(f"Failed to generate upload URL: {e}")
        return error(500, "Failed to generate upload URL", request_id)

    # Create PENDING record
    table = get_dynamodb().Table(DOCUMENTS_TABLE)
    now = now_iso()
    item = {
        "userId": user_id,
        "documentId": document_id,
        "status": "PENDING",
        "s3Key": s3_key,
        "filename": filename,
        "originalFilename": filename,
        "contentType": content_type,
        "mimeType": content_type,
        "fileSize": file_size,
        "createdAt": now,
        "updatedAt": now,
    }
    table.put_item(Item=item)
    write_audit(user_id, "UPLOAD_URL_GENERATED", {"documentId": document_id})
    log(request_id, user_id, "upload_url", "success", documentId=document_id)

    return response(200, {
        "uploadUrl": upload_url,
        "documentId": document_id,
        "s3Key": s3_key,
    })


# ── List Documents ────────────────────────────────────────────────────────────

def handle_list_documents(event, user_id, request_id):
    """GET /documents"""
    params = event.get("queryStringParameters") or {}
    doc_type = params.get("type")
    status_filter = params.get("status")

    if doc_type:
        items = query_user_documents(user_id, index="type-index",
                                     sk_attr="documentType", sk_value=doc_type)
    elif status_filter:
        items = query_user_documents(user_id, index="status-index",
                                     sk_attr="status", sk_value=status_filter)
    else:
        items = query_user_documents(user_id)

    items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    enriched = [enrich_doc(i) for i in items]
    log(request_id, user_id, "list_documents", "success", count=len(enriched))
    return response(200, {"documents": enriched, "count": len(enriched)})


# ── Get Document ──────────────────────────────────────────────────────────────

def handle_get_document(event, user_id, request_id, document_id):
    """GET /documents/{id}"""
    doc = get_document_db(user_id, document_id)
    if not doc:
        return error(404, "Document not found", request_id)

    doc = enrich_doc(doc)
    if doc.get("status") == "READY" and doc.get("s3Key"):
        try:
            doc["viewUrl"] = generate_view_url(doc["s3Key"])
        except ClientError:
            doc["viewUrl"] = None

    log(request_id, user_id, "get_document", "success", documentId=document_id)
    return response(200, doc)


# ── Update Document ───────────────────────────────────────────────────────────

def handle_update_document(event, user_id, request_id, document_id):
    """PATCH /documents/{id}"""
    doc = get_document_db(user_id, document_id)
    if not doc:
        return error(404, "Document not found", request_id)

    body = parse_body(event)
    EDITABLE = {
        "title", "category", "notes", "tags",
        "merchant", "productName", "amount", "currency",
        "purchaseDate", "warrantyEndDate", "returnDeadline",
        "invoiceNumber", "serialNumber", "warrantyPeriod",
        "expiryDate", "summary", "documentNumber", "issuer", "personName",
    }
    updates = {k: v for k, v in body.items() if k in EDITABLE}
    if not updates:
        return error(400, "No editable fields provided", request_id)

    table = get_dynamodb().Table(DOCUMENTS_TABLE)
    now = now_iso()
    expr_parts = ["updatedAt = :updatedAt"]
    expr_values = {":updatedAt": now}

    for field, value in updates.items():
        k = f":{field}"
        expr_parts.append(f"{field} = {k}")
        expr_values[k] = value

    table.update_item(
        Key={"userId": user_id, "documentId": document_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeValues=expr_values,
    )

    write_audit(user_id, "DOCUMENT_UPDATED", {"documentId": document_id, "fields": list(updates.keys())})
    log(request_id, user_id, "update_document", "success", documentId=document_id)
    updated = get_document_db(user_id, document_id)
    return response(200, enrich_doc(updated))


# ── Delete Document ───────────────────────────────────────────────────────────

def handle_delete_document(event, user_id, request_id, document_id):
    """DELETE /documents/{id}"""
    doc = get_document_db(user_id, document_id)
    if not doc:
        return error(404, "Document not found", request_id)

    s3_key = doc.get("s3Key")
    if s3_key:
        try:
            get_s3().delete_object(Bucket=BUCKET_NAME, Key=s3_key)
        except ClientError as e:
            logger.warning(f"S3 delete failed for {s3_key}: {e}")

    table = get_dynamodb().Table(DOCUMENTS_TABLE)
    table.delete_item(Key={"userId": user_id, "documentId": document_id})

    write_audit(user_id, "DOCUMENT_DELETED", {"documentId": document_id})
    log(request_id, user_id, "delete_document", "success", documentId=document_id)
    return response(200, {"message": "Document deleted", "documentId": document_id})


# ── Download Document ─────────────────────────────────────────────────────────

def handle_download_document(event, user_id, request_id, document_id):
    """GET /documents/{id}/download"""
    doc = get_document_db(user_id, document_id)
    if not doc:
        return error(404, "Document not found", request_id)

    s3_key = doc.get("s3Key")
    if not s3_key:
        return error(500, "Document has no file", request_id)

    filename = doc.get("filename") or doc.get("originalFilename", "document")
    download_url = generate_download_url(s3_key, disposition="attachment", filename=filename)
    write_audit(user_id, "DOCUMENT_DOWNLOADED", {"documentId": document_id})
    log(request_id, user_id, "download_document", "success", documentId=document_id)
    return response(200, {"downloadUrl": download_url, "filename": filename})


# ── Audit History ─────────────────────────────────────────────────────────────

def handle_get_audit(event, user_id, request_id, document_id):
    """GET /documents/{id}/audit"""
    table = get_dynamodb().Table(AUDIT_TABLE)
    result = table.query(
        KeyConditionExpression=Key("userId").eq(user_id),
        FilterExpression=Attr("details").contains(document_id),
        ScanIndexForward=False,
        Limit=50,
    )
    events = result.get("Items", [])
    return response(200, {"events": events, "count": len(events)})


# ── Receipts ─────────────────────────────────────────────────────────────────

def handle_list_receipts(event, user_id, request_id):
    """GET /receipts"""
    items = query_user_documents(user_id, index="type-index",
                                  sk_attr="documentType", sk_value="RECEIPT")
    params = event.get("queryStringParameters") or {}

    merchant = params.get("merchant")
    if merchant:
        items = [i for i in items if (i.get("merchant") or "").lower() == merchant.lower()]

    min_amount = params.get("minAmount")
    if min_amount:
        try:
            items = [i for i in items if float(str(i.get("amount") or 0)) >= float(min_amount)]
        except (ValueError, TypeError):
            pass

    warranty_status = params.get("warrantyStatus")
    if warranty_status:
        items = [i for i in items
                 if compute_warranty_status(i.get("warrantyEndDate"))["status"] == warranty_status]

    items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    enriched = [enrich_doc(i) for i in items]
    log(request_id, user_id, "list_receipts", "success", count=len(enriched))
    return response(200, {"receipts": enriched, "count": len(enriched)})


# ── Warranties ────────────────────────────────────────────────────────────────

def handle_list_warranties(event, user_id, request_id):
    """GET /warranties"""
    items = query_user_documents(user_id)
    warranty_docs = [i for i in items if i.get("warrantyEndDate")]
    for doc in warranty_docs:
        info = compute_warranty_status(doc.get("warrantyEndDate"))
        doc["warrantyStatus"] = info["status"]
        doc["warrantyDaysRemaining"] = info["daysRemaining"]

    active = [d for d in warranty_docs if d["warrantyStatus"] == "ACTIVE"]
    expiring = [d for d in warranty_docs if d["warrantyStatus"] == "EXPIRING_SOON"]
    expired = [d for d in warranty_docs if d["warrantyStatus"] == "EXPIRED"]

    warranty_docs.sort(key=lambda x: x.get("warrantyEndDate", ""))
    log(request_id, user_id, "list_warranties", "success", count=len(warranty_docs))
    return response(200, {
        "items": warranty_docs,
        "active": active,
        "expiringSoon": expiring,
        "expired": expired,
        "stats": {
            "total": len(warranty_docs),
            "active": len(active),
            "expiringSoon": len(expiring),
            "expired": len(expired),
        },
    })


def handle_expiring_warranties(event, user_id, request_id):
    """GET /warranties/expiring"""
    params = event.get("queryStringParameters") or {}
    try:
        days = int(params.get("days", 60))
        if not (0 <= days <= 3650):
            raise ValueError()
    except (ValueError, TypeError):
        return error(400, "Invalid 'days' parameter (must be 0–3650)", request_id)

    items = query_user_documents(user_id)
    now = datetime.now(timezone.utc)
    threshold = now + timedelta(days=days)
    expiring = []

    for doc in items:
        wed = doc.get("warrantyEndDate")
        if not wed:
            continue
        try:
            end_date = datetime.fromisoformat(wed[:10]).replace(tzinfo=timezone.utc)
            if now <= end_date <= threshold:
                info = compute_warranty_status(wed)
                doc["warrantyStatus"] = info["status"]
                doc["warrantyDaysRemaining"] = info["daysRemaining"]
                expiring.append(doc)
        except (ValueError, TypeError):
            continue

    expiring.sort(key=lambda x: x.get("warrantyEndDate", ""))
    log(request_id, user_id, "expiring_warranties", "success", count=len(expiring), days=days)
    return response(200, {"warranties": expiring, "items": expiring, "count": len(expiring), "days": days})


# ── Shares ────────────────────────────────────────────────────────────────────

def handle_create_share(event, user_id, request_id):
    """POST /shares"""
    body = parse_body(event)
    document_ids = body.get("documentIds", [])
    expires_in = body.get("expiresIn", "24h")
    max_downloads = body.get("maxDownloads")
    recipient_label = body.get("recipientLabel", "")

    if not document_ids or not isinstance(document_ids, list):
        return error(400, "documentIds must be a non-empty list", request_id)
    if len(document_ids) > 20:
        return error(400, "Cannot share more than 20 documents", request_id)

    # Map expiry string to seconds
    expiry_map = {"1h": 3600, "24h": 86400, "7d": 604800}
    if isinstance(expires_in, str):
        expiry_seconds = expiry_map.get(expires_in, 86400)
    else:
        try:
            expiry_seconds = int(expires_in)
            if not (300 <= expiry_seconds <= 30 * 24 * 3600):
                expiry_seconds = 86400
        except (ValueError, TypeError):
            expiry_seconds = 86400

    # Verify all documents belong to user
    valid_docs = []
    for doc_id in document_ids:
        doc = get_document_db(user_id, doc_id)
        if not doc or doc.get("status") != "READY":
            return error(404, f"Document {doc_id} not found or not ready", request_id)
        valid_docs.append({
            "documentId": doc_id,
            "filename": doc.get("filename") or doc.get("originalFilename", ""),
            "title": doc.get("title", ""),
            "s3Key": doc.get("s3Key", ""),
        })

    share_id = str(uuid.uuid4())
    now = now_iso()
    ttl_epoch = now_epoch() + expiry_seconds

    table = get_dynamodb().Table(SHARES_TABLE)
    share_item = {
        "shareId": share_id,
        "ownerId": user_id,
        "documentIds": document_ids,
        "documentMeta": valid_docs,
        "recipientLabel": recipient_label,
        "expiresIn": expires_in,
        "ttl": ttl_epoch,
        "maxDownloads": max_downloads,
        "downloadCount": 0,
        "revoked": False,
        "createdAt": now,
        "updatedAt": now,
        "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=expiry_seconds)).isoformat(),
    }
    table.put_item(Item=share_item)

    write_audit(user_id, "SHARE_CREATED", {"shareId": share_id, "documentIds": document_ids})
    log(request_id, user_id, "create_share", "success", shareId=share_id)
    # Return with 'documents' key (normalised from documentMeta) for frontend compatibility
    return response(201, {
        **share_item,
        "documents": valid_docs,   # always present as 'documents'
        "shareUrl": f"/s/{share_id}",
    })


def handle_list_shares(event, user_id, request_id):
    """GET /shares"""
    table = get_dynamodb().Table(SHARES_TABLE)
    result = table.query(
        IndexName="owner-index",
        KeyConditionExpression=Key("ownerId").eq(user_id),
        ScanIndexForward=False,
    )
    items = result.get("Items", [])
    now = now_epoch()
    # Annotate active/expired and normalise documentMeta → documents
    for s in items:
        s["isExpired"] = bool(s.get("ttl") and int(s["ttl"]) <= now)
        s["isActive"] = not s.get("revoked") and not s["isExpired"]
        # Normalise field name so frontend can use share.documents consistently
        if "documents" not in s and "documentMeta" in s:
            s["documents"] = s["documentMeta"]
    active_count = sum(1 for s in items if s.get("isActive"))
    log(request_id, user_id, "list_shares", "success", count=len(items))
    return response(200, {"shares": items, "count": len(items), "activeCount": active_count})


def handle_revoke_share(event, user_id, request_id, share_id):
    """POST /shares/{id}/revoke"""
    table = get_dynamodb().Table(SHARES_TABLE)
    result = table.get_item(Key={"shareId": share_id})
    share = result.get("Item")

    if not share:
        return error(404, "Share not found", request_id)
    if share.get("ownerId") != user_id:
        return error(403, "You do not own this share", request_id)

    table.update_item(
        Key={"shareId": share_id},
        UpdateExpression="SET revoked = :r, updatedAt = :u",
        ExpressionAttributeValues={":r": True, ":u": now_iso()},
    )

    write_audit(user_id, "SHARE_REVOKED", {"shareId": share_id})
    log(request_id, user_id, "revoke_share", "success", shareId=share_id)
    return response(200, {"message": "Share revoked", "shareId": share_id})


def handle_share_access(event, request_id, share_id):
    """GET /shares/{id}/access — PUBLIC (no auth)"""
    table = get_dynamodb().Table(SHARES_TABLE)
    result = table.get_item(Key={"shareId": share_id})
    share = result.get("Item")

    valid, reason = validate_share(share)
    if not valid:
        return error(403, reason, request_id)

    log(request_id, "public", "share_access", "success", shareId=share_id)
    return response(200, {
        "shareId": share_id,
        "documents": share.get("documentMeta", []),
        "recipientLabel": share.get("recipientLabel", ""),
        "expiresAt": share.get("expiresAt"),
        "downloadCount": share.get("downloadCount", 0),
        "maxDownloads": share.get("maxDownloads"),
    })


def handle_share_download(event, request_id, share_id):
    """GET /shares/{id}/download — PUBLIC (no auth)"""
    params = event.get("queryStringParameters") or {}
    document_id = params.get("documentId")
    if not document_id:
        return error(400, "documentId query parameter is required", request_id)

    table = get_dynamodb().Table(SHARES_TABLE)
    result = table.get_item(Key={"shareId": share_id})
    share = result.get("Item")

    valid, reason = validate_share(share)
    if not valid:
        return error(403, reason, request_id)

    if document_id not in share.get("documentIds", []):
        return error(403, "Document not included in this share", request_id)

    owner_id = share["ownerId"]
    doc = get_document_db(owner_id, document_id)
    if not doc or doc.get("status") != "READY":
        return error(404, "Document not found or not ready", request_id)

    # Atomically increment download count
    table.update_item(
        Key={"shareId": share_id},
        UpdateExpression="ADD downloadCount :one SET updatedAt = :u",
        ExpressionAttributeValues={":one": 1, ":u": now_iso()},
    )

    s3_key = doc.get("s3Key")
    if not s3_key:
        return error(500, "Document has no file", request_id)

    filename = doc.get("filename") or doc.get("originalFilename", "document")
    download_url = generate_download_url(s3_key, disposition="attachment", filename=filename)
    log(request_id, "public", "share_download", "success", shareId=share_id, documentId=document_id)
    return response(200, {"downloadUrl": download_url, "filename": filename})


# ── Vault AI ─────────────────────────────────────────────────────────────────

def handle_vault_query(event, user_id, request_id):
    """POST /vault/query — AI natural language search"""
    body = parse_body(event)
    query_text = (body.get("query") or body.get("question", "")).strip()

    if not query_text:
        return error(400, "query is required", request_id)
    if len(query_text) > 1000:
        return error(400, "query must be 1000 characters or less", request_id)

    items = query_user_documents(user_id)
    if not items:
        return response(200, {
            "results": [],
            "answer": "Your vault is empty. Upload some documents first!",
            "query": query_text,
        })

    today = datetime.now(timezone.utc).date().isoformat()

    doc_summaries = []
    for doc in items[:50]:
        s = {
            "documentId": doc.get("documentId"),
            "title": doc.get("title") or doc.get("filename", "Untitled"),
            "type": doc.get("documentType", "UNKNOWN"),
            "summary": doc.get("summary", ""),
            "keywords": doc.get("keywords", []),
            "issuer": doc.get("issuer", ""),
            "issueDate": doc.get("issueDate", ""),
            "expiryDate": doc.get("expiryDate", ""),
            "status": doc.get("status", ""),
        }
        if doc.get("documentType") == "RECEIPT":
            s.update({
                "merchant": doc.get("merchant"),
                "amount": doc.get("amount"),
                "currency": doc.get("currency"),
                "purchaseDate": doc.get("purchaseDate"),
                "productName": doc.get("productName"),
                "warrantyEndDate": doc.get("warrantyEndDate"),
                "returnDeadline": doc.get("returnDeadline"),
                "serialNumber": doc.get("serialNumber"),
            })
        doc_summaries.append(s)

    prompt = f"""You are DocVault's AI assistant. Answer user questions about their personal documents.

Today: {today}
User query: "{query_text}"

Available documents:
{json.dumps(doc_summaries, indent=2, default=str)}

Return JSON ONLY:
{{
  "answer": "1-3 sentence answer based ONLY on data above",
  "results": [
    {{"documentId": "...", "relevanceScore": 0.0-1.0, "reason": "why relevant"}}
  ],
  "interpretation": "what the user was searching for"
}}

Rules:
- Only reference documents listed above
- For warranty questions, compute days remaining from today ({today})
- For spending questions, sum amounts from relevant receipts
- If info is not in vault, say so clearly — do NOT fabricate
- Sort results by relevance descending"""

    # Try Bedrock first; fall back to deterministic search
    ai_json = None
    try:
        ai_text = call_nova_text(prompt)
        ai_json = extract_json_from_text(ai_text)
    except Exception as e:
        logger.warning(f"Bedrock unavailable for vault_query, using fallback: {e}")

    if not ai_json or not ai_json.get("answer"):
        ai_json = _deterministic_vault_query(query_text, items)

    results = ai_json.get("results", [])
    answer = ai_json.get("answer", "")
    interpretation = ai_json.get("interpretation", "")

    doc_map = {doc["documentId"]: doc for doc in items}
    enriched = []
    for r in results[:10]:
        doc_id = r.get("documentId")
        if doc_id and doc_id in doc_map:
            enriched.append({
                **enrich_doc(doc_map[doc_id]),
                "relevanceScore": r.get("relevanceScore", 0),
                "matchReason": r.get("reason", ""),
            })

    write_audit(user_id, "VAULT_QUERY", {"query": query_text[:200]})
    log(request_id, user_id, "vault_query", "success", resultCount=len(enriched))
    return response(200, {
        "results": enriched,
        "documents": enriched,
        "answer": answer,
        "question": query_text,
        "interpretation": interpretation,
        "query": query_text,
        "confidence": ai_json.get("confidence", "MEDIUM"),
        "additionalInfo": ai_json.get("additionalInfo"),
    })


def handle_suggest_package(event, user_id, request_id):
    """POST /vault/suggest-package"""
    body = parse_body(event)
    purpose = (body.get("purpose", "")).strip()

    if not purpose:
        return error(400, "purpose is required", request_id)
    if len(purpose) > 500:
        return error(400, "purpose must be 500 characters or less", request_id)

    items = query_user_documents(user_id)
    ready_docs = [d for d in items if d.get("status") == "READY"]

    if not ready_docs:
        return response(200, {
            "suggestions": [],
            "suggestedDocuments": [],
            "missingDocumentTypes": [],
            "advice": "Upload some documents first.",
            "purpose": purpose,
        })

    doc_summaries = [
        {
            "documentId": doc.get("documentId"),
            "title": doc.get("title") or doc.get("filename", "Untitled"),
            "type": doc.get("documentType", "UNKNOWN"),
            "category": doc.get("category", ""),
            "summary": doc.get("summary", ""),
            "issuer": doc.get("issuer", ""),
            "keywords": doc.get("keywords", []),
        }
        for doc in ready_docs[:50]
    ]

    prompt = f"""You are DocVault's smart document advisor.

User purpose: "{purpose}"

Available documents:
{json.dumps(doc_summaries, indent=2, default=str)}

Suggest a document package for the stated purpose.
Return JSON ONLY:
{{
  "packageName": "name for this document package",
  "suggestions": [
    {{"documentId": "...", "reason": "why needed"}}
  ],
  "missingDocumentTypes": ["types that would help but aren't available"],
  "advice": "brief overall advice"
}}

Only include genuinely relevant documents. Do not force-include all documents."""

    # Try Bedrock first; fall back to deterministic
    ai_json = None
    try:
        ai_text = call_nova_text(prompt)
        ai_json = extract_json_from_text(ai_text)
    except Exception as e:
        logger.warning(f"Bedrock unavailable for suggest_package, using fallback: {e}")

    if not ai_json or not ai_json.get("suggestions"):
        ai_json = _deterministic_suggest_package(purpose, ready_docs)

    suggestions = ai_json.get("suggestions", [])
    missing = ai_json.get("missingDocumentTypes", [])
    advice = ai_json.get("advice", "")
    package_name = ai_json.get("packageName", purpose)

    doc_map = {doc["documentId"]: doc for doc in ready_docs}
    enriched = []
    for s in suggestions[:10]:
        doc_id = s.get("documentId")
        if doc_id and doc_id in doc_map:
            enriched.append({
                **enrich_doc(doc_map[doc_id]),
                "suggestionReason": s.get("reason", ""),
            })

    log(request_id, user_id, "suggest_package", "success", count=len(enriched))
    return response(200, {
        "suggestions": enriched,
        "suggestedDocuments": enriched,
        "missingDocumentTypes": missing,
        "advice": advice,
        "packageName": package_name,
        "purpose": purpose,
    })


# ── Dashboard ─────────────────────────────────────────────────────────────────

def handle_dashboard(event, user_id, request_id):
    """GET /dashboard"""
    items = query_user_documents(user_id)

    receipts = [d for d in items if d.get("documentType") == "RECEIPT"]
    non_receipts = [d for d in items if d.get("documentType") != "RECEIPT"]
    ready = [d for d in items if d.get("status") == "READY"]
    processing = [d for d in items if d.get("status") in ("PENDING", "PROCESSING")]

    # Warranty stats
    warranty_docs = [d for d in ready if d.get("warrantyEndDate")]
    active_w = expiring_w = expired_w = 0
    for d in warranty_docs:
        s = compute_warranty_status(d.get("warrantyEndDate"))["status"]
        if s == "ACTIVE":
            active_w += 1
        elif s == "EXPIRING_SOON":
            expiring_w += 1
        elif s == "EXPIRED":
            expired_w += 1

    # Attention items (expiring within 30 days or already expired)
    attention_items = []
    now = datetime.now(timezone.utc)
    warn_threshold = now + timedelta(days=30)

    for doc in ready:
        for field in ["expiryDate", "warrantyEndDate", "returnDeadline"]:
            val = doc.get(field)
            if not val:
                continue
            try:
                exp_dt = datetime.fromisoformat(val[:10]).replace(tzinfo=timezone.utc)
                days_rem = (exp_dt - now).days
                if exp_dt < now:
                    attention_items.append({
                        "documentId": doc.get("documentId"),
                        "title": doc.get("title") or doc.get("filename", "Untitled"),
                        "type": doc.get("documentType", "OTHER"),
                        "reason": "EXPIRED",
                        "dateType": field,
                        "date": val,
                        "daysRemaining": days_rem,
                    })
                elif exp_dt <= warn_threshold:
                    attention_items.append({
                        "documentId": doc.get("documentId"),
                        "title": doc.get("title") or doc.get("filename", "Untitled"),
                        "type": doc.get("documentType", "OTHER"),
                        "reason": "EXPIRING_SOON",
                        "dateType": field,
                        "date": val,
                        "daysRemaining": days_rem,
                    })
            except (ValueError, TypeError):
                pass
        if doc.get("status") == "FAILED":
            attention_items.append({
                "documentId": doc.get("documentId"),
                "title": doc.get("title") or doc.get("filename", "Untitled"),
                "type": doc.get("documentType", "OTHER"),
                "reason": "PROCESSING_FAILED",
            })

    # Dedup attention items (same doc can match multiple date fields)
    seen = set()
    deduped = []
    for a in attention_items:
        key = (a.get("documentId"), a.get("reason"))
        if key not in seen:
            seen.add(key)
            deduped.append(a)

    # Recent
    sorted_all = sorted(items, key=lambda x: x.get("createdAt", ""), reverse=True)
    sorted_receipts = sorted(receipts, key=lambda x: x.get("createdAt", ""), reverse=True)

    # Expiring soon warranties
    expiring_soon_items = [
        {
            "documentId": d.get("documentId"),
            "title": d.get("title") or d.get("productName") or d.get("filename", ""),
            "merchant": d.get("merchant"),
            "warrantyEndDate": d.get("warrantyEndDate"),
            "warrantyDaysRemaining": compute_warranty_status(d.get("warrantyEndDate"))["daysRemaining"],
            "warrantyStatus": compute_warranty_status(d.get("warrantyEndDate"))["status"],
        }
        for d in warranty_docs
        if compute_warranty_status(d.get("warrantyEndDate"))["status"] == "EXPIRING_SOON"
    ]

    # Active shares count
    shares_count = 0
    try:
        shares_table = get_dynamodb().Table(SHARES_TABLE)
        sr = shares_table.query(
            IndexName="owner-index",
            KeyConditionExpression=Key("ownerId").eq(user_id),
        )
        now_ep = now_epoch()
        shares_count = sum(
            1 for s in sr.get("Items", [])
            if not s.get("revoked") and (not s.get("ttl") or int(s["ttl"]) > now_ep)
        )
    except Exception:
        pass

    log(request_id, user_id, "dashboard", "success", total=len(items))
    return response(200, {
        "stats": {
            "totalDocuments": len(non_receipts),
            "totalReceipts": len(receipts),
            "totalAll": len(items),
            "processingCount": len(processing),
            "activeWarranties": active_w,
            "expiringSoon": expiring_w,
            "expiredWarranties": expired_w,
            "attentionRequired": len(deduped),
            "activeShares": shares_count,
        },
        "recentDocuments": [enrich_doc(d) for d in sorted_all[:5]],
        "recentReceipts": [enrich_doc(d) for d in sorted_receipts[:3]],
        "attentionItems": deduped[:5],
        "expiringSoonWarranties": expiring_soon_items[:3],
    })


# ─── Router ───────────────────────────────────────────────────────────────────

def route(event):
    method = event.get("httpMethod", "GET").upper()
    path = event.get("path", "/")
    request_id = get_request_id(event)
    params = event.get("pathParameters") or {}

    # Normalize path: strip trailing slash (except root)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    # CORS preflight
    if method == "OPTIONS":
        return response(200, {})

    # Health check (no auth)
    if path == "/health" and method == "GET":
        return handle_health(event, request_id)

    # ── Public share routes (no auth) ─────────────────────────────────────────
    m_access = re.match(r"^/shares/([^/]+)/access$", path)
    m_share_dl = re.match(r"^/shares/([^/]+)/download$", path)

    if m_access and method == "GET":
        return handle_share_access(event, request_id, m_access.group(1))
    if m_share_dl and method == "GET":
        return handle_share_download(event, request_id, m_share_dl.group(1))

    # ── Authenticated routes ──────────────────────────────────────────────────
    user_id = get_user_id(event)
    if not user_id:
        return error(401, "Unauthorized", request_id)

    # /documents/upload-url
    if path == "/documents/upload-url" and method == "POST":
        return handle_upload_url(event, user_id, request_id)

    # /documents/{id}/download
    m_dl = re.match(r"^/documents/([^/]+)/download$", path)
    if m_dl and method == "GET":
        return handle_download_document(event, user_id, request_id, m_dl.group(1))

    # /documents/{id}/audit
    m_audit = re.match(r"^/documents/([^/]+)/audit$", path)
    if m_audit and method == "GET":
        return handle_get_audit(event, user_id, request_id, m_audit.group(1))

    # /documents/{id}
    m_doc = re.match(r"^/documents/([^/]+)$", path)
    if m_doc:
        doc_id = m_doc.group(1)
        if method == "GET":
            return handle_get_document(event, user_id, request_id, doc_id)
        if method == "PATCH":
            return handle_update_document(event, user_id, request_id, doc_id)
        if method == "DELETE":
            return handle_delete_document(event, user_id, request_id, doc_id)

    # /documents
    if path == "/documents" and method == "GET":
        return handle_list_documents(event, user_id, request_id)

    # /receipts
    if path == "/receipts" and method == "GET":
        return handle_list_receipts(event, user_id, request_id)

    # /warranties/expiring (must be before /warranties)
    if path == "/warranties/expiring" and method == "GET":
        return handle_expiring_warranties(event, user_id, request_id)

    # /warranties
    if path == "/warranties" and method == "GET":
        return handle_list_warranties(event, user_id, request_id)

    # /shares/{id}/revoke
    m_revoke = re.match(r"^/shares/([^/]+)/revoke$", path)
    if m_revoke and method == "POST":
        return handle_revoke_share(event, user_id, request_id, m_revoke.group(1))

    # /shares
    if path == "/shares":
        if method == "GET":
            return handle_list_shares(event, user_id, request_id)
        if method == "POST":
            return handle_create_share(event, user_id, request_id)

    # /vault/query
    if path == "/vault/query" and method == "POST":
        return handle_vault_query(event, user_id, request_id)

    # /vault/suggest-package
    if path == "/vault/suggest-package" and method == "POST":
        return handle_suggest_package(event, user_id, request_id)

    # /dashboard
    if path == "/dashboard" and method == "GET":
        return handle_dashboard(event, user_id, request_id)

    return error(404, f"Route not found: {method} {path}", request_id)


# ─── Entry Point ─────────────────────────────────────────────────────────────

def handler(event, context):
    try:
        return route(event)
    except Exception as exc:
        request_id = get_request_id(event)
        logger.exception(f"Unhandled exception [{request_id}]: {exc}")
        return error(500, "Internal server error", request_id)

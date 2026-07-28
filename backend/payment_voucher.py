"""Payment Voucher generation — default professional PDF template.

Every time a Payment Request is finalised by the accounts approver (in
`/api/approvals/act`, request_type='payment'), we auto-generate a signed
PDF voucher that can be downloaded or emailed to the vendor as proof of
payment. The template is coded directly in ReportLab (no external DOCX
required) so it works out-of-the-box.

Layout:
  ┌───────────────────────────────────────────────────────────────┐
  │  [Company Name]                              GST · PAN         │
  │  [Company Address / Contact]                                   │
  │  ─────────────────────────────────────────────────────────────│
  │                    PAYMENT VOUCHER                            │
  │                                                                │
  │  Voucher No: PV-YY-NNNN            Date: 2026-07-28            │
  │  QRN:        XYZ-QRN-0042          Payment Ref: <txn ref>      │
  │                                                                │
  │  ┌─── Payee Details ───────────────────────────────────────┐   │
  │  │ Vendor:            Acme Traders                         │   │
  │  │ Account Holder:    Acme Traders Pvt Ltd                 │   │
  │  │ Bank / Branch:     HDFC Bank, Ranchi                    │   │
  │  │ Account No · IFSC: 12345678 · HDFC0000123               │   │
  │  │ UPI ID:            acme@upi                             │   │
  │  └─────────────────────────────────────────────────────────┘   │
  │                                                                │
  │  ┌─── Amount ──────────────────────────────────────────────┐   │
  │  │ Amount (₹):        45,000.00                             │   │
  │  │ In Words:          Rupees Forty Five Thousand Only       │   │
  │  │ Payment Mode:      NEFT · UTR 234123412342               │   │
  │  └─────────────────────────────────────────────────────────┘   │
  │                                                                │
  │  Purpose / Description:                                        │
  │  Office stationery for Q2 · IT infra upgrade                   │
  │                                                                │
  │  ┌─── Approvals ───────────────────────────────────────────┐   │
  │  │ Level 1 · Center Manager · Ramesh — 26-Jul-2026          │   │
  │  │ Level 2 · Senior Manager · Rakesh  — 27-Jul-2026          │   │
  │  │ Level 3 · Accountant     · Neha    — 28-Jul-2026          │   │
  │  └─────────────────────────────────────────────────────────┘   │
  │                                                                │
  │  Paid By: <Name>                                               │
  │                                                                │
  │  ─────────────────────────────────────────────────────────────│
  │  Prepared By       Approved By       Received By              │
  │  _______________   _______________   _______________          │
  └───────────────────────────────────────────────────────────────┘
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
)

# Reuse the Indian-English amount-to-words helper from salary_slip.
from salary_slip import _amount_to_words  # type: ignore

# Colour palette
_BRAND = colors.HexColor("#1E3A8A")
_BRAND_LIGHT = colors.HexColor("#EEF2FF")
_MUTED = colors.HexColor("#6B7280")
_BORDER = colors.HexColor("#E5E7EB")
_ACCENT = colors.HexColor("#0F172A")
_GREEN = colors.HexColor("#047857")


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "voucher-title", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=18, alignment=TA_CENTER, textColor=_BRAND, spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "voucher-subtitle", parent=base["Normal"], fontName="Helvetica",
            fontSize=9, alignment=TA_CENTER, textColor=_MUTED, spaceAfter=10,
        ),
        "company_name": ParagraphStyle(
            "company-name", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=14, alignment=TA_LEFT, textColor=_ACCENT,
        ),
        "company_line": ParagraphStyle(
            "company-line", parent=base["Normal"], fontName="Helvetica",
            fontSize=8, alignment=TA_LEFT, textColor=_MUTED, leading=11,
        ),
        "section": ParagraphStyle(
            "section", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9, textColor=_BRAND, spaceBefore=6, spaceAfter=3,
            textTransform="uppercase",
        ),
        "label": ParagraphStyle(
            "label", parent=base["Normal"], fontName="Helvetica",
            fontSize=8, textColor=_MUTED,
        ),
        "value": ParagraphStyle(
            "value", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=10, textColor=_ACCENT,
        ),
        "words": ParagraphStyle(
            "words", parent=base["Normal"], fontName="Helvetica-Oblique",
            fontSize=9, textColor=_ACCENT,
        ),
        "footer_line": ParagraphStyle(
            "footer-line", parent=base["Normal"], fontName="Helvetica",
            fontSize=8, alignment=TA_CENTER, textColor=_MUTED,
        ),
        "sig_label": ParagraphStyle(
            "sig-label", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9, alignment=TA_CENTER, textColor=_ACCENT,
        ),
        "amount_big": ParagraphStyle(
            "amount-big", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=16, alignment=TA_RIGHT, textColor=_GREEN,
        ),
    }


def _fmt_inr(amount: float) -> str:
    try:
        n = float(amount)
    except (TypeError, ValueError):
        return "0.00"
    # Indian thousand separator (lakh/crore)
    s = f"{n:,.2f}"
    # simple en-IN grouping: split and regroup manually
    int_part, dec = s.split(".")
    int_part = int_part.replace(",", "")
    neg = int_part.startswith("-")
    if neg:
        int_part = int_part[1:]
    if len(int_part) > 3:
        last3 = int_part[-3:]
        rest = int_part[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        grouped = ",".join(groups) + "," + last3
    else:
        grouped = int_part
    return ("-" if neg else "") + grouped + "." + dec


def _fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        # Accept both "YYYY-MM-DD" and ISO datetime
        d = iso[:10]
        y, m, day = d.split("-")
        return f"{int(day):02d}-{_MONTHS_SHORT[int(m)]}-{y}"
    except Exception:  # noqa: BLE001
        return iso[:10] if iso else "—"


_MONTHS_SHORT = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def build_payment_voucher_pdf(
    payment: Dict[str, Any],
    quotation: Optional[Dict[str, Any]],
    company: Optional[Dict[str, Any]],
    center: Optional[Dict[str, Any]],
    voucher_no: str,
    approval_chain: Optional[list] = None,
    txn_ref: Optional[str] = None,
) -> bytes:
    """Build a payment voucher PDF and return the bytes.

    Callers must provide `payment` (from db.payments), the parent quotation
    (or None), the company/center for the header, an assigned voucher_no
    (e.g. 'PV-26-0042'), and the chain_history array from the approval
    workflow. The PDF is a single-page A4 layout.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Payment Voucher {voucher_no}",
        author=(company or {}).get("name") or "Mashara Finance",
    )
    st = _styles()

    story: list = []

    # ── HEADER: Company block ─────────────────────────────────────────────
    company_name = (company or {}).get("name") or "Mashara Skills"
    company_lines = []
    if (company or {}).get("address"):
        company_lines.append(company["address"])
    ct = []
    if (company or {}).get("gst"):
        ct.append(f"GSTIN: {company['gst']}")
    if (company or {}).get("pan"):
        ct.append(f"PAN: {company['pan']}")
    if ct:
        company_lines.append(" · ".join(ct))
    if (center or {}).get("name"):
        company_lines.append(f"Center: {center['name']}")

    header_left = [Paragraph(company_name, st["company_name"])]
    for line in company_lines:
        header_left.append(Paragraph(line, st["company_line"]))

    header_tbl = Table(
        [[header_left, Paragraph(
            f'<font color="#6B7280">Generated</font><br/>'
            f'<b>{_fmt_date(datetime.now(timezone.utc).isoformat())}</b>',
            st["company_line"])]],
        colWidths=[130 * mm, 40 * mm],
    )
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_tbl)

    # Thick divider
    story.append(Spacer(1, 4 * mm))
    divider = Table([[""]], colWidths=[174 * mm], rowHeights=[1])
    divider.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _BRAND),
        ("LINEBELOW", (0, 0), (-1, -1), 1, _BRAND),
    ]))
    story.append(divider)

    story.append(Spacer(1, 6 * mm))

    # ── TITLE ────────────────────────────────────────────────────────────
    story.append(Paragraph("PAYMENT VOUCHER", st["title"]))
    story.append(Paragraph(
        "Proof of Payment — issued upon final approval by Accounts",
        st["subtitle"],
    ))

    # ── VOUCHER META ─────────────────────────────────────────────────────
    meta = [
        [Paragraph("Voucher No.", st["label"]),
         Paragraph(f"<b>{voucher_no}</b>", st["value"]),
         Paragraph("Payment Date", st["label"]),
         Paragraph(f"<b>{_fmt_date(payment.get('payment_date') or payment.get('paid_at'))}</b>", st["value"])],
        [Paragraph("QRN", st["label"]),
         Paragraph((payment.get("qrn") or (quotation or {}).get("qrn") or "—"), st["value"]),
         Paragraph("Payment Mode", st["label"]),
         Paragraph((payment.get("payment_mode") or "—").upper(), st["value"])],
    ]
    if txn_ref or payment.get("notes"):
        meta.append([
            Paragraph("Payment Reference", st["label"]),
            Paragraph(txn_ref or payment.get("notes") or "—", st["value"]),
            Paragraph("Category", st["label"]),
            Paragraph((payment.get("category") or "expense").upper(), st["value"]),
        ])
    meta_tbl = Table(meta, colWidths=[30 * mm, 55 * mm, 30 * mm, 59 * mm])
    meta_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, _BORDER),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 6 * mm))

    # ── PAYEE DETAILS ────────────────────────────────────────────────────
    story.append(Paragraph("PAYEE DETAILS", st["section"]))
    payee_rows = [
        ["Vendor / Payee",
         payment.get("vendor_name") or (quotation or {}).get("vendor_name") or "—"],
    ]
    if payment.get("payee_account_holder"):
        payee_rows.append(["Account Holder", payment["payee_account_holder"]])
    if payment.get("payee_bank_name"):
        payee_rows.append(["Bank Name", payment["payee_bank_name"]])
    if payment.get("payee_account_no"):
        payee_rows.append(["Account Number", payment["payee_account_no"]])
    if payment.get("payee_ifsc"):
        payee_rows.append(["IFSC Code", payment["payee_ifsc"]])
    if payment.get("payee_upi_id"):
        payee_rows.append(["UPI ID", payment["payee_upi_id"]])

    payee_tbl = Table(payee_rows, colWidths=[45 * mm, 129 * mm])
    payee_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (0, -1), _BRAND_LIGHT),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), _BRAND),
        ("TEXTCOLOR", (1, 0), (1, -1), _ACCENT),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("BOX", (0, 0), (-1, -1), 0.5, _BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, _BORDER),
    ]))
    story.append(payee_tbl)

    story.append(Spacer(1, 6 * mm))

    # ── AMOUNT ───────────────────────────────────────────────────────────
    amt = float(payment.get("actual_amount") or 0)
    amount_tbl = Table([
        [Paragraph("AMOUNT PAID (₹)", st["section"]),
         Paragraph(f"₹ {_fmt_inr(amt)}", st["amount_big"])],
        [Paragraph("In Words", st["label"]),
         Paragraph(_amount_to_words(amt), st["words"])],
    ], colWidths=[100 * mm, 74 * mm])
    amount_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _BRAND_LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.75, _BRAND),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("SPAN", (0, 0), (0, 0)),
    ]))
    story.append(amount_tbl)

    story.append(Spacer(1, 6 * mm))

    # ── PURPOSE ──────────────────────────────────────────────────────────
    purpose = (payment.get("description") or (quotation or {}).get("description")
               or (quotation or {}).get("purpose") or "—")
    story.append(Paragraph("PURPOSE / DESCRIPTION", st["section"]))
    story.append(Paragraph(purpose, st["value"]))

    story.append(Spacer(1, 6 * mm))

    # ── APPROVAL CHAIN ───────────────────────────────────────────────────
    if approval_chain:
        story.append(Paragraph("APPROVAL CHAIN", st["section"]))
        # chain_history entries: {level, action, by_user_name, at, remarks}
        rows = [["Level", "Approver", "Action", "Date", "Remarks"]]
        for h in approval_chain:
            action = (h.get("action") or "").replace("_", " ").title()
            rows.append([
                str(h.get("level") or "—"),
                (h.get("by_user_name") or "—"),
                action or "Approved",
                _fmt_date(h.get("at")),
                (h.get("remarks") or "—")[:40],
            ])
        ct = Table(rows, colWidths=[15 * mm, 44 * mm, 30 * mm, 30 * mm, 55 * mm])
        ct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("GRID", (0, 0), (-1, -1), 0.25, _BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ]))
        story.append(ct)

    story.append(Spacer(1, 4 * mm))
    if payment.get("paid_by_name"):
        story.append(Paragraph(
            f'<font color="#6B7280">Paid By:</font> <b>{payment["paid_by_name"]}</b>',
            st["value"],
        ))

    # ── SIGNATURES FOOTER ────────────────────────────────────────────────
    story.append(Spacer(1, 14 * mm))

    sig_tbl = Table([
        ["_______________________", "_______________________", "_______________________"],
        [Paragraph("Prepared By", st["sig_label"]),
         Paragraph("Approved By", st["sig_label"]),
         Paragraph("Received By", st["sig_label"])],
        [Paragraph("Accounts", st["footer_line"]),
         Paragraph("Authorised Signatory", st["footer_line"]),
         Paragraph("Vendor / Payee", st["footer_line"])],
    ], colWidths=[58 * mm, 58 * mm, 58 * mm])
    sig_tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 1), (-1, 1), 3),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 0),
    ]))
    story.append(sig_tbl)

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        f'This is a system-generated voucher. Voucher No. <b>{voucher_no}</b> · '
        f'Payment ID <font face="Courier">{payment.get("id", "")[:12]}</font>',
        st["footer_line"],
    ))

    doc.build(story)
    return buf.getvalue()


def build_payment_voucher_filename(voucher_no: str, vendor: Optional[str]) -> str:
    """Return a safe filename like `PV-26-0042_Acme-Traders.pdf`."""
    v = "".join(ch for ch in (vendor or "voucher") if ch.isalnum() or ch in "-_")
    v = v[:24] or "voucher"
    return f"{voucher_no}_{v}.pdf"


def storage_path_for_voucher(voucher_id: str, voucher_no: str) -> str:
    """Local file storage path: `/tmp/payment_vouchers/<voucher_id>.pdf`."""
    root = os.environ.get("VOUCHER_STORAGE_ROOT", "/tmp/payment_vouchers")
    os.makedirs(root, exist_ok=True)
    return os.path.join(root, f"{voucher_id}.pdf")

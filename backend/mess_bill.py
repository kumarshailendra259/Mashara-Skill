"""Mess Purchase Bill generation.

Auto-generated the moment a Mess Payment is finally approved. Produces a
professional single-page A4 purchase bill (ReportLab default) OR, if an
admin has uploaded a `.docx` template under HR Settings → Mess Bill, renders
that template with docxtpl (Jinja-style) and converts to PDF via LibreOffice
— exactly mirroring the salary-slip template pipeline.

Template placeholders (DOCX)
----------------------------
Scalars : bill_no, invoice_no, invoice_date, payment_date, payment_mode,
          supplier_name, vendor_name, center_name, company_name,
          company_address, company_gst, company_pan, total_amount,
          total_words, paid_by_name, generated_at, today
Loop    : {% for ln in lines %} ln.item_name, ln.qty, ln.unit, ln.unit_price,
          ln.line_total, ln.accepted_qty, ln.accepted_cost {% endfor %}
Approvals: {% for a in approvals %} a.level, a.by_user_name, a.action, a.at,
           a.remarks {% endfor %}
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from salary_slip import _amount_to_words  # type: ignore

logger = logging.getLogger(__name__)

_BRAND = colors.HexColor("#155EEF")
_BRAND_LIGHT = colors.HexColor("#EEF4FF")
_MUTED = colors.HexColor("#6B7280")
_BORDER = colors.HexColor("#E5E7EB")
_ACCENT = colors.HexColor("#0F172A")
_GREEN = colors.HexColor("#047857")

_MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("mb-title", parent=base["Normal"], fontName="Helvetica-Bold",
                                fontSize=18, alignment=TA_CENTER, textColor=_BRAND, spaceAfter=4),
        "subtitle": ParagraphStyle("mb-subtitle", parent=base["Normal"], fontName="Helvetica",
                                   fontSize=9, alignment=TA_CENTER, textColor=_MUTED, spaceAfter=10),
        "company_name": ParagraphStyle("mb-cname", parent=base["Normal"], fontName="Helvetica-Bold",
                                       fontSize=14, alignment=TA_LEFT, textColor=_ACCENT),
        "company_line": ParagraphStyle("mb-cline", parent=base["Normal"], fontName="Helvetica",
                                       fontSize=8, alignment=TA_LEFT, textColor=_MUTED, leading=11),
        "section": ParagraphStyle("mb-section", parent=base["Normal"], fontName="Helvetica-Bold",
                                  fontSize=9, textColor=_BRAND, spaceBefore=6, spaceAfter=3),
        "label": ParagraphStyle("mb-label", parent=base["Normal"], fontName="Helvetica",
                                fontSize=8, textColor=_MUTED),
        "value": ParagraphStyle("mb-value", parent=base["Normal"], fontName="Helvetica-Bold",
                                fontSize=10, textColor=_ACCENT),
        "words": ParagraphStyle("mb-words", parent=base["Normal"], fontName="Helvetica-Oblique",
                                fontSize=9, textColor=_ACCENT),
        "footer_line": ParagraphStyle("mb-footer", parent=base["Normal"], fontName="Helvetica",
                                      fontSize=8, alignment=TA_CENTER, textColor=_MUTED),
        "sig_label": ParagraphStyle("mb-sig", parent=base["Normal"], fontName="Helvetica-Bold",
                                    fontSize=9, alignment=TA_CENTER, textColor=_ACCENT),
        "amount_big": ParagraphStyle("mb-amt", parent=base["Normal"], fontName="Helvetica-Bold",
                                     fontSize=16, alignment=TA_RIGHT, textColor=_GREEN),
        "cell": ParagraphStyle("mb-cell", parent=base["Normal"], fontName="Helvetica",
                               fontSize=8, textColor=_ACCENT, leading=10),
    }


def _fmt_inr(amount: Any) -> str:
    try:
        n = float(amount)
    except (TypeError, ValueError):
        return "0.00"
    s = f"{n:,.2f}"
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
        d = iso[:10]
        y, m, day = d.split("-")
        return f"{int(day):02d}-{_MONTHS_SHORT[int(m)]}-{y}"
    except Exception:  # noqa: BLE001
        return iso[:10] if iso else "—"


def build_mess_bill_pdf(
    receipt: Dict[str, Any],
    payment: Optional[Dict[str, Any]],
    company: Optional[Dict[str, Any]],
    center: Optional[Dict[str, Any]],
    bill_no: str,
    approval_chain: Optional[list] = None,
) -> bytes:
    """Return the purchase-bill PDF bytes (default ReportLab template)."""
    payment = payment or {}
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Mess Purchase Bill {bill_no}",
        author=(company or {}).get("name") or "Mashara Finance",
    )
    st = _styles()
    story: list = []

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
            f'<font color="#6B7280">Generated</font><br/><b>{_fmt_date(datetime.now(timezone.utc).isoformat())}</b>',
            st["company_line"])]],
        colWidths=[130 * mm, 44 * mm],
    )
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_tbl)

    story.append(Spacer(1, 4 * mm))
    divider = Table([[""]], colWidths=[174 * mm], rowHeights=[1])
    divider.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), _BRAND)]))
    story.append(divider)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("MESS PURCHASE BILL", st["title"]))
    story.append(Paragraph("Goods Receipt — issued upon final payment approval", st["subtitle"]))

    meta = [
        [Paragraph("Bill No.", st["label"]), Paragraph(f"<b>{bill_no}</b>", st["value"]),
         Paragraph("Invoice No.", st["label"]), Paragraph(f"<b>{receipt.get('invoice_no') or '—'}</b>", st["value"])],
        [Paragraph("Invoice Date", st["label"]), Paragraph(_fmt_date(receipt.get("invoice_date")), st["value"]),
         Paragraph("Payment Date", st["label"]),
         Paragraph(_fmt_date(payment.get("payment_date") or payment.get("paid_at")), st["value"])],
        [Paragraph("Supplier", st["label"]), Paragraph(receipt.get("supplier_name") or "—", st["value"]),
         Paragraph("Payment Mode", st["label"]), Paragraph((payment.get("payment_mode") or "—").upper(), st["value"])],
    ]
    meta_tbl = Table(meta, colWidths=[28 * mm, 59 * mm, 28 * mm, 59 * mm])
    meta_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, _BORDER),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 6 * mm))

    # ── ITEMS TABLE ──────────────────────────────────────────────────────
    story.append(Paragraph("ITEMS RECEIVED", st["section"]))
    rows = [["#", "Item", "Qty", "Unit", "Rate", "Accepted", "Amount"]]
    for idx, ln in enumerate(receipt.get("lines") or [], start=1):
        rows.append([
            str(idx),
            Paragraph(str(ln.get("item_name") or ln.get("item_id") or "—"), st["cell"]),
            _fmt_inr(ln.get("qty")),
            str(ln.get("unit") or ""),
            _fmt_inr(ln.get("unit_price")),
            _fmt_inr(ln.get("accepted_qty")),
            _fmt_inr(ln.get("accepted_cost") if ln.get("accepted_cost") is not None else ln.get("line_total")),
        ])
    items_tbl = Table(rows, colWidths=[8 * mm, 60 * mm, 20 * mm, 18 * mm, 22 * mm, 22 * mm, 24 * mm])
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (3, 1), (3, -1), "CENTER"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(items_tbl)
    story.append(Spacer(1, 6 * mm))

    amt = float(receipt.get("total_amount") or 0)
    amount_tbl = Table([
        [Paragraph("TOTAL AMOUNT (₹)", st["section"]), Paragraph(f"₹ {_fmt_inr(amt)}", st["amount_big"])],
        [Paragraph("In Words", st["label"]), Paragraph(_amount_to_words(amt), st["words"])],
    ], colWidths=[100 * mm, 74 * mm])
    amount_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _BRAND_LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.75, _BRAND),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(amount_tbl)
    story.append(Spacer(1, 6 * mm))

    if approval_chain:
        story.append(Paragraph("APPROVAL TRAIL", st["section"]))
        arows = [["Level", "Approver", "Action", "Date"]]
        for h in approval_chain:
            arows.append([
                str(h.get("level") or "—"),
                Paragraph(str(h.get("by_user_name") or "—"), st["cell"]),
                (h.get("action") or "approve").replace("_", " ").title(),
                _fmt_date(h.get("at")),
            ])
        at = Table(arows, colWidths=[18 * mm, 70 * mm, 40 * mm, 46 * mm])
        at.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.25, _BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(at)

    story.append(Spacer(1, 4 * mm))
    if payment.get("paid_by_name"):
        story.append(Paragraph(
            f'<font color="#6B7280">Paid By:</font> <b>{payment["paid_by_name"]}</b>', st["value"]))

    story.append(Spacer(1, 12 * mm))
    sig_tbl = Table([
        ["_______________________", "_______________________", "_______________________"],
        [Paragraph("Prepared By", st["sig_label"]), Paragraph("Approved By", st["sig_label"]),
         Paragraph("Received By", st["sig_label"])],
        [Paragraph("Mess / Accounts", st["footer_line"]), Paragraph("Authorised Signatory", st["footer_line"]),
         Paragraph("Supplier / Vendor", st["footer_line"])],
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
        f'This is a system-generated purchase bill. Bill No. <b>{bill_no}</b> · '
        f'Receipt <font face="Courier">{(receipt.get("id") or "")[:12]}</font>',
        st["footer_line"]))

    doc.build(story)
    return buf.getvalue()


def build_mess_bill_context(
    receipt: Dict[str, Any], payment: Optional[Dict[str, Any]],
    company: Dict[str, Any], center: Optional[dict], bill_no: str,
) -> dict:
    payment = payment or {}
    total = float(receipt.get("total_amount") or 0)
    lines: List[dict] = []
    for ln in receipt.get("lines") or []:
        lines.append({
            "item_name": ln.get("item_name") or "",
            "qty": ln.get("qty") or 0,
            "unit": ln.get("unit") or "",
            "unit_price": ln.get("unit_price") or 0,
            "accepted_qty": ln.get("accepted_qty") or 0,
            "accepted_cost": ln.get("accepted_cost") if ln.get("accepted_cost") is not None else ln.get("line_total") or 0,
            "line_total": ln.get("line_total") or 0,
        })
    approvals = []
    for h in (payment.get("chain_history") or []):
        approvals.append({
            "level": h.get("level"), "by_user_name": h.get("by_user_name"),
            "action": (h.get("action") or "approve"), "at": (h.get("at") or "")[:10],
            "remarks": h.get("remarks") or "",
        })
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "bill_no": bill_no,
        "invoice_no": receipt.get("invoice_no") or "",
        "invoice_date": receipt.get("invoice_date") or "",
        "payment_date": payment.get("payment_date") or payment.get("paid_at") or "",
        "payment_mode": (payment.get("payment_mode") or "").upper(),
        "supplier_name": receipt.get("supplier_name") or "",
        "vendor_name": receipt.get("supplier_name") or "",
        "center_name": (center or {}).get("name") or receipt.get("center_name") or "",
        "company_name": (company or {}).get("name") or "",
        "company_address": (company or {}).get("address") or "",
        "company_gst": (company or {}).get("gst") or "",
        "company_pan": (company or {}).get("pan") or "",
        "total_amount": total,
        "total_words": _amount_to_words(total),
        "paid_by_name": payment.get("paid_by_name") or "",
        "lines": lines,
        "approvals": approvals,
        "generated_at": now_iso,
        "today": datetime.now(timezone.utc).strftime("%d %b %Y"),
    }


def _docx_to_pdf(docx_path: str, out_dir: str) -> Optional[str]:
    try:
        subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
            check=True, capture_output=True, timeout=45,
        )
        for f in os.listdir(out_dir):
            if f.endswith(".pdf"):
                return os.path.join(out_dir, f)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("LibreOffice PDF conversion failed: %s", e)
    return None


def render_mess_bill(template_bytes: bytes, context: dict) -> tuple[bytes, str, str]:
    """Render an uploaded DOCX bill template; return (bytes, mime, ext).
    Falls back to DOCX if LibreOffice is unavailable."""
    from docxtpl import DocxTemplate
    with tempfile.TemporaryDirectory() as tmpd:
        src = os.path.join(tmpd, "bill_tpl.docx")
        with open(src, "wb") as f:
            f.write(template_bytes)
        tpl = DocxTemplate(src)
        tpl.render(context)
        rendered = os.path.join(tmpd, "mess_bill.docx")
        tpl.save(rendered)
        pdf_path = _docx_to_pdf(rendered, tmpd)
        if pdf_path:
            with open(pdf_path, "rb") as f:
                return f.read(), "application/pdf", "pdf"
        with open(rendered, "rb") as f:
            return (f.read(),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "docx")

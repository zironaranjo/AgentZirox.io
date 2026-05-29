#!/usr/bin/env python3
"""
Marketing Audit PDF Generator — AgenteZirox
Usage: python3 marketing_pdf.py <input.json> <output.pdf>

Input JSON:
{
  "url": "https://example.com",
  "overall_score": 72,
  "dimensions": {
    "copy":       { "score": 75, "summary": "...", "findings": [...], "quick_wins": [...] },
    "seo":        { ... },
    "conversion": { ... },
    "brand":      { ... },
    "strategy":   { ... }
  }
}
"""

import sys
import json
from datetime import datetime

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.colors import HexColor, white, black
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                     Table, TableStyle, HRFlowable, KeepTogether)
    REPORTLAB = True
except ImportError:
    REPORTLAB = False


PRIMARY    = None if not REPORTLAB else HexColor("#0F0F1A")
ACCENT     = None if not REPORTLAB else HexColor("#8B5CF6")
ACCENT2    = None if not REPORTLAB else HexColor("#0EA5E9")
LIGHT_BG   = None if not REPORTLAB else HexColor("#F5F7FA")
BORDER     = None if not REPORTLAB else HexColor("#E2E8F0")
TEXT       = None if not REPORTLAB else HexColor("#1E293B")
TEXT_LIGHT = None if not REPORTLAB else HexColor("#64748B")


def score_hex(s):
    if s >= 80: return "#10B981"
    if s >= 60: return "#8B5CF6"
    if s >= 40: return "#F59E0B"
    return "#EF4444"

def score_label(s):
    if s >= 80: return "Excelente"
    if s >= 60: return "Bueno"
    if s >= 40: return "Regular"
    return "Crítico"

def score_emoji(s):
    if s >= 80: return "🟢"
    if s >= 60: return "🟣"
    if s >= 40: return "🟡"
    return "🔴"


def build_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=22,
                                 textColor=PRIMARY, spaceAfter=4, alignment=TA_CENTER),
        "subtitle": ParagraphStyle("subtitle", fontName="Helvetica", fontSize=11,
                                    textColor=TEXT_LIGHT, spaceAfter=2, alignment=TA_CENTER),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13,
                              textColor=PRIMARY, spaceAfter=6, spaceBefore=14),
        "h3": ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10,
                              textColor=ACCENT, spaceAfter=4, spaceBefore=8),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9,
                                textColor=TEXT, spaceAfter=3, leading=13),
        "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=9,
                                  textColor=TEXT, leftIndent=10, spaceAfter=2, leading=13),
        "footer": ParagraphStyle("footer", fontName="Helvetica", fontSize=8,
                                  textColor=TEXT_LIGHT, alignment=TA_CENTER),
    }


def generate_pdf(data: dict, output_path: str):
    if not REPORTLAB:
        raise RuntimeError("reportlab no instalado. Ejecuta: pip install reportlab")

    S = build_styles()
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                             rightMargin=2*cm, leftMargin=2*cm,
                             topMargin=2*cm, bottomMargin=2*cm)
    story = []

    url           = data.get("url", "")
    overall       = int(data.get("overall_score", 0))
    dimensions    = data.get("dimensions", {})
    date_str      = datetime.now().strftime("%d/%m/%Y %H:%M")

    DIM_NAMES = {
        "copy":       "Copywriting & Mensajes",
        "seo":        "SEO On-Page",
        "conversion": "Conversión (CRO)",
        "brand":      "Identidad de Marca",
        "strategy":   "Estrategia Digital",
    }

    # ── Header ──────────────────────────────────────────────────────────────
    story.append(Paragraph("Auditoría de Marketing Digital", S["title"]))
    story.append(Paragraph(url, S["subtitle"]))
    story.append(Paragraph(f"Generado el {date_str}  ·  AgenteZirox · zirox.io", S["subtitle"]))
    story.append(Spacer(1, 0.3*cm))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT))
    story.append(Spacer(1, 0.4*cm))

    # ── Overall score ────────────────────────────────────────────────────────
    sc = HexColor(score_hex(overall))
    overall_table = Table([[
        Paragraph(f'<font color="{score_hex(overall)}" size="38"><b>{overall}</b></font><font size="16">/100</font>',
                  ParagraphStyle("sc", fontName="Helvetica-Bold", fontSize=38,
                                  textColor=sc, alignment=TA_CENTER)),
        Paragraph(f'<font color="{score_hex(overall)}"><b>{score_label(overall)}</b></font><br/>'
                  f'<font color="#64748B" size="9">Puntuación Global</font>',
                  ParagraphStyle("lb", fontName="Helvetica-Bold", fontSize=20,
                                  textColor=sc, alignment=TA_LEFT, leading=26)),
    ]], colWidths=[5*cm, 11*cm])
    overall_table.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), LIGHT_BG),
        ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 16),
        ("TOPPADDING",  (0,0), (-1,-1), 12),
        ("BOTTOMPADDING",(0,0),(-1,-1), 12),
        ("ROUNDEDCORNERS", [8]),
    ]))
    story.append(overall_table)
    story.append(Spacer(1, 0.5*cm))

    # ── Dimension summary table ──────────────────────────────────────────────
    story.append(Paragraph("Resumen por Dimensión", S["h2"]))

    rows = [[
        Paragraph("<b>Dimensión</b>", ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=9,
                                                      textColor=white, alignment=TA_LEFT)),
        Paragraph("<b>Score</b>",     ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=9,
                                                      textColor=white, alignment=TA_CENTER)),
        Paragraph("<b>Estado</b>",    ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=9,
                                                      textColor=white, alignment=TA_CENTER)),
        Paragraph("<b>Resumen</b>",   ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=9,
                                                      textColor=white, alignment=TA_LEFT)),
    ]]
    for key, name in DIM_NAMES.items():
        if key not in dimensions:
            continue
        d = dimensions[key]
        s = int(d.get("score", 0))
        ch = score_hex(s)
        rows.append([
            Paragraph(name, S["body"]),
            Paragraph(f'<font color="{ch}"><b>{s}</b></font>', ParagraphStyle("sc2",
                       fontName="Helvetica-Bold", fontSize=11, alignment=TA_CENTER)),
            Paragraph(f'<font color="{ch}">{score_label(s)}</font>', ParagraphStyle("st",
                       fontName="Helvetica", fontSize=9, alignment=TA_CENTER)),
            Paragraph(d.get("summary", "")[:120], S["body"]),
        ])

    dim_table = Table(rows, colWidths=[4.5*cm, 2*cm, 2.5*cm, 7*cm])
    dim_table.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,0),  PRIMARY),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [white, LIGHT_BG]),
        ("GRID",          (0,0), (-1,-1), 0.5, BORDER),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING",   (0,0), (-1,-1), 8),
        ("TOPPADDING",    (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(dim_table)
    story.append(Spacer(1, 0.6*cm))

    # ── Detail per dimension ─────────────────────────────────────────────────
    for key, name in DIM_NAMES.items():
        if key not in dimensions:
            continue
        d   = dimensions[key]
        s   = int(d.get("score", 0))
        ch  = score_hex(s)

        header_row = [[
            Paragraph(f'<font color="#FFFFFF"><b>{name}</b></font>', ParagraphStyle("dh",
                       fontName="Helvetica-Bold", fontSize=11, textColor=white)),
            Paragraph(f'<font color="{ch}"><b>{s}/100 — {score_label(s)}</b></font>',
                      ParagraphStyle("ds", fontName="Helvetica-Bold", fontSize=11,
                                      textColor=HexColor(ch), alignment=TA_RIGHT)),
        ]]
        ht = Table(header_row, colWidths=[9*cm, 7*cm])
        ht.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (-1,-1), PRIMARY),
            ("LEFTPADDING",   (0,0), (-1,-1), 10),
            ("RIGHTPADDING",  (0,0), (-1,-1), 10),
            ("TOPPADDING",    (0,0), (-1,-1), 8),
            ("BOTTOMPADDING", (0,0), (-1,-1), 8),
            ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
        ]))

        block = [ht, Spacer(1, 0.2*cm)]

        summary = d.get("summary", "")
        if summary:
            block.append(Paragraph(summary, S["body"]))
            block.append(Spacer(1, 0.2*cm))

        findings = d.get("findings", [])
        if findings:
            block.append(Paragraph("Hallazgos", S["h3"]))
            for f in findings:
                block.append(Paragraph(f"• {f}", S["bullet"]))
            block.append(Spacer(1, 0.1*cm))

        quick_wins = d.get("quick_wins", [])
        if quick_wins:
            block.append(Paragraph("Acciones Prioritarias", S["h3"]))
            for i, qw in enumerate(quick_wins, 1):
                block.append(Paragraph(f"{i}. {qw}", S["bullet"]))

        block.append(Spacer(1, 0.4*cm))
        story.append(KeepTogether(block))

    # ── Footer ───────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER))
    story.append(Spacer(1, 0.2*cm))
    story.append(Paragraph(
        "Generado por AgenteZirox · zirox.io  ·  Datos públicos analizados con IA",
        S["footer"]
    ))

    doc.build(story)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: marketing_pdf.py <input.json> <output.pdf>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], encoding="utf-8") as f:
        payload = json.load(f)

    generate_pdf(payload, sys.argv[2])
    print(f"OK:{sys.argv[2]}")

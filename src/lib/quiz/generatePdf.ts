import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import type { QuizResult } from "@/lib/quiz/engine";
import type { CurrencyCode } from "@/lib/quiz/currency";
import { formatPrice } from "@/lib/quiz/currency";
import { getAffiliateLink } from "@/data/quiz/affiliateLinks";
import { getT } from "@/data/quiz/translations";
import type { Lang } from "@/data/quiz/translations";

const BRAND = { r: 16, g: 185, b: 129 };
const DARK = { r: 12, g: 46, b: 30 };
const GRAY = { r: 107, g: 114, b: 128 };
const LIGHT = { r: 240, g: 253, b: 244 };
const WHITE = { r: 255, g: 255, b: 255 };
const PAGE_W = 210;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

type RGB = { r: number; g: number; b: number };
function setFill(doc: jsPDF, c: RGB) { doc.setFillColor(c.r, c.g, c.b); }
function setRGB(doc: jsPDF, c: RGB) { doc.setTextColor(c.r, c.g, c.b); }

export async function generatePdf(element: HTMLElement, result: QuizResult, currency: CurrencyCode, language: Lang) {
  await document.fonts.ready;

  const canvas = await html2canvas(element, {
    scale: 3,
    useCORS: true,
    backgroundColor: "#faf9f6",
    logging: false,
  });

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageH = 297;
  const imgW = PAGE_W;
  const imgH = (canvas.height * imgW) / canvas.width;
  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  let remaining = imgH;
  let offset = 0;
  while (remaining > 0) {
    pdf.addImage(imgData, "JPEG", 0, offset, imgW, imgH);
    remaining -= pageH;
    if (remaining > 0) {
      offset -= pageH;
      pdf.addPage();
    }
  }

  // ── Shopping list page ───────────────────────────────────────
  const supplementsWithLinks = result.stack
    .map((item) => ({
      name: item.supplement.name,
      costTier: item.supplement.costTier,
      priority: item.priority,
      url: getAffiliateLink(item.supplement.id, currency),
    }))
    .filter((s) => s.url !== null) as { name: string; costTier: string; priority: string; url: string }[];

  if (supplementsWithLinks.length === 0) return pdf.save("nutripedia-supplement-plan.pdf");

  pdf.addPage();

  // Header
  setFill(pdf, DARK);
  pdf.rect(0, 0, PAGE_W, 36, "F");

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  setRGB(pdf, BRAND);
  pdf.text("NUTRIPEDIA", MARGIN, 13);

  pdf.setFontSize(20);
  pdf.setFont("helvetica", "bold");
  setRGB(pdf, WHITE);
  pdf.text("Your Shopping List", MARGIN, 26);

  let y = 50;

  const priceEstimates: Record<string, number> = { "$": 10, "$$": 22, "$$$": 40 };

  for (const item of supplementsWithLinks) {
    const rowH = 18;
    if (y + rowH > 280) break;

    // Row background
    setFill(pdf, LIGHT);
    pdf.setDrawColor(187, 247, 208);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(MARGIN, y - 5, CONTENT_W, rowH, 2, 2, "FD");

    // Supplement name
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    setRGB(pdf, DARK);
    pdf.text(item.name, MARGIN + 5, y + 5);

    // Price estimate
    const price = priceEstimates[item.costTier] || 20;
    const t = getT(language).ui.results;
    const priceStr = `~${formatPrice(price, currency)}${t.perMonth}`;
    pdf.setFontSize(8.5);
    pdf.setFont("helvetica", "normal");
    setRGB(pdf, GRAY);
    pdf.text(priceStr, MARGIN + 5, y + 10.5);

    // "View on Amazon →" link — right side
    const linkLabel = "View on Amazon →";
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    setRGB(pdf, BRAND);
    const labelW = pdf.getTextWidth(linkLabel);
    const labelX = PAGE_W - MARGIN - labelW;
    pdf.text(linkLabel, labelX, y + 6);

    // Underline
    pdf.setDrawColor(BRAND.r, BRAND.g, BRAND.b);
    pdf.setLineWidth(0.3);
    pdf.line(labelX, y + 7, labelX + labelW, y + 7);

    // Clickable link annotation
    pdf.link(labelX, y - 4, labelW, rowH, { url: item.url });

    y += rowH + 4;
  }

  // Affiliate disclaimer
  y += 6;
  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "italic");
  setRGB(pdf, GRAY);
  pdf.text("Links are affiliate links — we may earn a small commission at no extra cost to you.", MARGIN, y);

  // Footer
  setFill(pdf, DARK);
  pdf.rect(0, 290, PAGE_W, 10, "F");
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  setRGB(pdf, BRAND);
  pdf.text("nutripedia.co — For informational purposes only. Not medical advice.", MARGIN, 296);

  pdf.save("nutripedia-supplement-plan.pdf");
}

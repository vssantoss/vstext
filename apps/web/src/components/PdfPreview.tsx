import { FileText } from "lucide-react";

interface PdfPreviewProps {
  url: string | null;
  name: string;
  error?: string | null;
}

export function PdfPreview({ url, name, error }: PdfPreviewProps) {
  if (error) {
    return (
      <div className="pdf-preview pdf-preview--empty">
        <FileText size={32} strokeWidth={1.4} className="pdf-preview__icon" />
        <p className="pdf-preview__title">Cannot open PDF</p>
        <p className="pdf-preview__hint">{error}</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="pdf-preview pdf-preview--empty">
        <FileText size={32} strokeWidth={1.4} className="pdf-preview__icon" />
        <p className="pdf-preview__title">Loading PDF…</p>
      </div>
    );
  }

  return (
    <iframe
      className="pdf-preview__frame"
      src={url}
      title={`${name} PDF preview`}
      aria-label={`${name} PDF preview`}
    />
  );
}

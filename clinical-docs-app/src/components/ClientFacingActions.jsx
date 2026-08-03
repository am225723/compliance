/**
 * Copy / email / (for Psychoeducation) PDF-handout actions for a generated
 * document's patient-facing sections. Self-hides when the document has
 * none — matched by heading text (see lib/clientFacingSections.js), not by
 * document type, so it works regardless of which page renders it.
 */
import { useState } from 'react';
import { Copy, CheckCircle2, Mail, FileDown, Loader2 } from 'lucide-react';
import { extractAllClientFacingSections } from '../lib/clientFacingSections';
import { buildGmailComposeUrl } from '../lib/gmailCompose';
import { buildPsychoeducationHandoutPdf } from '../lib/psychoeducationHandout';

export default function ClientFacingActions({ documentHtml, patientName }) {
  const [copiedTitle, setCopiedTitle] = useState(null);
  const [downloadingTitle, setDownloadingTitle] = useState(null);
  const [handoutError, setHandoutError] = useState(null);

  const sections = extractAllClientFacingSections(documentHtml);
  if (sections.length === 0) return null;

  async function handleCopy(section) {
    try {
      await navigator.clipboard.writeText(section.text);
      setCopiedTitle(section.title);
      setTimeout(() => setCopiedTitle(t => (t === section.title ? null : t)), 2000);
    } catch {
      // Clipboard permission denied/unavailable — nothing else to fall back
      // to here; the section text is still visible for manual selection.
    }
  }

  function handleEmail(section) {
    const subject = patientName ? `${section.title} — ${patientName}` : section.title;
    window.open(buildGmailComposeUrl({ subject, body: section.text }), '_blank', 'noopener,noreferrer');
  }

  async function handleDownloadHandout(section) {
    setHandoutError(null);
    setDownloadingTitle(section.title);
    try {
      const blob = await buildPsychoeducationHandoutPdf({
        sectionHtml: section.html, sectionText: section.text, patientName,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(patientName || 'patient').replace(/\s+/g, '_')}_Psychoeducation_Handout.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setHandoutError(e.message);
    } finally {
      setDownloadingTitle(null);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Patient-Facing Materials</p>
      {sections.map(section => (
        <div key={section.title} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-300">{section.title}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => handleCopy(section)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={`Copy ${section.title}`}
              >
                {copiedTitle === section.title
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                {copiedTitle === section.title ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => handleEmail(section)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={`Open ${section.title} in Gmail`}
                title="Opens a prefilled draft in your own Gmail — nothing is sent by this app"
              >
                <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Gmail
              </button>
              {section.title === 'Client-Facing Psychoeducation' && (
                <button
                  onClick={() => handleDownloadHandout(section)}
                  disabled={downloadingTitle === section.title}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                  aria-label={`Download ${section.title} as a PDF handout`}
                >
                  {downloadingTitle === section.title
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    : <FileDown className="w-3.5 h-3.5" aria-hidden="true" />}
                  PDF Handout
                </button>
              )}
            </div>
          </div>
          {handoutError && section.title === 'Client-Facing Psychoeducation' && (
            <p className="text-[10px] text-red-400 mt-1">Could not build the handout: {handoutError}</p>
          )}
        </div>
      ))}
    </div>
  );
}

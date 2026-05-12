'use client';

/**
 * Print-specific overrides. Screen uses Tailwind on the document; print flattens chrome for A4 / Save as PDF.
 */
export function PrintDocumentStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          @media print {
            body {
              background: white !important;
              color: #1f2937 !important;
            }
            button, nav {
              display: none !important;
            }
            .no-print {
              display: none !important;
            }
            .print-container {
              box-shadow: none !important;
              margin: 0 !important;
              padding: 0 !important;
              max-width: none !important;
              border: none !important;
              border-radius: 0 !important;
            }
            .print-page-root {
              background: white !important;
              padding: 0 !important;
            }
            .print-bundle-page {
              break-after: page;
              page-break-after: always;
            }
            .print-bundle-page-last {
              break-after: auto !important;
              page-break-after: auto !important;
            }
          }
        `,
      }}
    />
  );
}

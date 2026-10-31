
/**
 * PDF2CAD Online — Demo application
 * Complete homepage with converter, CAD guides and website navigation
 */

import { PdfToDxf } from '../react/PdfToDxf';

export default function App() {
  const linkStyle = {
    color: '#174ea6',
    textDecoration: 'none',
    fontWeight: 600,
    padding: '5px',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f8ff',
        color: '#172b4d',
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* HEADER */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e3eaf5',
          padding: '18px 24px',
        }}
      >
        <div
          style={{
            maxWidth: '1100px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '13px',
          }}
        >
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '13px',
              background: '#e8f1ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '26px',
            }}
          >
            📐
          </div>

          <div>
            <div
              style={{
                fontSize: '21px',
                fontWeight: 800,
                letterSpacing: '-0.5px',
                color: '#174ea6',
              }}
            >
              PDF2CAD Online
            </div>
            <div style={{ fontSize: '12px', color: '#718096' }}>
              Simple PDF to DXF conversion
            </div>
          </div>

          <div
            style={{
              marginLeft: 'auto',
              fontSize: '12px',
              fontWeight: 600,
              color: '#16804a',
              background: '#e8f8ef',
              borderRadius: '20px',
              padding: '8px 12px',
            }}
          >
            ✓ Free to use
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main
        style={{
          maxWidth: '1000px',
          margin: '0 auto',
          padding: '48px 20px 32px',
        }}
      >
        {/* INTRODUCTION */}
        <section style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div
            style={{
              display: 'inline-block',
              background: '#e8f1ff',
              color: '#174ea6',
              borderRadius: '20px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 700,
              marginBottom: '18px',
            }}
          >
            FOR CAD AND ARCHITECTURE WORK
          </div>

          <h1
            style={{
              fontSize: 'clamp(30px, 5vw, 46px)',
              lineHeight: 1.15,
              letterSpacing: '-1.5px',
              margin: '0 0 16px',
              color: '#142c52',
            }}
          >
            Convert PDF drawings to DXF
          </h1>

          <p
            style={{
              maxWidth: '620px',
              margin: '0 auto',
              fontSize: '16px',
              lineHeight: 1.8,
              color: '#61718a',
            }}
          >
            Turn supported PDF drawings into DXF files for use in CAD software.
            Upload your drawing, convert it, and download your result.
          </p>
        </section>

        {/* CONVERTER */}
        <section
          style={{
            background: '#ffffff',
            border: '1px solid #e0e8f4',
            borderRadius: '20px',
            padding: 'clamp(16px, 4vw, 32px)',
            boxShadow: '0 12px 40px rgba(34, 70, 120, 0.07)',
          }}
        >
          <div style={{ marginBottom: '24px' }}>
            <h2
              style={{
                fontSize: '20px',
                margin: '0 0 8px',
                color: '#18345c',
              }}
            >
              PDF to DXF Converter
            </h2>

            <p
              style={{
                fontSize: '14px',
                color: '#718096',
                lineHeight: 1.7,
                margin: 0,
              }}
            >
              Select your PDF file below to get started.
            </p>
          </div>

          <PdfToDxf
            options={{
              scale: 1,
              includeText: true,
              includePaths: true,
            }}
            onComplete={(result, filename) => {
              console.log(
                `Converted ${result.pageCount} page(s) → ${filename}`,
              );
            }}
            onError={(err) => {
              console.error('Conversion error:', err.message);
            }}
          />
        </section>

        {/* HOW IT WORKS */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '16px',
            marginTop: '24px',
          }}
        >
          {[
            {
              icon: '📄',
              title: '1. Upload your PDF',
              description: 'Choose the drawing you want to convert.',
            },
            {
              icon: '⚙️',
              title: '2. Convert the file',
              description: 'Let the converter process your drawing.',
            },
            {
              icon: '📥',
              title: '3. Download your DXF',
              description: 'Save the generated file to your device.',
            },
          ].map((item) => (
            <div
              key={item.title}
              style={{
                background: '#ffffff',
                border: '1px solid #e5ebf5',
                borderRadius: '14px',
                padding: '20px',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>
                {item.icon}
              </div>

              <h3
                style={{
                  fontSize: '15px',
                  margin: '0 0 8px',
                  color: '#18345c',
                }}
              >
                {item.title}
              </h3>

              <p
                style={{
                  fontSize: '13px',
                  lineHeight: 1.7,
                  color: '#718096',
                  margin: 0,
                }}
              >
                {item.description}
              </p>
            </div>
          ))}
        </section>

        {/* PRIVACY AND CONVERSION TIPS */}
        <section
          style={{
            marginTop: '24px',
            padding: '18px 20px',
            background: '#edf7ff',
            border: '1px solid #d6eaff',
            borderRadius: '14px',
            fontSize: '13px',
            lineHeight: 1.8,
            color: '#385779',
          }}
        >
          <strong>Privacy note:</strong> The conversion library is designed to
          process files locally in your browser. This app does not intentionally
          upload your PDF to a conversion server. Avoid sensitive files if you
          have not independently verified the deployed application.

          <p style={{ margin: '8px 0 0' }}>
            <strong>Tip:</strong> Vector PDFs generally provide better CAD
            results than scanned PDFs. Converted drawings may need checking
            and cleanup in your CAD software.
          </p>
        </section>

        {/* ABOUT THE TOOL */}
        <section
          style={{
            marginTop: '32px',
            padding: '24px',
            background: '#ffffff',
            border: '1px solid #e5ebf5',
            borderRadius: '14px',
            lineHeight: 1.8,
          }}
        >
          <h2 style={{ color: '#18345c', fontSize: '20px' }}>
            About PDF2CAD Online
          </h2>

          <p style={{ color: '#61718a', fontSize: '14px' }}>
            PDF2CAD Online is a browser-based PDF-to-DXF conversion tool
            designed for architects, CAD draftsmen, engineers and
            construction professionals. Convert supported PDF drawings
            into DXF files and review the results in compatible CAD software.
          </p>

          <p style={{ color: '#61718a', fontSize: '14px' }}>
            The tool is free to use and designed to make drawing conversion
            simple and accessible.
          </p>
        </section>

        {/* CAD GUIDES */}
        <section
          style={{
            marginTop: '32px',
            padding: '24px',
            background: '#ffffff',
            border: '1px solid #e5ebf5',
            borderRadius: '14px',
            lineHeight: 1.8,
          }}
        >
          <h2 style={{ color: '#18345c', fontSize: '22px', marginTop: 0 }}>
            CAD Guides and Tutorials
          </h2>

          <p style={{ color: '#61718a', fontSize: '14px' }}>
            Explore practical guides about PDF-to-DXF conversion, AutoCAD
            drawing checks and common CAD problems.
          </p>

          <ul
            style={{
              paddingLeft: '22px',
              marginBottom: 0,
              lineHeight: 2.2,
            }}
          >
            <li>
              <a href="/how-to-convert-pdf-to-dxf.html" style={linkStyle}>
                How to Convert PDF to DXF for AutoCAD
              </a>
            </li>

            <li>
              <a href="/convert-scanned-pdf-to-dxf.html" style={linkStyle}>
                How to Convert Scanned PDF Drawings to DXF
              </a>
            </li>

            <li>
              <a href="/vector-pdf-vs-scanned-pdf.html" style={linkStyle}>
                Vector PDF vs Scanned PDF
              </a>
            </li>

            <li>
              <a
                href="/how-to-scale-check-dxf-in-autocad.html"
                style={linkStyle}
              >
                How to Scale and Check DXF Drawings in AutoCAD
              </a>
            </li>

            <li>
              <a href="/pdf-to-dxf-conversion-problems.html" style={linkStyle}>
                Common PDF to DXF Conversion Problems and Solutions
              </a>
            </li>
          </ul>
        </section>
      </main>

      {/* FOOTER AND WEBSITE LINKS */}
      <footer
        style={{
          borderTop: '1px solid #e3eaf5',
          background: '#ffffff',
          textAlign: 'center',
          padding: '28px 16px',
          fontSize: '13px',
          lineHeight: 1.8,
          color: '#718096',
        }}
      >
        <div
          style={{
            fontWeight: 800,
            color: '#174ea6',
            fontSize: '17px',
          }}
        >
          📐 PDF2CAD Online
        </div>

        <p style={{ margin: '5px 0' }}>
          A simple tool for CAD and architecture workflows.
        </p>

        <nav
          aria-label="Website information"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '10px 20px',
            margin: '20px auto',
            maxWidth: '700px',
          }}
        >
          <a href="/about" style={linkStyle}>About Us</a>
          <a href="/privacy-policy.html" style={linkStyle}>Privacy Policy</a>
          <a href="/how-to-convert.html" style={linkStyle}>How to Convert</a>
          <a href="/features.html" style={linkStyle}>Features</a>
          <a href="/contact.html" style={linkStyle}>Contact Us</a>
          <a href="/terms.html" style={linkStyle}>Terms of Use</a>
        </nav>

        <p style={{ margin: '8px 0' }}>
          Contact:{' '}
          <a href="mailto:faizkhan469@gmail.com" style={linkStyle}>
            faizkhan469@gmail.com
          </a>
        </p>

        <div
          style={{
            borderTop: '1px solid #e3eaf5',
            paddingTop: '14px',
            marginTop: '18px',
            fontSize: '12px',
          }}
        >
          Built with the open-source PDF-to-DXF project · MIT License
        </div>

        <div style={{ fontSize: '12px', marginTop: '5px' }}>
          © 2026 PDF2CAD Online. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

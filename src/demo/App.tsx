
/**
 * PDF2CAD Online — Homepage
 * Improved content and navigation
 * Original PDF-to-DXF converter preserved
 */

import { PdfToDxf } from '../react/PdfToDxf';

export default function App() {
  const linkStyle = {
    color: '#174ea6',
    textDecoration: 'none',
    fontWeight: 600,
    padding: '5px',
  };

  const sectionStyle = {
    marginTop: '28px',
    padding: '26px',
    background: '#ffffff',
    border: '1px solid #e5ebf5',
    borderRadius: '14px',
    lineHeight: 1.8,
  };

  const headingStyle = {
    color: '#18345c',
    fontSize: '21px',
    marginTop: 0,
    marginBottom: '12px',
  };

  const paragraphStyle = {
    color: '#536780',
    fontSize: '14px',
    lineHeight: 1.85,
  };

  const guideLinks = [
    {
      href: '/how-to-convert-pdf-to-dxf.html',
      title: 'How to Convert PDF to DXF for AutoCAD',
    },
    {
      href: '/convert-scanned-pdf-to-dxf.html',
      title: 'How to Convert Scanned PDF Drawings to DXF',
    },
    {
      href: '/vector-pdf-vs-scanned-pdf.html',
      title: 'Vector PDF vs Scanned PDF: What Is the Difference?',
    },
    {
      href: '/how-to-scale-check-dxf-in-autocad.html',
      title: 'How to Scale and Check DXF Drawings in AutoCAD',
    },
    {
      href: '/pdf-to-dxf-conversion-problems.html',
      title: 'Common PDF to DXF Conversion Problems and Solutions',
    },
    {
      href: '/convert-architectural-floor-plan-pdf-to-autocad.html',
      title: 'How to Convert Architectural Floor Plans from PDF to AutoCAD',
    },
  ];

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
            flexWrap: 'wrap',
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
              Free PDF to DXF conversion tool
            </div>
          </div>

          <nav
            aria-label="Main navigation"
            style={{
              marginLeft: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              fontSize: '13px',
            }}
          >
            <a href="#converter" style={linkStyle}>Converter</a>
            <a href="/features.html" style={linkStyle}>Features</a>
            <a href="/cad-guides.html" style={linkStyle}>CAD Guides</a>
            <a href="/about.html" style={linkStyle}>About</a>
          </nav>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main
        style={{
          maxWidth: '1000px',
          margin: '0 auto',
          padding: '42px 20px 40px',
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
            Convert PDF Drawings to DXF Online
          </h1>

          <p
            style={{
              maxWidth: '700px',
              margin: '0 auto',
              fontSize: '16px',
              lineHeight: 1.8,
              color: '#61718a',
            }}
          >
            Convert supported PDF technical drawings into DXF files for use
            with AutoCAD and compatible CAD software. Extract drawing paths
            and text, download your DXF file, and continue your drafting work.
            No account or subscription is required.
          </p>

          <p
            style={{
              marginTop: '15px',
              color: '#16804a',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            ✓ Free to use &nbsp; · &nbsp; ✓ No registration &nbsp; · &nbsp;
            ✓ Browser-based conversion
          </p>
        </section>

        {/* CONVERTER */}
        <section
          id="converter"
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
                fontSize: '22px',
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
              Choose a supported PDF drawing below to start converting it
              into a DXF file.
            </p>
          </div>

          {/* ORIGINAL CONVERTER — SETTINGS PRESERVED */}
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
            marginTop: '28px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '16px',
          }}
        >
          {[
            {
              icon: '📄',
              title: '1. Select a PDF',
              description:
                'Choose a technical drawing or architectural plan saved as a PDF file.',
            },
            {
              icon: '⚙️',
              title: '2. Convert the drawing',
              description:
                'The converter extracts supported vector paths and text from the PDF.',
            },
            {
              icon: '📥',
              title: '3. Download your DXF',
              description:
                'Save the generated DXF file and open it in compatible CAD software.',
            },
          ].map((item) => (
            <div
              key={item.title}
              style={{
                background: '#ffffff',
                border: '1px solid #e5ebf5',
                borderRadius: '14px',
                padding: '21px',
              }}
            >
              <div style={{ fontSize: '25px', marginBottom: '12px' }}>
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
                  lineHeight: 1.75,
                  color: '#718096',
                  margin: 0,
                }}
              >
                {item.description}
              </p>
            </div>
          ))}
        </section>

        {/* WHAT THE CONVERTER DOES */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            What Does PDF to DXF Conversion Do?
          </h2>

          <p style={paragraphStyle}>
            PDF is commonly used to share architectural drawings, engineering
            plans, layouts and technical documents. DXF is a drawing exchange
            format that can be opened by AutoCAD and many other CAD
            applications.
          </p>

          <p style={paragraphStyle}>
            A PDF drawing can contain different types of content, including
            vector lines, curves, text and embedded images. A PDF-to-DXF
            converter attempts to translate supported drawing information
            into CAD entities that can be viewed and edited in a CAD program.
          </p>

          <p style={paragraphStyle}>
            PDF2CAD Online is designed to extract supported vector paths and
            text. The resulting DXF can be useful as a starting point for
            drafting, tracing, measurement checks and drawing cleanup.
          </p>
        </section>

        {/* VECTOR AND SCANNED PDF */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            Vector PDFs and Scanned PDFs: Important Differences
          </h2>

          <p style={paragraphStyle}>
            Not every PDF contains editable drawing geometry. Understanding
            how a PDF was created helps you choose the right workflow and
            set realistic expectations for the converted DXF.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginTop: '18px',
            }}
          >
            <div
              style={{
                background: '#f0f7ff',
                border: '1px solid #d9eaff',
                borderRadius: '12px',
                padding: '18px',
              }}
            >
              <h3 style={{ color: '#174ea6', fontSize: '16px' }}>
                Vector PDF
              </h3>
              <p style={paragraphStyle}>
                A vector PDF stores drawing elements such as lines, curves
                and text as mathematical objects. These elements can often
                be extracted into DXF geometry.
              </p>
              <p style={paragraphStyle}>
                <strong>Typical result:</strong> Better potential for
                editable CAD geometry.
              </p>
            </div>

            <div
              style={{
                background: '#fff8ee',
                border: '1px solid #f2e4cc',
                borderRadius: '12px',
                padding: '18px',
              }}
            >
              <h3 style={{ color: '#98611b', fontSize: '16px' }}>
                Scanned PDF
              </h3>
              <p style={paragraphStyle}>
                A scanned PDF usually contains a photograph or raster image
                of a drawing. Its visible lines may not exist as individual
                vector objects.
              </p>
              <p style={paragraphStyle}>
                <strong>Important:</strong> This converter does not perform
                OCR or automatic raster-to-vector tracing.
              </p>
            </div>
          </div>

          <p style={paragraphStyle}>
            If your DXF does not contain the expected lines, first check
            whether the original PDF is a vector drawing or simply a scanned
            image. You may need a separate raster-to-vector workflow for
            scanned documents.
          </p>

          <a href="/vector-pdf-vs-scanned-pdf.html" style={linkStyle}>
            Read the detailed vector PDF vs scanned PDF guide →
          </a>
        </section>

        {/* SUPPORTED CONTENT AND LIMITATIONS */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            What Can Be Extracted from a PDF?
          </h2>

          <p style={paragraphStyle}>
            The conversion engine is designed to process supported PDF
            drawing paths and text. The actual result depends on the
            structure and content of the source document.
          </p>

          <ul
            style={{
              paddingLeft: '22px',
              color: '#536780',
              fontSize: '14px',
              lineHeight: 2,
            }}
          >
            <li>Supported vector paths and line geometry.</li>
            <li>Supported curves and drawing outlines.</li>
            <li>Text items available in the PDF text layer.</li>
            <li>Pages processed into the generated DXF drawing.</li>
          </ul>

          <h3 style={{ color: '#18345c', fontSize: '16px' }}>
            Important conversion limitations
          </h3>

          <ul
            style={{
              paddingLeft: '22px',
              color: '#536780',
              fontSize: '14px',
              lineHeight: 2,
            }}
          >
            <li>
              Scanned images are not automatically converted into editable
              vector lines.
            </li>
            <li>
              Text or drawing elements that are not represented in a
              supported PDF structure may not be extracted correctly.
            </li>
            <li>
              Complex fills, dimensions, symbols and special PDF graphics
              may require manual checking.
            </li>
            <li>
              The converter does not guarantee that the resulting drawing
              will have the exact original CAD scale.
            </li>
          </ul>

          <p style={paragraphStyle}>
            Always compare the generated DXF with the original PDF before
            using it for construction documents, measurements or professional
            deliverables.
          </p>
        </section>

        {/* CAD CHECKING WORKFLOW */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            How to Check Your Converted DXF in AutoCAD
          </h2>

          <p style={paragraphStyle}>
            A successful download does not automatically mean that every
            drawing element is correct. A few checks in AutoCAD can help you
            identify missing geometry, incorrect proportions and text issues.
          </p>

          <ol
            style={{
              paddingLeft: '22px',
              color: '#536780',
              fontSize: '14px',
              lineHeight: 2,
            }}
          >
            <li>
              Open the downloaded DXF file in AutoCAD or compatible CAD
              software.
            </li>
            <li>
              Zoom to the drawing extents to locate the imported geometry.
            </li>
            <li>
              Inspect lines, curves and text for missing or unexpected
              elements.
            </li>
            <li>
              Use a known dimension from the original PDF to check the
              drawing scale.
            </li>
            <li>
              Correct the scale if necessary and inspect important
              dimensions again.
            </li>
            <li>
              Save a working copy after completing your checks and cleanup.
            </li>
          </ol>

          <p style={paragraphStyle}>
            For professional use, do not rely on visual appearance alone.
            Verify important dimensions against the original drawing or
            another trusted reference.
          </p>

          <a href="/how-to-scale-check-dxf-in-autocad.html" style={linkStyle}>
            Read the AutoCAD scale and checking tutorial →
          </a>
        </section>

        {/* PRIVACY */}
        <section
          style={{
            marginTop: '28px',
            padding: '21px',
            background: '#edf7ff',
            border: '1px solid #d6eaff',
            borderRadius: '14px',
            lineHeight: 1.8,
            color: '#385779',
          }}
        >
          <h2 style={{ fontSize: '18px', marginTop: 0, color: '#18345c' }}>
            File Privacy and Browser-Based Processing
          </h2>

          <p style={{ fontSize: '14px', marginBottom: 0 }}>
            PDF2CAD Online uses a browser-based conversion process. The
            conversion engine is designed to process the selected PDF locally
            in your browser rather than sending the drawing to a conversion
            server. Files are processed on your device for conversion.
          </p>

          <p style={{ fontSize: '14px', marginBottom: 0 }}>
            For sensitive or confidential drawings, review the privacy
            information and your organization's document-handling rules
            before using any online tool.
          </p>

          <a href="/privacy-policy.html" style={linkStyle}>
            Read our Privacy Policy →
          </a>
        </section>

        {/* PRACTICAL TIPS */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            Tips for Better PDF to DXF Results
          </h2>

          <ul
            style={{
              paddingLeft: '22px',
              color: '#536780',
              fontSize: '14px',
              lineHeight: 2,
            }}
          >
            <li>
              Use the original exported vector PDF whenever possible.
            </li>
            <li>
              Avoid low-resolution scanned drawings if editable CAD geometry
              is required.
            </li>
            <li>
              Check that the original PDF opens correctly before converting.
            </li>
            <li>
              Compare the DXF against the PDF after conversion.
            </li>
            <li>
              Verify at least one known dimension before using the drawing.
            </li>
            <li>
              Keep an unchanged copy of the original PDF for reference.
            </li>
          </ul>
        </section>

        {/* ABOUT */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            About PDF2CAD Online
          </h2>

          <p style={paragraphStyle}>
            PDF2CAD Online is a free browser-based PDF-to-DXF conversion
            utility for people who work with technical drawings and CAD
            documents. It is intended for architects, architectural
            draftsmen, CAD operators, designers, engineers and students who
            need to work with supported PDF drawing content in CAD software.
          </p>

          <p style={paragraphStyle}>
            The project focuses on making a basic drawing conversion
            workflow accessible without requiring users to create an
            account, purchase a subscription or pay for each download.
          </p>

          <p style={paragraphStyle}>
            The tool is provided as a conversion aid. Users remain
            responsible for checking drawing accuracy, dimensions and
            completeness before relying on converted files.
          </p>

          <a href="/about.html" style={linkStyle}>
            Learn more about PDF2CAD Online →
          </a>
        </section>

        {/* CAD GUIDES */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            CAD Guides and Tutorials
          </h2>

          <p style={paragraphStyle}>
            Explore practical tutorials covering PDF conversion, scanned
            drawings, architectural floor plans, AutoCAD scale checks and
            common conversion problems.
          </p>

          <ul
            style={{
              paddingLeft: '22px',
              marginBottom: 0,
              lineHeight: 2.2,
            }}
          >
            {guideLinks.map((guide) => (
              <li key={guide.href}>
                <a href={guide.href} style={linkStyle}>
                  {guide.title}
                </a>
              </li>
            ))}
          </ul>

          <p style={{ marginTop: '18px' }}>
            <a href="/cad-guides.html" style={linkStyle}>
              Visit the complete CAD Guides section →
            </a>
          </p>
        </section>

        {/* FAQ */}
        <section style={sectionStyle}>
          <h2 style={headingStyle}>
            Frequently Asked Questions
          </h2>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#18345c', fontSize: '16px' }}>
              1. Is PDF2CAD Online free to use?
            </h3>
            <p style={paragraphStyle}>
              Yes. The converter is provided free to use. No registration
              or subscription is required to use the conversion tool.
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#18345c', fontSize: '16px' }}>
              2. Can I convert a scanned PDF into editable DXF lines?
            </h3>
            <p style={paragraphStyle}>
              This converter extracts supported vector paths and text.
              It does not perform OCR or raster-to-vector tracing. A scanned
              PDF may therefore not produce editable drawing geometry.
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#18345c', fontSize: '16px' }}>
              3. Can I open the downloaded DXF in AutoCAD?
            </h3>
            <p style={paragraphStyle}>
              The output is a DXF drawing intended for compatible CAD
              applications, including AutoCAD. Review the file after opening
              it to check geometry and text.
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#18345c', fontSize: '16px' }}>
              4. Will the converted drawing have the correct scale?
            </h3>
            <p style={paragraphStyle}>
              Do not assume the output has the exact intended real-world
              scale. Check a known dimension in your CAD software and adjust
              the drawing when necessary.
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#18345c', fontSize: '16px' }}>
              5. Why are some lines or text missing?
            </h3>
            <p style={paragraphStyle}>
              Some PDF elements may be stored as images, unsupported
              graphics or special content. The converter may not extract
              every element. Compare the output with the original PDF.
            </p>
          </div>

          <div>
            <h3 style={{ color: '#18345c', fontSize: '16px' }}>
              6. Does the converter upload my PDF to a server?
            </h3>
            <p style={paragraphStyle}>
              The conversion engine is designed to process files locally
              in the browser. You can read the Privacy Policy for further
              information about the website.
            </p>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer
        style={{
          borderTop: '1px solid #e3eaf5',
          background: '#ffffff',
          textAlign: 'center',
          padding: '30px 16px',
          fontSize: '13px',
          lineHeight: 1.8,
          color: '#718096',
        }}
      >
        <div
          style={{
            fontWeight: 800,
            color: '#174ea6',
            fontSize: '18px',
          }}
        >
          📐 PDF2CAD Online
        </div>

        <p style={{ margin: '7px 0' }}>
          A free PDF-to-DXF conversion tool for CAD and architecture workflows.
        </p>

        <nav
          aria-label="Website information"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '10px 20px',
            margin: '20px auto',
            maxWidth: '750px',
          }}
        >
          <a href="/about.html" style={linkStyle}>About Us</a>
          <a href="/features.html" style={linkStyle}>Features</a>
          <a href="/cad-guides.html" style={linkStyle}>CAD Guides</a>
          <a href="/how-to-convert.html" style={linkStyle}>How to Convert</a>
          <a href="/privacy-policy.html" style={linkStyle}>Privacy Policy</a>
          <a href="/terms.html" style={linkStyle}>Terms of Use</a>
          <a href="/contact.html" style={linkStyle}>Contact Us</a>
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

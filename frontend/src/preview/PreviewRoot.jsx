import React from 'react';
import STLViewer from '../components/STLViewer';
import MermaidDiagram from '../components/MermaidDiagram';

export default function PreviewRoot() {
  const mermaidSample = `graph TD
    A[Christmas] -->|Get money| B(Go shopping)
    B --> C{Let me think}
    C -->|One| D[Laptop]
    C -->|Two| E[iPhone]
    C -->|Three| F[Car]`;

  return (
    <div className="rs-root rs-preview-active">
      <h1 className="rs-c-accent rs-fw-900 rs-type-h2 rs-mb-4">
        Component Fixture Verification
      </h1>
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h2 className="rs-type-h3 rs-mb-2">STLViewer Component</h2>
          <STLViewer url="/test_cube.stl" height={320} />
        </div>
        <div>
          <h2 className="rs-type-h3 rs-mb-2">MermaidDiagram Component</h2>
          <MermaidDiagram chart={mermaidSample} />
        </div>
      </div>
    </div>
  );
}


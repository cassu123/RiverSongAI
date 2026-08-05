import base64
import io
import datetime
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from PIL import Image

def generate_labels_pdf(items):
    """
    Generate a 30-up Avery 5160 PDF containing QR labels for the provided items.
    Avery 5160: 3 columns, 10 rows.
    Label size: 2.625" x 1"
    Page: 8.5" x 11"
    Margins: Top 0.5", Bottom 0.5", Left 0.1875", Right 0.1875"
    Horizontal spacing between labels: 0.125"
    """
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    
    # 5160 dimensions
    left_margin = 0.1875 * inch
    top_margin = 0.5 * inch
    label_w = 2.625 * inch
    label_h = 1.0 * inch
    horiz_gap = 0.125 * inch
    vert_gap = 0.0 * inch
    
    rows = 10
    cols = 3
    
    idx = 0
    while idx < len(items):
        for row in range(rows):
            for col in range(cols):
                if idx >= len(items):
                    break
                
                item = items[idx]
                
                x = left_margin + col * (label_w + horiz_gap)
                y = letter[1] - top_margin - (row + 1) * (label_h + vert_gap)
                
                # Draw the QR code (we have the base64 png in item.qr_code_data)
                qr_size = 0.8 * inch
                qr_img = None
                if item.qr_code_data:
                    try:
                        img_data = base64.b64decode(item.qr_code_data)
                        img = Image.open(io.BytesIO(img_data))
                        # Save to a temporary buffer so reportlab can read it
                        tmp_buffer = io.BytesIO()
                        img.save(tmp_buffer, format="PNG")
                        tmp_buffer.seek(0)
                        from reportlab.lib.utils import ImageReader
                        qr_img = ImageReader(tmp_buffer)
                    except Exception as e:
                        pass
                
                if qr_img:
                    c.drawImage(qr_img, x + 0.1*inch, y + 0.1*inch, width=qr_size, height=qr_size)
                
                # Draw text: EIN and Name
                text_x = x + 0.2*inch + qr_size
                text_y = y + 0.65*inch
                
                c.setFont("Helvetica-Bold", 8)
                c.drawString(text_x, text_y, item.ein if item.ein else "NO-EIN")
                
                c.setFont("Helvetica", 7)
                name = (item.name[:28] + "..") if len(item.name) > 30 else item.name
                c.drawString(text_x, text_y - 0.2*inch, name)
                
                # Add current date or something small
                c.setFont("Helvetica", 5)
                c.drawString(text_x, text_y - 0.4*inch, datetime.datetime.now().strftime("%Y-%m-%d"))

                idx += 1
                
            if idx >= len(items):
                break
        
        c.showPage()
    
    c.save()
    buffer.seek(0)
    return buffer

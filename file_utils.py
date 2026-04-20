import os
import uuid
import easyocr
import re
from datetime import datetime, date
from typing import Optional, Tuple

# Initialize EasyOCR reader
# This can be resource-intensive, so it's good to initialize once.
# Consider loading only the languages you need.
try:
    reader = easyocr.Reader(['en']) # 'en' for English, add more languages if needed
except Exception as e:
    print(f"Warning: easyocr reader could not be initialized. OCR functionality will be disabled. Error: {e}")
    reader = None

# Base directory for all inventory-related files
INVENTORY_FILES_BASE_DIR = "inventory_files" # This should be configurable in a real app

def _get_home_directory(home_id: str) -> str:
    """Constructs the base directory path for a given home."""
    return os.path.join(INVENTORY_FILES_BASE_DIR, f"home_{home_id}")

def save_file_for_home(home_id: str, file_type: str, file_data: bytes, original_filename: str) -> str:
    """
    Saves a file to a home-specific directory.

    Args:
        home_id: The ID of the home.
        file_type: The type of file (e.g., "receipts", "warranties").
        file_data: The binary content of the file.
        original_filename: The original name of the file, used for extension.

    Returns:
        The relative path to the saved file.
    """
    home_dir = _get_home_directory(home_id)
    target_dir = os.path.join(home_dir, file_type)
    os.makedirs(target_dir, exist_ok=True)

    file_extension = os.path.splitext(original_filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(target_dir, unique_filename)

    with open(file_path, "wb") as f:
        f.write(file_data)

    # Return path relative to the base directory for storage in DB
    return os.path.relpath(file_path, INVENTORY_FILES_BASE_DIR)

def extract_data_from_receipt(image_path: str) -> Tuple[Optional[float], Optional[date]]:
    """
    Extracts price and date from a receipt image using EasyOCR.

    Args:
        image_path: The path to the receipt image.

    Returns:
        A tuple containing (extracted_price, extracted_date).
        Returns (None, None) if OCR is not initialized or data cannot be extracted.
    """
    if not reader:
        print("EasyOCR reader not initialized. Cannot perform OCR.")
        return None, None

    try:
        result = reader.readtext(image_path)

        extracted_price = None
        extracted_date = None

        price_pattern = re.compile(r'\$?(\d+\.\d{2})')
        date_pattern = re.compile(r'\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}')

        for (bbox, text, prob) in result:
            if extracted_price is None:
                price_match = price_pattern.search(text)
                if price_match:
                    try: extracted_price = float(price_match.group(1))
                    except ValueError: pass

            if extracted_date is None:
                date_match = date_pattern.search(text)
                if date_match:
                    try: extracted_date = datetime.strptime(date_match.group(0), '%m/%d/%Y').date() # Example format
                    except ValueError: pass

            if extracted_price is not None and extracted_date is not None: break

        return extracted_price, extracted_date

    except Exception as e:
        print(f"Error during OCR processing: {e}")
        return None, None
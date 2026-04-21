import os
import pyttsx3
from sqlalchemy.orm import Session
from sqlalchemy.exc import NoResultFound
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import and_
from typing import Optional

from .models import InventoryItem, User, Home, AssetStatus, CollaboratorRole, QRCodeStandard, collaborators_table
from .auth import set_active_home, PermissionDeniedError, HomeNotFoundError
from .file_utils import save_file_for_home, extract_data_from_receipt, INVENTORY_FILES_BASE_DIR

from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib import colors

# Initialize the TTS engine once
# In a real application, you might want to manage this engine more robustly,
# perhaps as a singleton or a dependency injection.
try:
    engine = pyttsx3.init()
except Exception as e:
    print(f"Warning: pyttsx3 engine could not be initialized. Audio feedback will be disabled. Error: {e}")
    engine = None

def play_audio_confirmation(text: str):
    """
    Plays an audio confirmation message using pyttsx3.
    If the engine is not initialized, it prints the message instead.
    """
    if engine:
        engine.say(text)
        engine.runAndWait()
    else:
        print(f"Audio feedback (disabled): {text}")


def fast_scan_item(db_session: Session, user_id: str, item_id: str) -> InventoryItem:
    """
    Simulates a fast-scan operation. Retrieves an item and provides audio confirmation.

    Args:
        db_session: The SQLAlchemy session object.
        user_id: The ID of the user performing the scan (for permission checking).
        item_id: The ID of the inventory item (barcode/EIN).

    Returns:
        The InventoryItem object if found and accessible.

    Raises:
        HomeNotFoundError: If the item's home is not found.
        PermissionDeniedError: If the user does not have permission to access the item's home.
        NoResultFound: If the item with the given ID is not found.
    """
    item = db_session.query(InventoryItem).filter(InventoryItem.id == item_id).first()

    if not item:
        play_audio_confirmation(f"Item not found: {item_id}")
        raise NoResultFound(f"Inventory item with ID '{item_id}' not found.")

    # Verify user has permission to access the home this item belongs to
    try:
        active_home = set_active_home(db_session, user_id, str(item.home_id))
    except (HomeNotFoundError, PermissionDeniedError) as e:
        play_audio_confirmation(f"Access denied for item: {item.name}")
        raise e

    confirmation_text = (
        f"Validated: {item.name}, "
        f"Status: {item.asset_status.value}, "
        f"Quantity: {item.quantity}. "
    )
    if item.current_custodian:
        confirmation_text += f"Issued to: {item.current_custodian.email}."

    play_audio_confirmation(confirmation_text)
    return item


def issue_item_to_collaborator(
    db_session: Session, admin_user_id: str, item_id: str, collaborator_user_id: str
) -> InventoryItem:
    """
    Issues an inventory item to a collaborator, updating its custodian and timestamp.

    Args:
        db_session: The SQLAlchemy session object.
        admin_user_id: The ID of the user performing the issuance (must be owner of the home).
        item_id: The ID of the inventory item to issue.
        collaborator_user_id: The ID of the user to issue the item to.

    Returns:
        The updated InventoryItem object.

    Raises:
        NoResultFound: If the item or collaborator user is not found.
        PermissionDeniedError: If the admin_user_id is not the owner of the home,
                               or if the collaborator_user_id is not a collaborator of the home.
        ValueError: If the item is already issued to the same collaborator.
    """
    item = db_session.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise NoResultFound(f"Inventory item with ID '{item_id}' not found.")

    home = db_session.query(Home).filter(Home.id == item.home_id).first()
    if not home or str(home.owner_id) != admin_user_id:
        raise PermissionDeniedError(f"User '{admin_user_id}' is not the owner of home '{home.id}' and cannot issue items.")

    collaborator = db_session.query(User).filter(User.id == collaborator_user_id).first()
    if not collaborator:
        raise NoResultFound(f"Collaborator user with ID '{collaborator_user_id}' not found.")

    if item.current_custodian_id == collaborator.id:
        raise ValueError(f"Item '{item.name}' is already issued to '{collaborator.email}'.")

    item.current_custodian_id = collaborator.id
    item.issued_at = datetime.utcnow()
    item.asset_status = AssetStatus.IN_USE

    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    play_audio_confirmation(f"Item {item.name} issued to {collaborator.email}.")
    return item


def manage_collaborators(
    db_session: Session,
    owner_user_id: str,
    home_id: str,
    collaborator_user_id: str,
    action: str,  # 'add', 'remove', 'update_role'
    role: CollaboratorRole = None,
) -> Home:
    """
    Allows the home owner to add, remove, or update roles for collaborators.

    Args:
        db_session: The SQLAlchemy session object.
        owner_user_id: The ID of the user performing the action (must be the home owner).
        home_id: The ID of the home to manage collaborators for.
        collaborator_user_id: The ID of the user to add, remove, or modify.
        action: The action to perform ('add', 'remove', 'update_role').
        role: The CollaboratorRole to assign if adding or updating. Required for 'add' and 'update_role'.

    Returns:
        The updated Home object.

    Raises:
        HomeNotFoundError: If the home is not found.
        PermissionDeniedError: If the owner_user_id is not the owner of the home.
        NoResultFound: If the collaborator user is not found.
        ValueError: For invalid actions or missing roles.
    """
    home = db_session.query(Home).filter(Home.id == home_id).first()
    if not home:
        raise HomeNotFoundError(f"Home with ID '{home_id}' not found.")

    if str(home.owner_id) != owner_user_id:
        raise PermissionDeniedError(
            f"User '{owner_user_id}' is not the owner of home '{home_id}' and cannot manage collaborators."
        )

    collaborator_user = db_session.query(User).filter(User.id == collaborator_user_id).first()
    if not collaborator_user:
        raise NoResultFound(f"Collaborator user with ID '{collaborator_user_id}' not found.")

    if action == "add":
        if not role:
            raise ValueError("Role is required when adding a collaborator.")
        if collaborator_user_id == owner_user_id:
            raise ValueError("Cannot add the home owner as a collaborator.")

        # Check if already a collaborator
        existing_collaborator = db_session.query(collaborators_table).filter(
            and_(collaborators_table.c.user_id == collaborator_user_id,
                 collaborators_table.c.home_id == home_id)
        ).first()

        if existing_collaborator:
            raise ValueError(f"User '{collaborator_user.email}' is already a collaborator for home '{home.name}'.")

        insert_stmt = collaborators_table.insert().values(
            user_id=collaborator_user_id, home_id=home_id, role=role.value, created_at=datetime.utcnow()
        )
        db_session.execute(insert_stmt)
        db_session.commit()
        play_audio_confirmation(f"Collaborator {collaborator_user.email} added to home {home.name} with role {role.value}.")

    elif action == "remove":
        delete_stmt = collaborators_table.delete().where(
            and_(collaborators_table.c.user_id == collaborator_user_id,
                 collaborators_table.c.home_id == home_id)
        )
        result = db_session.execute(delete_stmt)
        if result.rowcount == 0:
            raise NoResultFound(f"User '{collaborator_user.email}' is not a collaborator for home '{home.name}'.")
        db_session.commit()
        play_audio_confirmation(f"Collaborator {collaborator_user.email} removed from home {home.name}.")

    elif action == "update_role":
        if not role:
            raise ValueError("Role is required when updating a collaborator's role.")
        update_stmt = collaborators_table.update().where(
            and_(collaborators_table.c.user_id == collaborator_user_id,
                 collaborators_table.c.home_id == home_id)
        ).values(role=role.value)
        result = db_session.execute(update_stmt)
        if result.rowcount == 0:
            raise NoResultFound(f"User '{collaborator_user.email}' is not a collaborator for home '{home.name}'.")
        db_session.commit()
        play_audio_confirmation(f"Collaborator {collaborator_user.email}'s role updated to {role.value} for home {home.name}.")
    else:
        raise ValueError(f"Invalid action: '{action}'. Must be 'add', 'remove', or 'update_role'.")

    db_session.refresh(home)
    return home


def edit_home_profile(db_session: Session, owner_user_id: str, home_id: str, new_name: str = None, new_qr_standard: QRCodeStandard = None) -> Home:
    """
    Allows the home owner to edit the home's profile, including its name and default QR code standard.

    Args:
        db_session: The SQLAlchemy session object.
        owner_user_id: The ID of the user performing the action (must be the home owner).
        home_id: The ID of the home to edit.
        new_name: The optional new name for the home.
        new_qr_standard: The optional new default QR code standard for the home.

    Returns:
        The updated Home object.

    Raises:
        HomeNotFoundError: If the home is not found.
        PermissionDeniedError: If the owner_user_id is not the owner of the home.
    """
    home = db_session.query(Home).filter(Home.id == home_id).first()
    if not home:
        raise HomeNotFoundError(f"Home with ID '{home_id}' not found.")

    if str(home.owner_id) != owner_user_id:
        raise PermissionDeniedError(
            f"User '{owner_user_id}' is not the owner of home '{home_id}' and cannot edit its profile."
        )

    if new_name:
        home.name = new_name
        play_audio_confirmation(f"Home {home.id} name updated to {new_name}.")
    if new_qr_standard:
        home.default_qr_code_standard = new_qr_standard
        play_audio_confirmation(f"Home {home.name} default QR code standard updated to {new_qr_standard.value}.")

    if new_name or new_qr_standard:
        db_session.add(home)
        db_session.commit()
        db_session.refresh(home)

    return home


def process_receipt_for_item(
    db_session: Session,
    user_id: str,
    item_id: str,
    receipt_image_data: bytes,
    receipt_filename: str,
    manual_price: Optional[float] = None,
    manual_date: Optional[date] = None,
) -> InventoryItem:
    """
    Processes a receipt image for an inventory item, extracts data, and updates the item.

    Args:
        db_session: The SQLAlchemy session object.
        user_id: The ID of the user uploading the receipt (for permission checking).
        item_id: The ID of the inventory item to associate the receipt with.
        receipt_image_data: The binary data of the receipt image.
        receipt_filename: The original filename of the receipt image.
        manual_price: Optional manual override for the purchase price.
        manual_date: Optional manual override for the purchase date.

    Returns:
        The updated InventoryItem object.

    Raises:
        NoResultFound: If the item is not found.
        PermissionDeniedError: If the user does not have permission to access the item's home.
    """
    item = db_session.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise NoResultFound(f"Inventory item with ID '{item_id}' not found.")

    # Verify user has permission to access the home this item belongs to
    set_active_home(db_session, user_id, str(item.home_id))

    # Save the receipt image
    relative_path = save_file_for_home(str(item.home_id), "receipts", receipt_image_data, receipt_filename)
    item.receipt_image_path = relative_path

    # Temporarily save the image to a known path for OCR processing
    # For simplicity, let's assume INVENTORY_FILES_BASE_DIR is accessible for OCR.
    full_image_path = os.path.join(INVENTORY_FILES_BASE_DIR, relative_path)

    extracted_price, extracted_date = None, None
    if extract_data_from_receipt: # Check if easyocr was initialized
        extracted_price, extracted_date = extract_data_from_receipt(full_image_path)

    # Apply manual overrides or extracted data
    item.purchase_price = Decimal(str(manual_price)) if manual_price is not None else (Decimal(str(extracted_price)) if extracted_price is not None else None)
    item.purchase_date = manual_date if manual_date is not None else extracted_date

    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    play_audio_confirmation(f"Receipt processed for {item.name}. Price: {item.purchase_price or 'N/A'}, Date: {item.purchase_date or 'N/A'}.")
    return item


def generate_insurance_manifest(db_session: Session, user_id: str, home_id: str) -> str:
    """
    Generates a PDF manifest for insurance claims, listing all serviceable items
    and their replacement costs for a given home.

    Args:
        db_session: The SQLAlchemy session object.
        user_id: The ID of the user requesting the manifest (for permission checking).
        home_id: The ID of the home for which to generate the manifest.

    Returns:
        The path to the generated PDF file.

    Raises:
        HomeNotFoundError: If the home is not found.
        PermissionDeniedError: If the user does not have permission to access the home.
    """
    home = set_active_home(db_session, user_id, home_id) # Verify access

    serviceable_items = db_session.query(InventoryItem).filter(
        InventoryItem.home_id == home_id,
        InventoryItem.asset_status == AssetStatus.SERVICEABLE
    ).all()

    total_replacement_cost = Decimal('0.00')
    for item in serviceable_items:
        if item.replacement_cost:
            total_replacement_cost += item.replacement_cost * item.quantity # Assuming quantity affects total cost

    # Generate PDF
    output_dir = os.path.join(INVENTORY_FILES_BASE_DIR, f"home_{home_id}", "reports")
    os.makedirs(output_dir, exist_ok=True)
    pdf_filename = f"insurance_manifest_{home.name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d%H%M%S')}.pdf"
    pdf_path = os.path.join(output_dir, pdf_filename)

    doc = SimpleDocTemplate(pdf_path, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph(f"Insurance Manifest for Home: {home.name}", styles['h1']))
    story.append(Paragraph(f"Generated On: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", styles['Normal']))
    story.append(Spacer(1, 0.2 * inch))

    data = [['Item Name', 'Quantity', 'Asset Status', 'Replacement Cost (Each)', 'Total Item Cost']]
    for item in serviceable_items:
        item_total_cost = item.replacement_cost * item.quantity if item.replacement_cost else Decimal('0.00')
        data.append([item.name, str(item.quantity), item.asset_status.value, f"${item.replacement_cost:.2f}" if item.replacement_cost else "N/A", f"${item_total_cost:.2f}"])

    table = Table(data)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    story.append(table)
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(f"Total Estimated Replacement Cost for Serviceable Items: ${total_replacement_cost:.2f}", styles['h2']))

    doc.build(story)

    play_audio_confirmation(f"Insurance manifest generated for home {home.name}.")
    return pdf_path
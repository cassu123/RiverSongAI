"""
core/tools_commerce.py

Commerce product/sale tool executors + shared _get_commerce_db.
Split out of core/tools.py (god-file audit #3); re-exported by core.tools
so the dispatcher and any external callers are unchanged.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _get_commerce_db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import os
    db_url = os.environ.get("COMMERCE_DB_URL", "sqlite:///./data/commerce.db")
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    return Session()


async def _exec_search_commerce_products(args: dict, user_id: str) -> str:
    db = None
    try:
        from commercial_inventory.management import get_workspaces_for_user, get_products, get_or_create_biz_user

        db = _get_commerce_db()
        biz_user = get_or_create_biz_user(
            db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            return "You do not have any active store workspaces configured."

        query = args.get('query', '').lower()
        results = []
        for ws in workspaces:
            products = get_products(db, biz_user, str(ws.id))
            for p in products:
                if query in p.name.lower() or query in str(p.sku).lower():
                    results.append(
                        f"{p.name} (SKU: {p.sku}) - {p.stock_qty} in stock at ${p.unit_price}")

        if not results:
            return f"No products found matching '{query}'."
        return "\n".join(results)
    except Exception as exc:
        return f"Error searching products: {exc}"
    finally:
        if db is not None:
            db.close()


async def _exec_create_commerce_sale(args: dict, user_id: str) -> str:
    db = None
    try:
        from commercial_inventory.management import get_workspaces_for_user, get_products, get_or_create_biz_user, create_sale, LineItemIn
        from commercial_inventory.models import Customer

        db = _get_commerce_db()
        biz_user = get_or_create_biz_user(
            db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            return "You do not have any active store workspaces configured."

        ws = workspaces[0]  # default to first workspace for voice commands
        products = get_products(db, biz_user, str(ws.id))

        product_query = args['product_id'].lower()
        target_product = next((p for p in products if p.sku.lower(
        ) == product_query or p.name.lower() == product_query or str(p.id) == product_query), None)

        if not target_product:
            return f"Could not find a product matching '{args['product_id']}' to sell."

        if target_product.stock_qty < args['quantity']:
            return f"Insufficient stock for {target_product.name}. You only have {target_product.stock_qty} units available."

        customer_id = None
        if args.get('customer_name'):
            # naive search
            cust = db.query(Customer).filter(
                Customer.workspace_id == str(ws.id)).first()
            # for perfection, let's just create if not exists
            if not cust:
                cust = Customer(
                    workspace_id=str(
                        ws.id),
                    name=args['customer_name'])
                db.add(cust)
                db.flush()
            customer_id = str(cust.id)

        line_items = [
            LineItemIn(
                product_id=str(
                    target_product.id), qty=args['quantity'], unit_price=float(
                    target_product.unit_price or 0.0))]
        sale = create_sale(db,
                           biz_user,
                           str(ws.id),
                           line_items,
                           customer_id=customer_id,
                           notes="Created via Voice Assistant",
                           deduct_stock=True)

        from commercial_inventory.models import SaleStatus
        sale.status = SaleStatus.COMPLETED
        db.commit()

        return f"Successfully logged sale of {args['quantity']}x {target_product.name}. Remaining stock: {target_product.stock_qty}."
    except Exception as exc:
        return f"Failed to log sale: {exc}"
    finally:
        if db is not None:
            db.close()



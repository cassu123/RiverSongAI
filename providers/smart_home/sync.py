from __future__ import annotations
import logging
import json
from datetime import datetime, timezone
from config.settings import get_settings
from providers.smart_home.home_assistant import HomeAssistantClient
from main import get_app

logger = logging.getLogger(__name__)

async def sync_ha_entities() -> int:
    """
    Sync entities, names, areas, and device_classes from Home Assistant to the local SQLite db.
    Returns the number of entities synced.
    """
    app = get_app()
    if not app:
        return 0
    store = app.state.memory_manager._store
    s = get_settings()
    if not s.home_assistant_token or not s.home_assistant_url:
        return 0
        
    client = HomeAssistantClient(base_url=s.home_assistant_url, token=s.home_assistant_token)
    try:
        await client.__aenter__()
        
        # We use the template API to get area names and device classes reliably across all entities.
        template = '''
        {% set res = [] %}
        {% for state in states %}
          {% set _ = res.append({
            "entity_id": state.entity_id,
            "name": state.attributes.friendly_name | default(state.name, true),
            "area": area_name(state.entity_id),
            "device_class": state.attributes.device_class
          }) %}
        {% endfor %}
        {{ res | to_json }}
        '''
        resp = await client._client.post(f"{client._base}/template", json={"template": template})
        resp.raise_for_status()
        
        try:
            entities = json.loads(resp.text)
        except json.JSONDecodeError:
            logger.error("Failed to decode HA template response during sync")
            return 0
            
        now = datetime.now(timezone.utc).isoformat()
        
        count = 0
        for ent in entities:
            entity_id = ent.get("entity_id")
            if not entity_id or "." not in entity_id:
                continue
            domain = entity_id.split(".")[0]
            name = ent.get("name") or entity_id
            area = ent.get("area")
            device_class = ent.get("device_class")
            
            # Use SQLite UPSERT
            await store._execute("""
                INSERT INTO ha_entities (entity_id, domain, name, area, device_class, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(entity_id) DO UPDATE SET
                    domain=excluded.domain,
                    name=excluded.name,
                    area=excluded.area,
                    device_class=excluded.device_class,
                    updated_at=excluded.updated_at
            """, (entity_id, domain, name, area, device_class, now))
            count += 1
            
        logger.info(f"Synced {count} entities from Home Assistant.")
        return count
    except Exception as e:
        logger.error(f"HA Sync failed: {e}")
        return 0
    finally:
        await client.close()

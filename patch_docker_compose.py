import re
with open("docker-compose.yml", "r") as f:
    content = f.read()
    
# Remove memgpt block
content = re.sub(r'  memgpt:.*?depends_on:\n      - memgpt-db\n', '', content, flags=re.DOTALL)

# Remove memgpt-db block
content = re.sub(r'  memgpt-db:.*?- \./infra/memgpt/db:/var/lib/postgresql/data\n', '', content, flags=re.DOTALL)

with open("docker-compose.yml", "w") as f:
    f.write(content)

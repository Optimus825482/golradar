import json, sys

with open(sys.argv[1], 'r') as f:
    c = json.load(f)

mcp = c.get('mcpServers', {})

# Add Exa MCP server
mcp['exa'] = {
    'command': 'npx',
    'args': ['-y', '@agentrvc/exa-mcp-server'],
    'env': {
        'EXA_API_KEY': 'acf427d4-71c2-42cd-a025-b3bfa5eafb6f'
    }
}
c['mcpServers'] = mcp

enabled = c.get('enabledMcpjsonServers', [])
if 'exa' not in enabled:
    enabled.append('exa')
c['enabledMcpjsonServers'] = enabled

with open(sys.argv[1], 'w') as f:
    json.dump(c, f, indent=2)

print('Exa MCP eklendi')

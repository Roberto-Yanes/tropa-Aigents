import json
import sys
import secretstorage

operation, key = sys.argv[1:3]
collection = secretstorage.get_default_collection(secretstorage.dbus_init())
if collection.is_locked():
    raise RuntimeError('El llavero está bloqueado')
attributes = {'application': 'tropa-ai', 'account': key}
items = list(collection.search_items(attributes))
if operation == 'load':
    sys.stdout.write(items[0].get_secret().decode() if items else 'null')
elif operation == 'save':
    secret = sys.stdin.read()
    json.loads(secret)
    collection.create_item('Tropa AI · conexión Google', attributes, secret, replace=True)
elif operation == 'delete':
    for item in items:
        item.delete()
else:
    raise ValueError('Operación desconocida')

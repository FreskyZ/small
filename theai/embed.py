import asyncio, os, json, httpx, struct, uuid
from collections import namedtuple

config = json.loads(open('akaric').read())
domain = config['main-domain']

apikey = os.environ['BAILIAN_APIKEY']
id_access_token = os.environ['FINE_ACCESSTOKEN']
app_access_token = os.environ['FINECHAT_ACCESSTOKEN']

async def get_app_access_token(client):
    response = await client.post(f'https://api.{domain}/generate-authorization-code', headers={
        'origin': f'https://id.{domain}',
        'authorization': f'Bearer {id_access_token}',
        'content-type': 'application/json',
    }, json={
        'return': f'https://chat.{domain}',
    })
    response.raise_for_status()
    authorization_code = response.json()['code']
    response = await client.post(f'https://api.{domain}/signin', headers={
        'origin': f'https://chat.{domain}',
        'authorization': f'Bearer {authorization_code}',
    })
    response.raise_for_status()
    return response.json()['accessToken']

Session = namedtuple('Session', ['id', 'seq_id', 'title', 'inserted_at', 'updated_at'])
Message = namedtuple('Message', ['message_id', 'parent_id', 'role', 'content', 'thinking_content', 'accumulated_token_usage', 'inserted_at'])

async def get_sessions(client):
    response = await client.get(f'https://api.{domain}/chat/v1/dsessions', headers={
        'origin': f'https://chat.{domain}',
        'authorization': f'Bearer {app_access_token}',
    })
    response.raise_for_status()
    return [Session(**s) for s in response.json()]

async def get_messages_combined(client, id):
    print(f'session {id} downloading messages')
    response = await client.get(f'https://api.{domain}/chat/v1/dmessages', params={
        'id': id,
    }, headers={
        'origin': f'https://chat.{domain}',
        'authorization': f'Bearer {app_access_token}',
    })
    response.raise_for_status()
    messages = [Message(**m) for m in response.json()]
    return ''.join([('USER:' if m.role == 'USER' else 'AGENT:') + m.content + '\n' for m in messages])

async def get_embeddings(client, id, input):
    print(f'session {id} converting to embeddings')
    # for now, check free token usage: https://bailian.console.aliyun.com/?tab=model#/model-market/detail/text-embedding-v4
    response = await client.post('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings', headers={
        'authorization': f'Bearer {apikey}',
        'content-type': 'application/json',
    }, json={
        'model': 'text-embedding-v4',
        'input': input,
    })
    response.raise_for_status()
    return response.json()['data'][0]['embedding']

async def process_session(client, session):
    messages = await get_messages_combined(client, session.id)
    embeddings = await get_embeddings(client, session.id, messages)
    print(session.id, embeddings)
    return uuid.UUID(session.id).bytes + struct.pack(f'<{len(embeddings)}f', *embeddings)

async def main():
    async with httpx.AsyncClient(http2=True) as client:
        # print(await get_app_access_token(client))
        sessions = await get_sessions(client)
        binary_data = b''.join(await asyncio.gather(*[process_session(client, s) for s in sessions[:2]]))
        print('write result')
        with open('embed.bin', 'wb') as f:
            f.write(binary_data)

asyncio.run(main())

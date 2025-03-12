# my first real LLM AI related code project
# this is a simple command line interactive chatbot using openai (-like deepseek) api

# apt install python3.12-venv
# python3.12 -m venv .
# source bin/activate
# # deactivate directly with the `deactivate` command
# export DEEPSEEK_API_KEY=...

import os, openai

api_key = os.getenv('DEEPSEEK_API_KEY')
client = openai.OpenAI(api_key=api_key, base_url='https://api.deepseek.com')

# https://platform.openai.com/docs/api-reference/chat
# https://api-docs.deepseek.com/api/deepseek-api

# # model: deepseek-reasoner for reasoner, deepseek-chat for not reasoner
# # messages: array of one of
# #    { role: 'system', content: system message }
# #    { role: 'user': content: user message }
# #    { role: 'assistant', content: assistant message } the content is response.choices[0].message.content, this does not include reasoning_content
# # max_tokens: default 4096
# # stream: defalt False, True seems more responsive?
# # NOTE reasoning model does NOT support following parameters 
# # frequency_penalty: >= -2.0 and <= 2.0, default 0
# # presence_penalty: >= -2.0 and <= 2.0, default 0
# # temperature: <= 2.0, why is this default to 1?
# # top_p: <= 1.0, default 1
# response = client.chat.completions.create(
#     model='deepseek-reasoner',
#     messages=[
#         {'role': 'system', 'content': 'You are a helpful assistant'},
#         {'role': 'user', 'content': 'Hello'},
#     ],
# )

# # response.id: an id
# # response.model: 'deepseek-reasoner'
# # NOTE this include previous conversation, include both side (previous output is counted in this time input
# # response.usage.prompt_tokens: input token usage
# # response.usage.completion_tokens: output token usage
# # response.choices: openai document have an `n` parameter in chat completion api,
# #    is the number of this array, deepseek api document does not have that
# # response.choices[0].index: an index
# # response.choices[0].finish_reason:
# #    stop: normal finish,
# #    length: token count limit exceed,
# #    content_filter: content filtered,
# #    tool_calls TODO what is tool,
# #    insufficient_system_resource: insufficient system resource
# # response.choices[0].message.reasoning_content: the reasoning content
# # response.choices[0].message.content: the response
# print(response.choices[0].message.content)

# # get balance, btw, openai sdk does not have this, btw
# import requests, json
# response = requests.get('https://api.deepseek.com/user/balance', data={}, headers={
#     'Accept': 'application/json',
#     'Authorization': 'Bearer ' + api_key,
# })
# # response.balance_infos[0].currency: 'CNY'
# # response.balance_infos[0].total_balance: the money
# print(json.loads(response.text))

# messages = [{ 'role': 'system', 'content': 'You are a helpful assistant.' }]
# while True:
#     try:
#         user_input = input('You: ')
#         if user_input.lower() == 'exit':
#             print('System: Bye!')
#             break
        
#         messages.append({ 'role': 'user', 'content': user_input })
#         response = client.chat.completions.create(model='deepseek-reasoner', messages=messages)

#         reasoning_content = response.choices[0].message.reasoning_content
#         print(f'Assistant Thinking: {reasoning_content}')
#         assistant_response = response.choices[0].message.content
#         print(f'Assistant: {assistant_response}')
#         print(f'finish reason: {response.choices[0].finish_reason}')
#         print(f'usage: {response.usage.prompt_tokens} + {response.usage.completion_tokens}')

#         messages.append({ 'role': 'assistant', 'content': assistant_response })
#     except openai.OpenAIError as e:
#         print(f'Error: {e}')
#     except KeyboardInterrupt:
#         print('\nSystem: Bye!')
#         break 
#     except Exception as e:
#         print(f'Unexpected error: {e}')
#         break

# git diff --cached > this.patch

messages = [{ 'role': 'system', 'content': 'You are a helpful assistant.' }]
patch_content = open('this.patch').read()
messages.append({ 'role': 'user', 'content': 'summarize a git commit message from following patch file, message format should follow common practice, do not exceed 80 words:\n' + patch_content })

response = client.chat.completions.create(model='deepseek-reasoner', messages=messages)

reasoning_content = response.choices[0].message.reasoning_content
print(f'Assistant Thinking: {reasoning_content}')
assistant_response = response.choices[0].message.content
print(f'Assistant: {assistant_response}')
print(f'finish reason: {response.choices[0].finish_reason}')
print(f'usage: {response.usage.prompt_tokens} + {response.usage.completion_tokens}')

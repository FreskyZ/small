import fs from 'node:fs/promises';
import path from 'node:path';

const APIKEY = process.env.DEEPSEEK_API_KEY;
const APIURL = 'https://api.deepseek.com/v1/chat/completions';

if (!APIKEY) {
    console.error('Please set the DEEPSEEK_API_KEY environment variable.');
    process.exit(1);
}
const filenameWithoutExt = process.argv[2];
if (!filenameWithoutExt) {
    console.error('Usage: node index.mjs filename (without .json)');
    process.exit(1);
}
const fileName = path.join('history', filenameWithoutExt + '.json');
const sessions = JSON.parse(await fs.readFile(fileName, 'utf-8'));
/** @type {{ index: number, 'prompt-tokens': number, 'completion-tokens': number, messages: { role: 'system' | 'user' | 'assistant', content: string }[]}} */
const session = sessions.sessions[sessions.sessions.length - 1];

console.log(`[${fileName}] session#${session.index}, fetching`);
const startTime = Date.now();
const response = await fetch(APIURL, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${APIKEY}`,
    },
    body: JSON.stringify({ model: 'deepseek-chat', messages: session.messages }),
});
const responseBody = await response.json();
const responseMessage = responseBody.choices && responseBody.choices[0] ? responseBody.choices[0].message.content : '(no response)';
const processedMessage = responseMessage.trim()
    .replace(/\r?\n\r?\n/g, '\n') // remove empty line
    .split('\n').map(v => v.trim()).join('\n') // trim each line
    // additional refinements if need
    // .replace(/"([^"]*)"/g, '“$1”') // replace ASCII double quotes with fullwidth quotes
    // .replaceAll('...', '……') // replace ... with full width …
    // .replaceAll('**', '') // remove markdown bold

console.log(`[${fileName}] session#${session.index}, fetch complete (${Date.now() - startTime} ms)`);
session['prompt-tokens'] = responseBody.usage.prompt_tokens;
session['completion-tokens'] = responseBody.usage.completion_tokens;
session.messages.push({ role: 'assistant', content: processedMessage });
session.messages.push({ role: 'user', content: '1' });
await fs.writeFile(fileName, JSON.stringify(sessions, null, 2));

const template = await fs.readFile('template.html', 'utf-8');
const html = template.replace('<!-- messages placeholder -->', session.messages
    .map(m => `                <pre class="message ${m.role}">${m.content}</pre>`).join('\n'));
await fs.writeFile('conversation.html', html);

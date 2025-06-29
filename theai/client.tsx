
async function getAccessToken() {
    const authorizationCode = new URLSearchParams(window.location.search).get('code');
    if (!authorizationCode) {
        window.location.assign(`https://id.example.com?return=https://chat.example.com`);
    } else {
        const url = new URL(window.location.toString());
        url.searchParams.delete('code');
        window.history.replaceState(null, '', url.toString());
        const accessTokenResponse = await fetch(`https://api.example.com/signin`, { method: 'POST', headers: { authorization: 'Bearer ' + authorizationCode } });
        if (accessTokenResponse.status != 200) {
            console.log('failed to fetch access token');
        } else {
            return (await accessTokenResponse.json()).accessToken;
        }
    }
}
const accessToken = await getAccessToken();

const sessionsResponse = await fetch(`https://api.example.com/chat/v1/sessions`, { headers: { authorization: 'Bearer ' + accessToken} });
const sessions = await sessionsResponse.json();
console.log(sessions);

export {};
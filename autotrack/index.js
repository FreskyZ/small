
const itemsContainerElement = document.querySelector('div#items-container');
const workDetailElement = document.querySelector('div#work-detail-container');

// before load metadata:
// id: string,
// score: number,
// element: HTMLDivElement,
// after load metadata, inherit WorkMetadata:
// element: HTMLDivElement 
const allworks = [];
Array.from(document.querySelectorAll('div.item-container'))
    .map(e => allworks.push({ id: e.dataset['id'], score: e.dataset['score'], element: e }));
allworks.forEach(w => { delete w.element.dataset['score']; w.element.innerText = ''; });
// shuffle elements, TODO weighted shuffle?
function shuffle() {
    let currentIndex = allworks.length;
    while (currentIndex != 0) {
        const randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        const temp = allworks[randomIndex];
        allworks[randomIndex] = allworks[currentIndex];
        allworks[currentIndex] = temp;
    }
    allworks.forEach(w => w.element.remove());
    allworks.forEach(w => itemsContainerElement.appendChild(w.element));
}
shuffle();

async function setupWorkElement(work) {
    const metadataResponse = await fetch(`/${work.id}/metadata.json`);
    Object.assign(work, await metadataResponse.json());
    const imageElement = document.createElement('img');
    imageElement.className = 'cover';
    imageElement.src = `/${work.id}/cover.jpg`;
    work.element.appendChild(imageElement);
    const titleElement = document.createElement('div');
    titleElement.className = 'title';
    titleElement.innerText = work.title;
    work.element.appendChild(titleElement);
    const tagsElement = document.createElement('div');
    tagsElement.className = 'tags';
    for (const tag of work.tags) {
        const tagElement = document.createElement('span');
        tagElement.innerText = tag;
        tagsElement.appendChild(tagElement);
    }
    work.element.appendChild(tagsElement);
    work.element.addEventListener('click', () => {
        activeWorkId = activeWorkId ? null : work.id;
        renderWork();
    });
}
// for now, paralle first screen
await Promise.all(allworks.slice(0, 10).map(work => setupWorkElement(work)));
// and sequence remaining items?
allworks.slice(10).forEach(w => setupWorkElement(w));

let activeWorkId; // null indicate works view, some value indicate work view
let beforeEnterScrollPosition;
function renderWork() {
    if (!activeWorkId) {
        allworks.forEach(w => { w.element.style.display = 'grid'; });
        itemsContainerElement.style.height = 'calc(100vh - 48px)';
        itemsContainerElement.scrollTo(0, beforeEnterScrollPosition);
        Array.from(workDetailElement.children).forEach(e => e.remove());
        return;
    }
    beforeEnterScrollPosition = itemsContainerElement.scrollTop;
    itemsContainerElement.style.height = '160px';
    allworks.forEach(w => { if (w.id != activeWorkId) { w.element.style.display = 'none'; } });
    
    const work = allworks.find(w => w.id == activeWorkId);
    const workIdElement = document.createElement('div');
    workIdElement.className = 'id';
    workIdElement.innerText = activeWorkId;
    workDetailElement.appendChild(workIdElement);
    if (work.providerTags.length) {
        const originalTagsElement = document.createElement('div');
        originalTagsElement.className = 'original-tags';
        originalTagsElement.innerText = work.providerTags.join(' ');
        workDetailElement.appendChild(originalTagsElement);
    }
    if (work.actors.length) {
        const actorsElement = document.createElement('div');
        actorsElement.className = 'actors';
        for (const actor of work.actors) {
            const actorElement = document.createElement('span');
            actorElement.innerText = actor;
            actorsElement.appendChild(actorElement);
        }
        workDetailElement.appendChild(actorsElement);
    }
    const originalLinkElement = document.createElement('a');
    originalLinkElement.className = 'provider-link';
    originalLinkElement.target = '_blank';
    originalLinkElement.href = work.providerLink;
    originalLinkElement.innerText = 'provider';
    workDetailElement.appendChild(originalLinkElement);
    const providerProviderLinkElement = document.createElement('a');
    providerProviderLinkElement.className = 'provider-provider-link';
    providerProviderLinkElement.target = '_blank';
    providerProviderLinkElement.href = work.providerProviderLink;
    providerProviderLinkElement.innerText = 'provider^2';
    workDetailElement.appendChild(providerProviderLinkElement);

    for (const record of work.tracks) {
        const trackContainerElement = document.createElement('div');
        trackContainerElement.className = 'track-container';
        const progressElement = document.createElement('span');
        progressElement.className = 'duration';
        const minutes = Math.floor(record.duration / 60);
        const seconds = Math.round(record.duration - minutes * 60);
        progressElement.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        trackContainerElement.appendChild(progressElement);
        const titleElement = document.createElement('span');
        titleElement.className = 'title';
        titleElement.innerText = record.name;
        trackContainerElement.appendChild(titleElement);

        let playing = false;
        trackContainerElement.addEventListener('click', () => {
            if (!playing) {
                playing = true;
                const tempAudioContainerElement = document.createElement('div');
                tempAudioContainerElement.className = 'temp-audio-container';
                const audioElement = document.createElement('audio');
                // audioElement.controls = true;
                audioElement.src = `/${work.id}/track${record.index}.${work.audioFormat}`;
                if (work.subtitleFormat) {
                    const audioTrackElement = document.createElement('track');
                    audioTrackElement.KIND = 'subtitle';
                    audioTrackElement.src = `/${work.id}/track${record.index}.${work.audioFormat}.${work.subtitleFormat}`;
                    audioElement.appendChild(audioTrackElement);
                }
                audioElement.style.width = '400px';
                audioElement.addEventListener('timeupdate', e => {
                    const remainingTime = Math.floor(record.duration - audioElement.currentTime);
                    const minutes = Math.floor(remainingTime / 60);
                    const seconds = Math.round(remainingTime - minutes * 60);
                    progressElement.innerText = `-${minutes}:${seconds.toString().padStart(2, '0')}`;
                    const percent = Math.floor(audioElement.currentTime / record.duration * 10000) / 100;
                    trackContainerElement.style.background = `linear-gradient(to right, #666, #666 ${percent}%, #444 ${percent}%)`;
                });
                audioElement.addEventListener('pause', () => button25Element.innerText = '|>');
                audioElement.addEventListener('play', () => button25Element.innerText = '||');
                tempAudioContainerElement.appendChild(audioElement);
                // const button0Element = document.createElement('button');
                // button0Element.innerText = '<10min';
                // button0Element.addEventListener('click', e => {
                //     e.preventDefault();
                //     e.stopPropagation();
                //     audioElement.currentTime = Math.max(0, audioElement.currentTime - 600);
                // });
                // tempAudioContainerElement.appendChild(button0Element);
                const button1Element = document.createElement('button');
                button1Element.innerText = '<1min';
                button1Element.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    audioElement.currentTime = Math.max(0, audioElement.currentTime - 60);
                });
                tempAudioContainerElement.appendChild(button1Element);
                const button2Element = document.createElement('button');
                button2Element.innerText = '<10s';
                button2Element.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    audioElement.currentTime = Math.max(0, audioElement.currentTime - 10);
                });
                tempAudioContainerElement.appendChild(button2Element);
                const button25Element = document.createElement('button');
                button25Element.innerText = '|>';
                button25Element.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    audioElement.paused ? audioElement.play() : audioElement.pause();
                });
                tempAudioContainerElement.appendChild(button25Element);
                const button3Element = document.createElement('button');
                button3Element.innerText = '10s>';
                button3Element.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    audioElement.currentTime = Math.min(record.duration, audioElement.currentTime + 10);
                });
                tempAudioContainerElement.appendChild(button3Element);
                const button4Element = document.createElement('button');
                button4Element.innerText = '1min>';
                button4Element.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    audioElement.currentTime = Math.min(record.duration, audioElement.currentTime + 60);
                });
                tempAudioContainerElement.appendChild(button4Element);
                const button5Element = document.createElement('button');
                button5Element.innerText = '10min>';
                button5Element.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    audioElement.currentTime = Math.min(record.duration, audioElement.currentTime + 600);
                });
                tempAudioContainerElement.appendChild(button5Element);
                trackContainerElement.appendChild(tempAudioContainerElement);
            } else {
                playing = false;
                trackContainerElement.querySelector('div.temp-audio-container').remove();
                const minutes = Math.floor(record.duration / 60);
                const seconds = Math.round(record.duration - minutes * 60);
                progressElement.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                trackContainerElement.style.background = undefined;
            }
        });
        workDetailElement.appendChild(trackContainerElement);
    }
}

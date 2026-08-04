
// partial properties compare to management script
interface WorkMetadata {
    // loaded for all works before loading work detail
    id: string,
    score: number,
    title: string,
    // loaded after load work detail
    providerLink: string,
    providerProviderLink?: string,
    actors: string[],
    providerTags: string[],
    addTime: string,
    lastAccessTime: string,
    tags: string[],
    comments?: string[],
    audioFormat?: string,
    subtitleFormat?: string,
    tracks: TrackRecord[],
}
interface TrackRecord {
    index: number,
    name: string,
    duration: number,
    comments?: string[],
    // not actually used, but to determine whether this track has subtitle
    subtitleFileIndex?: number,
    workInProgress?: true,
    // client side properties
    subtitleText: string,
    // start and end time in seconds
    subtitleRecords: { start: number, end: number, text: string }[],
}

// get all work summary data that build by management script
function getAllWorks() {
    const results: WorkMetadata[] = [];
    Array.from(document.querySelectorAll<HTMLDivElement>('div.summary')).forEach(element => {
        results.push({
            id: element.dataset['id'],
            title: element.innerText,
        } as unknown as WorkMetadata);
        element.remove();
    });
    // shuffle elements
    let currentIndex = results.length;
    while (currentIndex != 0) {
        const randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        const temp = results[randomIndex];
        results[randomIndex] = results[currentIndex];
        results[currentIndex] = temp;
    }
    // read url query id and...put it at first element
    let queryId = new URL(window.location as any).searchParams.get('id');
    queryId = queryId && /^\d+$/.test(queryId) ? `RJ${queryId}` : queryId;
    if (queryId && queryId.startsWith('RJ') && results.some(w => w.id == queryId)) {
        // because put this as last statement of this module does not work because conflict with render implementation magic
        // TODO try to make this work
        // render({ activeWorkId: queryId });
        const [work] = results.splice(results.findIndex(w => w.id == queryId), 1);
        results.unshift(work);
    }
    return results;
}
const allworks = getAllWorks();

// constant config region?
const WorkPerPage = 16;

// all page state
interface PageState {
    pageNumber: number,
    scrollPosition: number,
    activeWorkId: string,
    // track plain index is not track index
    activeTrackPlainIndex: number,
}
const state: PageState = {
    // start with invalid value, so that diff check in render can initial render page number = 1
    pageNumber: 0,
    scrollPosition: 0,
    activeWorkId: null,
    activeTrackPlainIndex: -1,
};

// TODO
const notificationElements = {
    mask: document.querySelector<HTMLDivElement>('div#notification-mask'),
    container: document.querySelector<HTMLDivElement>('div#notification-container'),
};

// setup all elements
const pagerElements = {
    container: document.querySelector<HTMLDivElement>('div#pager'),
    prevButton: document.querySelector<HTMLButtonElement>('button#page-prev'),
    nextButton: document.querySelector<HTMLButtonElement>('button#page-next'),
    valueInput: document.querySelector<HTMLInputElement>('input#page-number'),
    totalCount: document.querySelector<HTMLSpanElement>('span#page-count'),
};
pagerElements.container.classList.add('visible');
pagerElements.totalCount.innerText = `/${Math.ceil(allworks.length / WorkPerPage)}`;
pagerElements.prevButton.addEventListener('click', () => {
    if (state.pageNumber > 1) { render({ pageNumber: state.pageNumber - 1 }); }
});
pagerElements.nextButton.addEventListener('click', () => {
    if (state.pageNumber < Math.ceil(allworks.length / WorkPerPage)) { render({ pageNumber: state.pageNumber + 1 }); }
});
pagerElements.valueInput.addEventListener('focusin', () => pagerElements.valueInput.select());
pagerElements.valueInput.addEventListener('change', e => {
    const newPageNumber = +pagerElements.valueInput.value;
    if (!isNaN(newPageNumber) && newPageNumber >= 1 && newPageNumber <= Math.ceil(allworks.length / WorkPerPage)) {
        render({ pageNumber: newPageNumber });
    }
})

const summaryElements = {
    container: document.querySelector<HTMLDivElement>('div#summary-container'),
    works: [] as {
        container: HTMLDivElement,
        image: HTMLImageElement,
        title: HTMLDivElement,
    }[],
};
function createSummaryElements() {
    summaryElements.works = new Array<void>(WorkPerPage).fill().map(() => {
        const container = document.createElement('div');
        container.classList.add('summary');
        container.addEventListener('click', () => {
            render({
                activeWorkId: state.activeWorkId ? null : container.dataset['id'],
                // close player when closing work detail
                activeTrackPlainIndex: state.activeWorkId ? -1 : state.activeTrackPlainIndex,
            });
        });
        const image = document.createElement('img');
        container.appendChild(image);
        const title = document.createElement('div');
        title.className = 'title';
        container.appendChild(title);
        summaryElements.container.appendChild(container);
        return { container, image, title };
    });
}
createSummaryElements();
// your javascript api will translate this?
const MaxTagCount = +summaryElements.container.dataset.maxTag;
const MaxTrackCount = +summaryElements.container.dataset.maxTrack;
const MaxCommentCount = +summaryElements.container.dataset.maxComment;
delete summaryElements.container.dataset.maxTag;
delete summaryElements.container.dataset.maxTrack;
delete summaryElements.container.dataset.maxComment;

// detail container for the active work
const detailElements = {
    container: document.querySelector<HTMLDivElement>('div#detail-container'),
    workId: null as HTMLSpanElement,
    providerLink: null as HTMLAnchorElement,
    providerProviderLink: null as HTMLAnchorElement,
    // similar to track containers, use a max count should be enough,
    // 3 different kind of tags are same kind of element with different class
    tags: [] as HTMLSpanElement[],
    addTime: null as HTMLSpanElement,
    accessTime: null as HTMLSpanElement,
};
function createDetailElements() {
    // line 1: id, provider link, provider provider link,
    const line1Element = document.createElement('div');
    line1Element.classList.add('line1');
    detailElements.workId = document.createElement('span');
    detailElements.workId.classList.add('id');
    detailElements.workId.addEventListener('click', () => {
        navigator.clipboard.writeText(state.activeWorkId);
        detailElements.workId.innerText = 'Copied!';
        setTimeout(() => detailElements.workId.innerText = state.activeWorkId, 1000);
    });
    // seems click not fired on touch screen,
    // this still does not work because currently I'm not using https so write clipboard is not allowed
    // while actually no need of this when using on mobile phone so ok
    detailElements.workId.addEventListener('touchend', () => {
        detailElements.workId.innerText = 'Copied!';
        setTimeout(() => detailElements.workId.innerText = state.activeWorkId, 1000);
        navigator.clipboard.writeText(state.activeWorkId);
    });
    line1Element.appendChild(detailElements.workId);
    detailElements.providerLink = document.createElement('a');
    detailElements.providerLink.classList.add('provider-link');
    detailElements.providerLink.target = '_blank';
    detailElements.providerLink.referrerPolicy = 'no-referrer';
    detailElements.providerLink.innerText = 'provider';
    line1Element.appendChild(detailElements.providerLink);
    detailElements.providerProviderLink = document.createElement('a');
    // no need to distinguish them in style
    detailElements.providerProviderLink.classList.add('provider-link');
    detailElements.providerProviderLink.target = '_blank';
    detailElements.providerProviderLink.referrerPolicy = 'no-referrer';
    detailElements.providerProviderLink.innerText = 'provider';
    line1Element.appendChild(detailElements.providerProviderLink);
    detailElements.container.appendChild(line1Element);
    // line 2: provider tags (gray), actors (orange?), my tags (green)
    const line2Element = document.createElement('div');
    line2Element.classList.add('line2');
    detailElements.tags = new Array<void>(MaxTagCount).fill().map(() => {
        const tag = document.createElement('span');
        tag.classList.add('tag');
        line2Element.appendChild(tag);
        return tag;
    });
    detailElements.container.appendChild(line2Element);
    // line 3: times
    const line3Element = document.createElement('div');
    line3Element.classList.add('line3');
    detailElements.addTime = document.createElement('span');
    detailElements.addTime.classList.add('time');
    line3Element.appendChild(detailElements.addTime);
    detailElements.accessTime = document.createElement('span');
    detailElements.accessTime.classList.add('time');
    line3Element.appendChild(detailElements.accessTime);
    detailElements.container.appendChild(line3Element);
}
createDetailElements();

const trackElements = {
    container: document.querySelector<HTMLDivElement>('div#tracks-container'),
    tracks: [] as {
        container: HTMLDivElement,
        title: HTMLSpanElement,
        duration: HTMLSpanElement,
    }[],
    comments: [] as HTMLDivElement[],
}
function createTrackElements() {
    trackElements.tracks = new Array<void>(MaxTrackCount).fill().map((_, plainIndex) => {
        const container = document.createElement('div');
        container.classList.add('track-container');
        container.addEventListener('click', () => {
            if (container.classList.contains('wip')) {
                alert('track work in progress');
            } else {
                render({ activeTrackPlainIndex: state.activeTrackPlainIndex == plainIndex ? -1 : plainIndex });
            }
        });
        const title = document.createElement('span');
        title.classList.add('title');
        container.appendChild(title);
        const duration = document.createElement('span');
        duration.classList.add('duration');
        container.appendChild(duration);
        trackElements.container.appendChild(container);
        return { container, title, duration };
    });
    trackElements.comments = new Array<void>(MaxCommentCount).fill().map(() => {
        const comment = document.createElement('div');
        comment.classList.add('comment');
        trackElements.container.appendChild(comment);
        return comment;
    });
}
createTrackElements();

// player element
const playerElements = {
    container: document.querySelector<HTMLDivElement>('div#player-container'),
    audio: null as HTMLAudioElement,
    // oh, currently max sentence count is near 800, which nearly need a virtual scroll,
    // actually I'm not that care about the active subtitle, so a plain textarea is enough
    subtitle: null as HTMLDivElement,
    buttons: [] as HTMLButtonElement[],
};
function createPlayerElements() {

    const audio = playerElements.audio = document.createElement('audio');
    audio.autoplay = true;
    playerElements.container.appendChild(audio);

    playerElements.subtitle = document.createElement('div');
    playerElements.subtitle.classList.add('subtitle-container');
    playerElements.container.appendChild(playerElements.subtitle);

    const buttonContainer = document.createElement('div');
    buttonContainer.classList.add('button-container');
    function addButton(text: string, handleClick: () => any) {
        const button = document.createElement('button');
        button.innerText = text;
        button.addEventListener('click', () => {
            handleClick();
        });
        playerElements.buttons.push(button);
        buttonContainer.appendChild(button);
    }
    addButton('<1min', () => audio.currentTime = Math.max(0, audio.currentTime - 60));
    addButton('<10s', () => audio.currentTime = Math.max(0, audio.currentTime - 10));
    addButton('||', () => audio.readyState >= audio.HAVE_METADATA ? (audio.paused ? audio.play() : audio.pause()) : void 0);
    addButton('>10s', () => audio.currentTime = Math.min(audio.duration, audio.currentTime + 10));
    addButton('>1min', () => audio.currentTime = Math.min(audio.duration, audio.currentTime + 60));
    addButton('>10min', () => audio.currentTime = Math.min(audio.duration, audio.currentTime + 600));
    playerElements.container.appendChild(buttonContainer);

    audio.addEventListener('timeupdate', () => {
        if (state.activeTrackPlainIndex < 0) { return; }
        const remainingTime = Math.floor(audio.duration - audio.currentTime);
        if (isNaN(remainingTime)) { return; }
        const minutes = Math.floor(remainingTime / 60);
        const seconds = Math.round(remainingTime - minutes * 60);
        trackElements.tracks[state.activeTrackPlainIndex].duration.innerText = `-${minutes}:${seconds.toString().padStart(2, '0')}`;
        const percent = Math.floor(audio.currentTime / audio.duration * 9950) / 100 + 0.5;
        trackElements.tracks[state.activeTrackPlainIndex].container.style.background = `linear-gradient(to right, #666, #666 ${percent}%, #444 ${percent}%)`;
        const work = allworks.find(w => w.id == state.activeWorkId);
        const track = work?.tracks?.[state.activeTrackPlainIndex];
        // this seems easier?
        if (work && track && work.subtitleFormat == 'vss') {
            const newInnerText = track.subtitleRecords.map(c => {
                const negativeTime = track.duration - c.start;
                const minutes = Math.floor(negativeTime / 60);
                const seconds = Math.floor(negativeTime - minutes * 60);
                const current = c.start < audio.currentTime && c.end > audio.currentTime;
                return `-${minutes}:${seconds.toString().padStart(2, '0')} ${current ? '>> ' : ''}${c.text}${current ? ' <<' : ''}`;
            }).join('\n');
            if (playerElements.subtitle.innerText != newInnerText) { playerElements.subtitle.innerText = newInnerText; }
        }
    });
    audio.addEventListener('pause', () => playerElements.buttons[2].innerText = '|>');
    audio.addEventListener('play', () => playerElements.buttons[2].innerText = '||');
}
createPlayerElements();

// input newstate here so you can diff them to make render more efficient
async function render(newState: Partial<PageState>) {

    if ('pageNumber' in newState && newState.pageNumber != state.pageNumber) {
        state.pageNumber = newState.pageNumber;
        pagerElements.valueInput.value = state.pageNumber.toString();
        // summary
        summaryElements.container.scrollTo(0, 0);
        summaryElements.works.forEach(e => e.container.classList.remove('visible'));
        // slice allow ending index overflow by the way
        const displayWorks = allworks.slice(WorkPerPage * (state.pageNumber - 1), WorkPerPage * state.pageNumber);
        for (const [work, index] of displayWorks.map((w, i) => [w, i] as const)) {
            summaryElements.works[index].container.classList.add('visible');
            summaryElements.works[index].container.dataset['id'] = work.id;
            summaryElements.works[index].image.src = `./${work.id}/cover.avif`;
            summaryElements.works[index].title.innerText = work.title;
        }
    }

    const oldWorkId = state.activeWorkId;
    if ('activeWorkId' in newState && newState.activeWorkId != state.activeWorkId) {
        state.activeWorkId = newState.activeWorkId;
        if (!newState.activeWorkId) {
            // pager
            pagerElements.container.classList.add('visible');
            // summary
            allworks // use similar slice to only visible display works
                .slice(WorkPerPage * (state.pageNumber - 1), WorkPerPage * state.pageNumber)
                .map((_, index) => summaryElements.works[index].container.classList.add('visible'));
            summaryElements.container.scrollTo(0, state.scrollPosition);
            // detail
            detailElements.container.classList.remove('visible');
            // tracks
            trackElements.container.classList.remove('visible');
            // player
            playerElements.container.classList.remove('visible');
        } else {
            // pager
            pagerElements.container.classList.remove('visible');
            // summary
            state.scrollPosition = summaryElements.container.scrollTop;
            summaryElements.works.forEach(w => w.container.classList.remove('visible'));
            summaryElements.works.find(w => w.container.dataset['id'] == state.activeWorkId).container.classList.add('visible');
            // detail
            const work = allworks.find(w => w.id == state.activeWorkId);
            // this should be a good condition to check whether data is loaded
            if (!Array.isArray(work.tracks)) {
                const response = await fetch(`./${work.id}/metadata.json`);
                if (!response.ok) { alert('fetch metadata can be not ok?'); return; }
                Object.assign(work, await response.json());
            }
            detailElements.container.classList.add('visible');
            detailElements.workId.innerText = work.id;
            detailElements.providerLink.href = work.providerLink;
            detailElements.providerProviderLink.href = work.providerProviderLink;
            detailElements.tags.forEach(t => t.classList.remove('visible'));
            let tagIndex = 0;
            const addTag = (text: string, className: string) => {
                const element = detailElements.tags[tagIndex];
                element.innerText = text;
                element.className = `tag visible ${className}`;
                tagIndex += 1;
            };
            if (work.subtitleFormat) {
                addTag(work.tracks.some(t => t.subtitleFileIndex == -1) ? '自动字幕付' : '字幕付', 'provider-tag');
            }
            work.providerTags.forEach(v => addTag(v, 'provider-tag'));
            work.actors.forEach(v => addTag(v, 'actor'));
            work.tags.forEach(v => addTag(v, 'my-tag'));
            addTag(`${work.score >= 0 ? '+' : '-'}${work.score}`, 'my-score');
            detailElements.addTime.innerText = `add: ${work.addTime}`;
            detailElements.accessTime.innerText = `access: ${work.lastAccessTime}`;
            // tracks
            trackElements.container.classList.add('visible');
            trackElements.tracks.forEach(t => t.container.classList.remove('visible'));
            trackElements.comments.forEach(c => c.classList.remove('visible'));
            let commentIndex = 0;
            let trackContainerChildIndex = 1;
            for (const comment of work.comments ?? []) {
                trackElements.comments[commentIndex].classList.add('visible');
                trackElements.comments[commentIndex].innerText = `--"${comment}"`;
                trackElements.comments[commentIndex].style.order = trackContainerChildIndex.toString();
                commentIndex += 1;
                trackContainerChildIndex += 1;
            }
            // note that track plain index is not track index
            for (const [track, trackPlainIndex] of work.tracks.map((t, i) => [t, i] as const)) {
                trackElements.tracks[trackPlainIndex].container.classList.add('visible');
                if (track.workInProgress) {
                    trackElements.tracks[trackPlainIndex].container.classList.add('wip');
                } else {
                    trackElements.tracks[trackPlainIndex].container.classList.remove('wip');
                }
                trackElements.tracks[trackPlainIndex].title.innerText = `${track.index}. ${track.name ?? `トラック${track.index}`}`;
                const minutes = Math.floor(track.duration / 60);
                const seconds = Math.floor(track.duration - 60 * minutes);
                trackElements.tracks[trackPlainIndex].duration.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                trackElements.tracks[trackPlainIndex].container.style.order = trackContainerChildIndex.toString();
                trackContainerChildIndex += 1;
                for (const comment of track.comments ?? []) {
                    trackElements.comments[commentIndex].classList.add('visible');
                    trackElements.comments[commentIndex].innerText = `--"${comment}"`;
                    trackElements.comments[commentIndex].style.order = trackContainerChildIndex.toString();
                    commentIndex += 1;
                    trackContainerChildIndex += 1;
                }
            }
        }
    }

    if ('activeTrackPlainIndex' in newState && newState.activeTrackPlainIndex != state.activeTrackPlainIndex) {
        const oldPlainIndex = state.activeTrackPlainIndex;
        state.activeTrackPlainIndex = newState.activeTrackPlainIndex;
        if (oldPlainIndex >= 0) {
            trackElements.tracks[oldPlainIndex].container.style.background = '';
            trackElements.tracks[oldPlainIndex].container.classList.remove('active');
            const work = allworks.find(w => w.id == oldWorkId);
            const track = work.tracks[oldPlainIndex];
            const minutes = Math.floor(track.duration / 60);
            const seconds = Math.floor(track.duration - 60 * minutes);
            trackElements.tracks[oldPlainIndex].duration.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        if (state.activeTrackPlainIndex < 0) {
            playerElements.container.classList.remove('visible');
            playerElements.audio.src = '';
        } else {
            const work = allworks.find(w => w.id == state.activeWorkId);
            const track = work.tracks[state.activeTrackPlainIndex];
            playerElements.container.classList.add('visible');
            playerElements.audio.src = `./${work.id}/track${track.index}.${work.audioFormat}`;
            trackElements.tracks[state.activeTrackPlainIndex].container.classList.add('active');
            if (track.subtitleFileIndex) {
                playerElements.subtitle.classList.add('visible');
                if (!Array.isArray(track.subtitleText)) {
                    const response = await fetch(`./${work.id}/track${track.index}.${work.subtitleFormat}`);
                    if (!response.ok) {
                        track.subtitleText = `failed to load subtitle: ${response.status}`;
                        track.subtitleRecords = [];
                    } else {
                        track.subtitleText = await response.text();
                        track.subtitleRecords = work.subtitleFormat == 'vss'
                            ? track.subtitleText.trim().split('\n').filter(x => x).map(r => {
                                const [start, end, text] = r.split(',').map(x => x.trim());
                                return { start: +start, end: +end, text };
                            }) : [];
                    }
                }

                playerElements.subtitle.scroll(0, 0);
                playerElements.subtitle.innerText = track.subtitleRecords.map(c => {
                    const negativeTime = track.duration - c.start;
                    const minutes = Math.floor(negativeTime / 60);
                    const seconds = Math.floor(negativeTime - minutes * 60);
                    return `-${minutes}:${seconds.toString().padStart(2, '0')} ${c.text}`;
                }).join('\n') || track.subtitleText;
            } else {
                playerElements.subtitle.classList.remove('visible');
            }
        }
    }
}
render({ pageNumber: 1 });

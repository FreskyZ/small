import fs from 'node:fs/promises';
import npfs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import { styleText } from 'node:util';
import { finished } from 'node:stream/promises';
import ts from 'typescript';

const config = JSON.parse(await fs.readFile('config.json', 'utf-8')) as {
    dataDirectory: string,
    providerBaseUri: string,
    providerApiBaseUri: string,
};
console.log(`autotrack.ts: data directory ${config.dataDirectory}`);
// console.log(`autotrack.ts: provider base uri ${config.providerBaseUri}`);
// console.log(`autotrack.ts: provider api base uri ${config.providerApiBaseUri}`);

function makepath(...paths: string[]) {
    return path.join(config.dataDirectory, ...paths);
}

// urls are too long to help readablity
const LOGURL = !!process.env['AT_LOGURL'];
// they are simple console.log for now
function logInfo(content: string) {
    console.log(`autotrack.ts: ${content}`);
}
function logError(content: string) {
    console.log(`autotrack.ts: ${styleText('red', 'error')}: ${content}`);
}

// temporal api is very confusing, for now, wrap them inside these functions
function getCurrentTime() {
    const v = Temporal.Now.zonedDateTimeISO();
    return `${v.year}${v.month.toString().padStart(2, '0')}${v.day.toString().padStart(2, '0')}T${
        v.hour.toString().padStart(2, '0')}${v.minute.toString().padStart(2, '0')}${v.second.toString().padStart(2, '0')}Z`;
}
// parse YYYYMMDDThhmmssZ
function parseMetadataTime(value: string) {
    return Temporal.ZonedDateTime.from({
        year: +value.substring(0, 4),
        month: +value.substring(4, 6),
        day: +value.substring(6, 8),
        hour: +value.substring(9, 11),
        minute: +value.substring(11, 13),
        second: +value.substring(13, 15),
        timeZone: 'UTC',
    });
}

function getDisplayFileSize(size: number | undefined) {
    let displaySize = `${size}b`;
    if (size) {
        if (size > 1073741824) {
            displaySize = `${Math.round(size / 1073741824 * 100) / 100}gb`;
        } else if (size > 1048576) {
            displaySize = `${Math.round(size / 1048576 * 100) / 100}mb`;
        } else if (size > 1024) {
            displaySize = `${Math.round(size / 1024 * 100) / 100}kb`;
        }
    }
    return displaySize;
}
function getDisplayDuration(duration: number | undefined) {
    let displayDuration = '?s';
    if (duration) {
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration - hours * 3600) / 60);
        const seconds = Math.round(duration - hours * 3600 - minutes * 60);
        displayDuration = hours ? `${hours}h${minutes}m${seconds}s` : minutes ? `${minutes}m${seconds}s` : `${seconds}s`;
    }
    return displayDuration;
}
function getDisplayTemporalDuration(duration: Temporal.Duration) {
    let b = '';
    if (duration.hours) { b += `${duration.hours}h`; }
    if (duration.minutes) { b += `${duration.minutes}m`; }
    b += `${duration.seconds}s`;
    return b;
}

function createProgressPipe(totalSize: number): stream.Duplex {
    const startTime = Temporal.Now.plainDateTimeISO();
    let transferredBytes = 0;
    // samples of transferred bytes for speed estimation, order by time asc
    let samples: { time: Temporal.PlainDateTime, value: number }[] = [];
    // throttle updating
    let lastUpdateTime = Temporal.Now.plainDateTimeISO();
    // self trigger update if no auto trigger for some time
    let selfTriggerTimer: NodeJS.Timeout;

    const update = (newLength: number, completed: boolean) => {
        if (selfTriggerTimer) { clearTimeout(selfTriggerTimer); }
        transferredBytes += newLength;
        const now = Temporal.Now.plainDateTimeISO();
        // note that can flush befor eexpected totalsize
        if (Temporal.Duration.compare(now.since(lastUpdateTime), { seconds: 1 }) >= 0 || completed) {
            let message = '  ';
            message += getDisplayTemporalDuration(now.since(startTime));
            message += ' ';
            message += getDisplayFileSize(transferredBytes);
            message += '/'
            message += getDisplayFileSize(totalSize);

            const sample = samples.find(s => Temporal.Duration.compare(now.since(s.time), { minutes: 1 }) < 0);
            if (completed) {
                const speed = transferredBytes / now.since(startTime).total('seconds');
                message += ' ';
                message += getDisplayFileSize(speed); // display overall speed by the way
                message += '/s'
                // nothing to display in last message eta part
            } else if (!sample || Temporal.Duration.compare(now.since(sample.time), { seconds: 5 }) < 0) {
                // don't use duration < 5s
                message += ' ETA unknown';
            } else {
                const speed = (transferredBytes - sample.value) / now.since(sample.time).total('seconds');
                message += ' ';
                message += getDisplayFileSize(speed);
                message += '/s'
                const estimateRemainingTime = (totalSize - transferredBytes) / speed;
                message += ' ETA ';
                message += getDisplayDuration(estimateRemainingTime);
            }

            process.stderr.write('\r\x1b[K');
            process.stdout.write(message);
            if (completed) { console.log(); }
            samples.push({ time: now, value: transferredBytes });
            samples = samples.filter(s => Temporal.Duration.compare(now.since(s.time), { minutes: 1 }) < 0);
            lastUpdateTime = now;
            if (!completed) { selfTriggerTimer = setTimeout(() => update(0, false), 1000); }
        }
    };
    return new stream.Transform({
        flush(callback) { update(0, true); callback(); },
        transform(chunk, _encoding, callback) { update(chunk.length, false); callback(null, chunk); },
    });
}

function printUsage() {
    console.log('USAGE: autotrack.ts SUBCOMMAND');
    console.log('  page                                make web page');
    console.log('  migrate                             some migration helper commands');
    console.log('  WORKID                              display metadata and file info');
    console.log('    title TITLE                       set work title');
    console.log('    tag TAG                           toggle tag');
    console.log('    comment [COMMENT]                 set work comment, use empty to clear');
    console.log('    score +VALUE/-VALUE/=VALUE        set work score');
    console.log('    access                            set work access time');
    console.log('    track INDEX name NAME             set track name');
    console.log('    track INDEX comment COMMNET       set track comment');
    console.log('    add [EDITIONID/]RAWINDEX           add a track WITHOUT download');
    console.log('    add [EDITIONID/]RAWINDEX sub [EDITIONID/]RAWINDEX');
    console.log('                                      add a track with subtitle WITHOUT download');
    console.log('    add [EDITIONID/]RAWINDEX:ENDRAWINDEX[:STEP] [sub [EDITIONID/]RAWINDEX:ENDRAWINDEX[:STEP]]');
    console.log('                                      batch add tracks maybe with subtitle WITHOUT download');
    console.log('                                      similar to python syntax, end index is exclusive, step default 1');
    console.log('    extra [EDITIONID/]RAWINDEX        download extra file, not record to metadata');
    console.log('    dry                               dry run download track files');
    console.log('    commit                            commit track and subtitle list and download track files');
    console.log('    audio                             modernize audio codec to use at client side and storage site');
    console.log('    subtitle                          simplify subtitle files to use at client side and storage site');
}

// return null for already printed error
// return RJ\d{8} if pass validation, while still accept provider and provider provider's RJ\d{6} syntax
async function getWorkId(inputValue: string) {

    // handle short work id
    let workId: string = null;
    if (inputValue && /^RJ\d+$/.test(inputValue)) {
        if (inputValue.length != 8 && inputValue.length != 10) {
            return logError('invalid work id, unexpected length');
        }
        if (inputValue.length == 8) {
            // migrate \d{6} to unified \d{8} by start padding with 0
            workId = `RJ00${inputValue.substring(2)}`;
        } else {
            workId = inputValue;
        }
    } else if (inputValue && /^\d+$/.test(inputValue)) {
        const directoryNames = await fs.readdir(config.dataDirectory);
        const matches = directoryNames.filter(d => d.startsWith('RJ') && d.endsWith(inputValue));
        if (matches.length == 0) {
            return logError(`short work id ${inputValue} not found`);
        } else if (matches.length > 1) {
            return logError(`short work id ${inputValue} ambiguous`);
        } else {
            workId = matches[0];
            logInfo(`work id ${workId}`);
        }
    } else {
        return logError(`USAGE: autotrack.ts WORKID`);
    }

    // check language edition id
    if (workId) {
        const directoryNames = await fs.readdir(config.dataDirectory);
        await Promise.all(directoryNames.filter(d => d.startsWith('RJ')).map(async existingWorkId => {
            const metadataPath = makepath(existingWorkId, 'metadata.json');
            if (npfs.existsSync(metadataPath)) {
                const existingMetadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
                if (existingMetadata.languageEditions.includes(workId)) {
                    return logError(`cannot use language edition id, use main work id ${existingWorkId} instead`);
                }
            }
        }));
    }
    return workId;
}

// only these properties are interested
interface WorkInfo {
    title: string,
    tags: {
        i18n: { 'ja-jp': { name: string } },
    }[],
    vas: { name: string }[],
    source_url?: string,
    other_language_editions_in_db: { source_id: string }[],
    thumbnailCoverUrl: string,
}
interface FileInfoNode {
    // by the way, mp4 is also audio
    type: 'folder' | 'audio' | 'text' | 'image',
    title: string,
    // afaik
    // for folder: children
    // for audio: duration, size, download url
    // for text: duration?, size, download url
    // for image: size, download url
    children?: FileInfoNode[],
    duration?: number,
    size?: number,
    mediaDownloadUrl?: string,
}

// use work id as api parameter, use main work id as work directory
// work info use a tree structure, the returned single node is a virtual root node
// return [null, null] for already printed error UPDATE no expected error, all crash for now
async function getRawMetadata(workId: string, mainWorkId: string): Promise<[WorkInfo, FileInfoNode]> {
    const url = new URL(config.providerApiBaseUri);
    const displayId = workId == mainWorkId ? workId : `${workId} main work id ${mainWorkId}`;
    await fs.mkdir(makepath(mainWorkId), { recursive: true });

    let workinfo: WorkInfo;
    const workinfoPath = makepath(mainWorkId, `${workId}-workinfo.json`);
    if (npfs.existsSync(workinfoPath)) {
        // no need to precisely and gracefully handle json error in this small script
        workinfo = JSON.parse(await fs.readFile(workinfoPath, 'utf-8'));
    } else {
        // the original code use `/api/workInfo/${workId.substring(2)}` for both \d{6} and \d{8},
        // which includes prefix 0 for \d{8} ids and it works smoothly for all 200+ works,
        // I think this kind of prefix 0 numbers should be rejected by server side api gateway, etc.
        // while remove prefix also works so remove prefix
        url.pathname = `/api/workInfo/${+workId.substring(2)}`;
        logInfo(`download work info ${displayId}`);
        if (LOGURL) { logInfo(`download url ${url}`); }
        // ATTENTION because of similar reason, don't parallel these web requests
        const response = await fetch(url);
        // this meet 522 cloudflare timeout error (with the familiar cloudflare error page by the way)
        // and says cloudflare works but the original server don't work, I generally think it's rate limiting
        if (!response.ok) {
            logError(`download response not ok ${response.status}`);
            return [null, null];
        }
        // no need to precisely and gracefully handle network error in this small script
        workinfo = await response.json();
        await fs.writeFile(workinfoPath, JSON.stringify(workinfo, undefined, 2));
        logInfo(`download work info ${displayId} complete`);
    }

    let topLevelNodes: FileInfoNode[];
    const fileinfoPath = makepath(mainWorkId, `${workId}-fileinfo.json`);
    if (npfs.existsSync(fileinfoPath)) {
        topLevelNodes = JSON.parse(await fs.readFile(fileinfoPath, 'utf-8'));
    } else {
        url.pathname = `/api/tracks/${+workId.substring(2)}`;
        url.searchParams.append('v', '2');
        logInfo(`download track info ${displayId}`);
        if (LOGURL) { logInfo(`download url ${url}`); }
        const response = await fetch(url);
        topLevelNodes = await response.json();
        await fs.writeFile(fileinfoPath, JSON.stringify(topLevelNodes, undefined, 2));
        logInfo(`download track info ${displayId} complete`);
    }
    const rootNode: FileInfoNode = { type: 'folder', title: 'root', children: topLevelNodes };

    // download cover by the way
    if (workId == mainWorkId) {
        // cover image will convert to cover.avif later, don't download cover image if that exists
        const coverImagePath = makepath(mainWorkId, 'cover.jpg');
        const coverImagePath2 = makepath(mainWorkId, 'cover.avif');
        if (!npfs.existsSync(coverImagePath) && !npfs.existsSync(coverImagePath2)) {
            const url = new URL(workinfo.thumbnailCoverUrl);
            if (!url.pathname.endsWith('.jpg')) {
                logError('cover image url not a jpg? skip');
            } else {
                logInfo(`download cover image ${workId}`);
                if (LOGURL) { logInfo(`download url ${url}`); }
                const response = await fetch(url);
                // no need to precisely and gracefully handle network and fs error in this small script
                await finished(stream.Readable.fromWeb(response.body).pipe(npfs.createWriteStream(coverImagePath)));
                logInfo(`download cover image ${workId} complete`);
            }
        }
    }

    return [workinfo, rootNode];
}

interface WorkMetadata {
    // some of the properties are copied from raw metadata,
    // so that client side don't need to load multiple metadata files
    id: string,
    providerLink: string,
    providerProviderLink?: string,
    actors: string[],
    providerTags: string[],
    // work ids for language editions, variable names use eid (edition work id)
    // // this concept was named subwork, but that conflict with concept of subtitle which also abbreviated sub,
    // // so name this back to language editions same as raw workinfo, which seems to be a standard name of concept
    // // in publishing areas (doujin asmr works are also published work)
    languageEditions: string[],
    // custom properties
    // note that title is customizable to remove unnecessary decorations
    title: string,
    addTime: string,
    lastAccessTime: string,
    tags: string[],
    // retire reason
    retired?: string,
    comments?: string[],
    // comment for backend management operations, not displayed at client
    // e.g. video file is 404 at the time of writing
    managementComments?: string[],
    // score generally works as one access time +1,
    // but if you feel very good can +2, and feel not good -1
    score: number,
    // main work id or edition id
    audioWorkId?: string,
    // this is result audio format, not redundent information from track.providerpath,
    // provider path accept mp3, wav and flac, result format currently only allow ogg,
    // before conversion complete and run WORKID ogg command to mark audio format, this is empty
    audioFormat?: string,
    // empty for no subtitle, main work id or edition id
    subtitleWorkId?: string,
    // this is result subtitle format, not redundent information from track.subtitleproviderpath,
    // see convertProviderSubtitle, before conversion or external operation complete, this is empty
    subtitleFormat?: string,
    // no need to use tree structure because most of the time I only use one directory,
    // even if really need same name files from multiple directory I can prepend something
    // like folder name to dinstinguish, even for large works with like 100 files spreaded
    // in 3 layer directories, add a full path to track info is very enough for displaying
    // and manipulating, no need to make this tree structure
    tracks: TrackMetadata[],
}
interface TrackMetadata {
    index: number,
    // name will be empty for no meaningful name available (provider and provider provider use track1, track01, etc.)
    name?: string,
    duration: number,
    comments?: string[],
    // index in sorted flatten reocrd list of the work specified by audioworkid
    // NOTE start from 1
    // TODO rename to audiofileindex
    providerPath: number,
    // index in sorted flatten file list of the work specified by subtitleworkid
    // NOTE start from 1
    // exist if have subtitle, regardless of belong to main work or editions
    // -1 for asr
    // TODO rename to subtitlefileindex
    subtitleProviderPath?: number,
    // let client display something instead of silent 404
    workInProgress?: true,
}
// get or create metadata, only main work has main metadata
async function getMetadata(workId: string, workinfo: WorkInfo) {
    let metadata: WorkMetadata;
    const metadataPath = makepath(workId, 'metadata.json');
    if (npfs.existsSync(metadataPath)) {
        // no need to precisely and gracefully handle json error in this small script
        metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    } else {
        const currentTime = getCurrentTime();
        const providerLink = new URL(config.providerBaseUri);
        // now provider link is meaningful to handle provider's work id naming convention
        const providerWorkId = workId.startsWith('RJ00') ? `RJ${workId.substring(4)}` : workId;
        providerLink.pathname = `/work/${providerWorkId}`;

        const languageEditions = (workinfo.other_language_editions_in_db?.map(e => e?.source_id) ?? [])
            .filter(x => x)
            // sort it by the way
            .map(e => e.length == 8 ? `RJ00${e.substring(2)}` : e).sort((e1, e2) => +e1.substring(2) - +e2.substring(2));
        metadata = {
            id: workId,
            providerLink: providerLink.toString(),
            providerProviderLink: workinfo.source_url!,
            actors: (workinfo.vas?.map(v => v?.name) ?? []).filter(x => x),
            providerTags: (workinfo.tags?.map(t => t?.i18n?.['ja-jp']?.name) ?? []).filter(x => x),
            languageEditions,
            title: workinfo.title,
            addTime: currentTime,
            lastAccessTime: currentTime,
            comments: [],
            managementComments: [],
            tags: [],
            score: 1,
            tracks: [],
        };
        if (metadata.languageEditions.some(eid => +eid.substring(2) < +workId.substring(2))) {
            logError('language editions have smaller id, this indicate a main-edition reversion');
        }
        await fs.writeFile(metadataPath, JSON.stringify(metadata, undefined, 2));
    }
    return metadata;
}
// write normalize metadata, only main work has main metadata
async function writeMetadata(metadata: WorkMetadata) {
    // keep properties ordered
    const newmetadata: WorkMetadata = {
        id: metadata.id,
        providerLink: metadata.providerLink,
        // why do I need this !?, you are duplicating same object??
        providerProviderLink: metadata.providerProviderLink!,
        actors: metadata.actors,
        providerTags: metadata.providerTags,
        languageEditions: metadata.languageEditions,
        title: metadata.title,
        addTime: metadata.addTime,
        lastAccessTime: metadata.lastAccessTime,
        tags: metadata.tags,
        score: metadata.score,
        retired: metadata.retired,
        comments: metadata.comments,
        managementComments: metadata.managementComments,
        audioWorkId: metadata.audioWorkId,
        audioFormat: metadata.audioFormat,
        subtitleWorkId: metadata.subtitleWorkId,
        subtitleFormat: metadata.subtitleFormat,
        tracks: metadata.tracks.sort((t1, t2) => t1.index! - t2.index!).map<TrackMetadata>(t => ({
            index: t.index,
            name: t.name,
            duration: t.duration,
            comments: t.comments,
            providerPath: t.providerPath,
            subtitleProviderPath: t.subtitleProviderPath,
            workInProgress: t.workInProgress,
        })),
    };
    await fs.writeFile(makepath(metadata.id, 'metadata.json'), JSON.stringify(newmetadata, undefined, 2));
}

interface FlatFileInfo {
    type: string,
    // segments separated with /, has leading /
    // now that the type is called fileinfo and variable names normally called file,
    // add a provider to the property name to avoid conflict with local file's related variables
    providerPath: string,
    size: number,
    duration: number,
    mediaDownloadUrl: string,
}
function flattenFileInfo(root: FileInfoNode): FlatFileInfo[] {
    const results: FlatFileInfo[] = [];
    // dfs
    function collect(folder: FileInfoNode, basepath: string) {
        const subfolders = folder.children?.filter(f => f.type == 'folder') ?? [];
        const beforesort = [...subfolders];
        subfolders.sort((f1, f2) => f1.title.localeCompare(f2.title));
        if (beforesort.some((b, i) => b.title != subfolders[i].title)) {
            // ATTENTION temporary use log error to make them easy to see
            // logError(`sort difference ${beforesort.map(f => f.title).join(',')} vs ${subfolders.map(f => f.title).join(',')}`);
        }
        for (const subfolder of subfolders) {
            collect(subfolder, basepath + '/' + subfolder.title);
        }
        const items = folder.children?.filter(f => f.type != 'folder') ?? [];
        const beforesort2 = [...items];
        items.sort((i1, i2) => i1.title.localeCompare(i2.title));
        if (beforesort2.some((b, i) => b.title != items[i].title)) {
            // ATTENTION temporary use log error to make them easy to see
            // logError(`sort difference ${beforesort2.map(f => f.title).join(',')} vs ${items.map(f => f.title).join(',')}`);
        }
        for (const item of items) {
            results.push({
                type: item.type,
                providerPath: basepath + '/' + item.title,
                size: item.size!,
                duration: item.duration!,
                mediaDownloadUrl: item.mediaDownloadUrl!,
            });
        }
    }
    // start with virtual root directory
    collect(root, '');
    return results;
}

// command handlers context
interface CommandContext {
    id: string,
    meta: WorkMetadata,
    // raw info
    info: WorkInfo,
    // work id to file info list, include both edition work id and main work id
    files: Record<string, FlatFileInfo[]>,
}

function handleDisplayMetadata(ctx: CommandContext) {
    logInfo('metadata:');
    console.log(`  title: ${ctx.meta.title}`);
    console.log(`  actors: ${ctx.meta.actors.join(', ')}`);
    console.log(`  times: ${ctx.meta.addTime}, ${ctx.meta.lastAccessTime}`);
    console.log(`  tags: ${ctx.meta.tags.join(', ')}`);
    console.log(`  score: ${ctx.meta.score}`);
    console.log(`  comment: ${ctx.meta.comments?.join(';') ?? '(none)'}`);
    console.log(`  management comment: ${ctx.meta.managementComments?.join(';') ?? '(none)'}`);
    console.log(`  editions: ${ctx.meta.languageEditions.length ? ctx.meta.languageEditions.join(', ') : '(none)'}`);
    console.log(`  audio work id: ${ctx.meta.audioWorkId ?? '(none)'}`);
    console.log(`  audio format: ${ctx.meta.audioFormat ?? '(none)'}`);
    console.log(`  subtitle work id: ${ctx.meta.subtitleWorkId ?? '(none)'}`);
    console.log(`  subtitle format: ${ctx.meta.subtitleFormat ?? '(none)'}`);
    console.log('  tracks:');
    for (const track of ctx.meta.tracks) {
        console.log(`    ${track.index}: ${track.name ?? '(empty)'} ${styleText('gray', 
            `(${track.providerPath}${track.subtitleProviderPath ? ` sub ${track.subtitleProviderPath}` : ''})`)}`);
    }
    console.log('  raw tracks:');
    const getDisplayPath = (value: string) => value
        .replaceAll('mp3', styleText('yellow', 'mp3'))
        .replaceAll('vtt', styleText('yellow', 'vtt'))
        .replaceAll('srt', styleText('yellow', 'srt'))
        .replaceAll('pdf', styleText('yellow', 'pdf'))
        .replaceAll('lrc', styleText('yellow', 'lrc'));
    for (const [file, index] of ctx.files[ctx.id].map((v, i) => [v, i] as const)) {
        console.log(`    ${styleText('cyanBright', (index + 1).toString())}: ${getDisplayPath(file.providerPath)
            } ${styleText('gray', `[${getDisplayFileSize(file.size)} ${getDisplayDuration(file.duration)}]`)}`);
    }
    for (const editionId of ctx.meta.languageEditions) {
        for (const [file, index] of ctx.files[editionId].map((v, i) => [v, i] as const)) {
            console.log(`    ${styleText('cyanBright', `${editionId}/${index + 1}`)}: ${getDisplayPath(file.providerPath)
                } ${styleText('gray', `[${getDisplayFileSize(file.size)} ${getDisplayDuration(file.duration)}]`)}`);
        }
    }
}

// parameters: after "move" not include "move"
async function handleMoveTrack(ctx: CommandContext, track: TrackMetadata, parameters: string[]) {
    if (!parameters[0]) {
        return logError('USAGE: autotrack.ts WORKID move INDEX NEWINDEX');
    }
    const newIndex = +parameters[0];
    if (!newIndex || newIndex <= 0) {
        return logError('invliad new index');
    } else if (ctx.meta.tracks.some(t => t.index != track.index && t.index == newIndex)) {
        return logError('new index already exist');
    }
    // UPDATE after file structure upgrade this move become easy again, but I still never use this command so still lazy to fix?
    return logError(`now that metadata.audioformat and metadata.subtitleformat not work as before, ` + 
        `the original implementation is not correct, while I never used this command so lazy to fix?`);
    logInfo(`ATTENTION will try to move actual file, but no transaction and rollback for that, which means`);
    logInfo(`if audio file move ok but subtitle file move not ok, audio file will not rollback while metadata will not update`);
    if (ctx.meta.audioFormat) {
        const oldAudioPath = makepath(ctx.id, `track${track.index}.${ctx.meta.audioFormat}`);
        const newAudioPath = makepath(ctx.id, `track${newIndex}.${ctx.meta.audioFormat}`);
        if (npfs.existsSync(oldAudioPath)) {
            if (npfs.existsSync(newAudioPath)) {
                // not regard as error
                logInfo(`skip move audio file because target path exists`);
            } else {
                logInfo(`move ${oldAudioPath} to ${newAudioPath}`);
                await fs.rename(oldAudioPath, newAudioPath);
            }
        }
        if (ctx.meta.subtitleFormat) {
            const oldSubtitlePath = `${oldAudioPath}.${ctx.meta.subtitleFormat}`;
            const newSubtitlePath = `${newAudioPath}.${ctx.meta.subtitleFormat}`;
            if (npfs.existsSync(newSubtitlePath)) {
                // not regard as error
                logInfo(`skip move subtitle file because target path exists`);
            } else {
                logInfo(`move ${oldSubtitlePath} to ${newSubtitlePath}`);
                await fs.rename(oldSubtitlePath, newSubtitlePath);
            }
        }
    }
    logInfo(`${ctx.id}: move track from ${track.index} to ${newIndex}`);
    track.index = newIndex;
}

interface RawIndexReference {
    meid: string, // main or edition work id
    rawIndex: number, // raw index or begin raw index
    endRawIndex?: number,
    step: number, // already handled default 1
}
// - add [EDITIONID/]RAWINDEX [sub [EDITIONID/]RAWINDEX]
// - add [EDITIONID/]RAWINDEX:ENDRAWINDEX[:STEP] [sub [EDITIONID/]RAWINDEX:ENDRAWINDEX[:STEP]]
// first word and 3rd word is same syntax, so can parse and validate syntax with same parser
// return undefined for already printed error
// // you need |void to make return logerror work, what's the meaning?
function parseAndValidateRawIndexReference(ctx: CommandContext, parameter: string): RawIndexReference | void {

    let meid: string;
    let remaining = parameter;
    if (!parameter.includes('/')) {
        meid = ctx.id;
    } else {
        meid = parameter.split('/')[0];
        remaining = parameter.substring(meid.length + 1);
    }
    if (meid != ctx.id && !ctx.meta.languageEditions.includes(meid)) {
        return logError(`unrecognized edition work id ${meid}`);
    }
    const splitted = remaining.split(':');
    if (splitted.length > 3) {
        return logError(`invalid syntax in ${parameter}, see help`);
    }
    const rawIndex = +splitted[0];
    if (isNaN(rawIndex)) {
        return logError(`invalid raw index in ${parameter}: not a number? ${splitted[0]}`);
    } else if (rawIndex <= 0) {
        return logError(`invalid raw index in ${parameter}: negative`);
    } else if (Math.floor(rawIndex) != rawIndex) {
        return logError(`invalid raw index in ${parameter}: not an integer? ${rawIndex}`);
    } else if (rawIndex > ctx.files[meid].length) {
        return logError(`invalid raw index in ${parameter}: out of range, max ${ctx.files[meid].length}`);
    }
    let endRawIndex: number;
    if (splitted.length > 1) {
        endRawIndex = +splitted[1];
        if (isNaN(endRawIndex)) {
            return logError(`invalid end raw index in ${parameter}: not a number? ${splitted[1]}`);
        } else if (endRawIndex <= 0) {
            return logError(`invalid end raw index in ${parameter}: negative`);
        } else if (Math.floor(endRawIndex) != endRawIndex) {
            return logError(`invalid end raw index in ${parameter}: not an integer? ${endRawIndex}`);
        // ATTENTION +1 because end raw index is exclusive so can point one element after end
        } else if (endRawIndex > ctx.files[meid].length + 1) {
            return logError(`invalid end raw index in ${parameter}: out of range, max ${ctx.files[meid].length + 1}`);
        } else if (endRawIndex <= rawIndex) {
            return logError(`invalid end raw index in ${parameter}: before begin index`);
        }
    }
    let step = 1;
    if (splitted.length > 2) {
        step = parseInt(splitted[2]);
        if (isNaN(step) || step <= 0) {
            return logError(`invalid step in ${parameter}`);
        }
    }
    return { meid, rawIndex, endRawIndex, step };
}

// add one track, optionally subtitle, auto assign next track index,
// caller to validate audio work id and raw index, subtitle work id and raw index
function addOneTrack(ctx: CommandContext, audioWorkId: string, audioRawIndex: number, subtitleWorkId?: string, subtitleRawIndex?: number) {
    
    if (ctx.meta.tracks.length && (ctx.meta.audioWorkId ?? ctx.id) != audioWorkId) {
        return logError(`audio work id ${audioWorkId} is not same as existing value ${(ctx.meta.audioWorkId ?? ctx.id)}`);
    }
    const audioFile = ctx.files[audioWorkId][audioRawIndex - 1];
    if (audioFile.type != 'audio') {
        return logError('audio file type should be audio');
    }

    const audioFormat = path.extname(audioFile.providerPath).substring(1);
    if (!['mp3', 'wav', 'flac'].includes(audioFormat)) {
        return logError('unrecognized audio format, currently support mp3, wav, flac');
    } else if (ctx.meta.tracks.length) {
        const existingAudioFile = ctx.files[audioWorkId][ctx.meta.tracks[0].providerPath - 1];
        const existingAudioFormat = path.extname(existingAudioFile.providerPath).substring(1);
        if (existingAudioFormat != audioFormat) {
            return logError(`audio format ${audioFormat} not same as existing value ${existingAudioFormat}`);
        }
    }

    const trackIndex = ctx.meta.tracks.reduce((acc, t) => Math.max(acc, t.index), 0) + 1;
    // node:path don't have file-name-without-extension
    const audioFileProviderPathBaseName = path.basename(audioFile.providerPath);
    const trackName = audioFileProviderPathBaseName.substring(0, audioFileProviderPathBaseName.length - audioFormat.length - 1);

    let subtitleFileProviderPath: string;
    if (subtitleWorkId) {
        if (ctx.meta.tracks.length && (ctx.meta.subtitleWorkId ?? ctx.id) != subtitleWorkId) {
            return logError(`subtitle work id ${subtitleWorkId} is not same as existing value ${(ctx.meta.subtitleWorkId ?? ctx.id)}`);
        }
        const subtitleFile = ctx.files[subtitleWorkId][subtitleRawIndex - 1];
        // pdf subtitle's .type in file info is 'other'
        if (subtitleFile.type != 'text' && !subtitleFile.providerPath.endsWith('.pdf')) {
            return logError('subtitle file type should be text');
        }
        
        subtitleFileProviderPath = subtitleFile.providerPath;
        const subtitleFormat = path.extname(subtitleFileProviderPath).substring(1);
        // not include other subtitle formats, they are not added
        if (!['vtt', 'lrc', 'srt', 'pdf', 'txt'].includes(subtitleFormat)) {
            return logError('unrecognized subtitle format, currently support vtt, lrc, srt, pdf, txt');
        }
        if (ctx.meta.tracks.length) {
            const existingFileIndex = ctx.meta.tracks
                .find(t => t.subtitleProviderPath && t.subtitleProviderPath != -1)?.subtitleProviderPath;
            if (existingFileIndex) {
                const existingSubtitleFormat = path.extname(ctx.files[subtitleWorkId][existingFileIndex - 1].providerPath).substring(1);
                if (existingSubtitleFormat != subtitleFormat) {
                    return logError(`subtitle format ${subtitleFormat} not same as existing value ${existingSubtitleFormat}`);
                }
            }
        }
        // assign these after validation
        if (subtitleWorkId != ctx.id) { ctx.meta.subtitleWorkId = subtitleWorkId; }
    }
    // assign these after validation
    if (audioWorkId != ctx.id) { ctx.meta.audioWorkId = audioWorkId; }

    logInfo(`add track ${trackIndex} audio ${audioFile.providerPath}${subtitleWorkId ? ` subtitle ${subtitleFileProviderPath}` : ''}`);
    ctx.meta.tracks.push({
        index: trackIndex,
        name: trackName,
        duration: audioFile.duration,
        // both input index and saved index start from 1
        providerPath: audioRawIndex,
        subtitleProviderPath: subtitleRawIndex,
        workInProgress: true,
    });
}

// parameters: after "add" not include "add"
function handleAddTrack(ctx: CommandContext, parameters: string[]) {

    function printThisCommandUsage() {
        logError('USAGE: autotrack.ts WORKID add [EDITIONID/]RAWINDEX [sub [EDITIONID/]RAWINDEX]');
        logError('USAGE: autotrack.ts WORKID add [EDITIONID/]RAWINDEX:ENDRAWINDEX[:STEP] [sub [EDITIONID/]RAWINDEX:ENDRAWINDEX[:STEP]]');
    }
    // 1 word means without subtle, 3 word means with subtitle
    const includeSubtitle = parameters.length == 3;
    if (parameters.length != 1 && parameters.length != 3) { return printThisCommandUsage(); }
    if (includeSubtitle && parameters[1] != 'sub' && parameters[1] != 'subtitle') { return printThisCommandUsage(); }

    const audioRawIndexReference = parseAndValidateRawIndexReference(ctx, parameters[0]);
    if (!audioRawIndexReference) { return; } // already printed error
    let subtitleRawIndexReference: RawIndexReference; // ATTENTION this may be none if not include subtitle
    if (includeSubtitle) {
        subtitleRawIndexReference = parseAndValidateRawIndexReference(ctx, parameters[2]) as RawIndexReference;
        if (!subtitleRawIndexReference) { return; } // already printed error
        if (audioRawIndexReference.endRawIndex && !subtitleRawIndexReference.endRawIndex
            || !audioRawIndexReference.endRawIndex && subtitleRawIndexReference.endRawIndex
        ) {
            return logError('audio raw index and subtitle raw index should use batch syntax at same time');
        }
        if (audioRawIndexReference.endRawIndex && subtitleRawIndexReference.endRawIndex) {
            const audioCount = Math.ceil((audioRawIndexReference.endRawIndex
                - audioRawIndexReference.rawIndex) / audioRawIndexReference.step);
            const subtitleCount = Math.ceil((subtitleRawIndexReference.endRawIndex
                - subtitleRawIndexReference.rawIndex) / subtitleRawIndexReference.step);
            if (audioCount != subtitleCount) {
                return logError(`audio count not same as subtitle count, ${audioCount} != ${subtitleCount}`);
            }
        }
    }

    // abstract a addonetrack function out and use plain logic to add each track is more clear
    const { meid: audioWorkId, rawIndex: audioBeginRawIndex } = audioRawIndexReference;
    if (!audioRawIndexReference.endRawIndex) {
        if (!subtitleRawIndexReference) {
            addOneTrack(ctx, audioWorkId, audioBeginRawIndex);
        } else {
            addOneTrack(ctx, audioWorkId, audioBeginRawIndex, subtitleRawIndexReference.meid, subtitleRawIndexReference.rawIndex);
        }
    } else {
        if (!subtitleRawIndexReference) {
            let currentTrackRawIndex = audioBeginRawIndex;
            while (currentTrackRawIndex < audioRawIndexReference.endRawIndex) {
                addOneTrack(ctx, audioWorkId, currentTrackRawIndex);
                currentTrackRawIndex += audioRawIndexReference.step;
            }
        } else {
            let currentTrackRawIndex = audioBeginRawIndex;
            let currentSubtitleRawIndex = subtitleRawIndexReference.rawIndex;
            // already validated they have same count, no need to have multiple end conditions
            while (currentTrackRawIndex < audioRawIndexReference.endRawIndex) {
                addOneTrack(ctx, audioWorkId, currentTrackRawIndex, subtitleRawIndexReference.meid, currentSubtitleRawIndex);
                currentTrackRawIndex += audioRawIndexReference.step;
                currentSubtitleRawIndex += subtitleRawIndexReference.step;
            }
        }
    }
}

// TODO merge 2 download functions to support incremental download in extra files
// parameters: after "extra" not include "extra"
async function handleDownloadExtraFile(ctx: CommandContext, parameters: string[]) {
    if (!parameters[0]) {
        return logError('USAGE: autotrack.ts WORKID extra [EDITIONID/]RAWINDEX');
    }
    let meid: string; // main work id or edition work id
    let rawIndex: number;
    if (parameters[0].includes('/')) {
        const splitted = parameters[0].split('/');
        if (splitted.length != 2) {
            return logError('USAGE: autotrack.ts WORKID extra [EDITIONID/]RAWINDEX');
        }
        [meid, rawIndex] = [splitted[0], +splitted[1]];
    } else {
        [meid, rawIndex] = [ctx.id, +parameters[0]];
    }

    if (meid != ctx.id && !ctx.meta.languageEditions.includes(meid)) {
        return logError(`unrecognized language edition work id`);
    } else if (isNaN(rawIndex)) {
        return logError('invalid raw index');
    } else if (rawIndex <= 0 || rawIndex > ctx.files[meid].length) {
        return logError('raw index out of range');
    }
    const fileinfo = ctx.files[meid][rawIndex - 1];
    const localPath = makepath(ctx.id, `${meid}-file${rawIndex}${path.extname(fileinfo.providerPath)}`);
    if (npfs.existsSync(localPath)) {
        return logInfo(`${ctx.id}: extra file path ${localPath} already exists, skip`);
    }
    logInfo(`download extra file ${meid} ${fileinfo.providerPath} to ${localPath}`);
    if (LOGURL) { logInfo(`download url ${fileinfo.mediaDownloadUrl}`); }
    const response = await fetch(fileinfo.mediaDownloadUrl);
    // this can happen at abitrary file UPDATE this frequently happen to all image and video file in old works
    if (!response.ok) { return logError(`download response not ok ${response.status}`); }
    if (fileinfo.size > 1048576) {
        // no need to precisely and gracefully handle network and fs error in this small script
        await finished(stream.Readable.fromWeb(response.body)
            .pipe(createProgressPipe(fileinfo.size)).pipe(npfs.createWriteStream(localPath)));
    } else {
        // don't display progress and elapsed time for small files
        await finished(stream.Readable.fromWeb(response.body).pipe(npfs.createWriteStream(localPath)));
    }
    logInfo(`download extra file complete`);
}

async function handleDownloadTracks(ctx: CommandContext, dry: boolean) {

    logInfo(`track count ${ctx.meta.tracks.length}`);
    const tasks: { index: number, kind: 'audio' | 'subtitle', info: FlatFileInfo, localPath: string }[] = [];
    for (const track of ctx.meta.tracks) {
        const audioFile = ctx.files[(ctx.meta.audioWorkId ?? ctx.id)][track.providerPath - 1];
        if (!audioFile) { return logError(`track ${track.index} audio provider path out of range?`); }
        const audioExtension = path.extname(audioFile.providerPath);
        const localPath = makepath(ctx.id, `${ctx.meta.audioWorkId ?? ctx.id}-file${track.providerPath}${audioExtension}`);
        tasks.push({ index: track.index, kind: 'audio', info: audioFile, localPath });

        if (track.subtitleProviderPath && track.subtitleProviderPath != -1) {
            const subtitleFile = ctx.files[(ctx.meta.subtitleWorkId ?? ctx.id)][track.subtitleProviderPath - 1];
            if (!subtitleFile) { return logError(`track ${track.index} subtitle provider path not found?`); }
            const subtitleExtension = path.extname(subtitleFile.providerPath);
            const localPath = makepath(ctx.id, `${ctx.meta.subtitleWorkId ?? ctx.id}-file${track.subtitleProviderPath}${subtitleExtension}`);
            tasks.push({ index: track.index, kind: 'subtitle', info: subtitleFile, localPath });
        }
    }
    
    let totalSize = 0;
    let networkTaskCount = 0;
    let overallStartTime = Temporal.Now.plainDateTimeISO();
    for (const task of tasks) {
        let startPosition = 0;
        if (npfs.existsSync(task.localPath)) {
            const stat = await fs.stat(task.localPath);
            if (stat.size != task.info.size) {
                logInfo(`track ${task.index} ${task.kind} size not fulfilled, start from ${stat.size}/${task.info.size}`);
                startPosition = stat.size;
            } else {
                logInfo(`track ${task.index} ${task.kind} local path ${task.localPath} exist and size match, skip`);
                continue;
            }
        }
        if (dry) {
            logInfo(`will download track ${task.index} ${task.kind} to ${task.localPath}`);
        } else {
            logInfo(`download track ${task.index} ${task.kind} to ${task.localPath}`);
            if (LOGURL) { logInfo(`download url ${task.info.mediaDownloadUrl}`); }
            const headers: [string, string][] = [];
            if (startPosition != 0) {
                headers.push(['range', `bytes=${startPosition}-`]);
            }
            const response = await fetch(task.info.mediaDownloadUrl, { headers });
            if (!response.ok) {
                return logError(`download file response not ok ${response.status}`);
            }
            // console.log(Array.from(response.headers.entries())); // see accept-ranges: bytes
            const expectedSize = task.info.size - startPosition;
            const sourceStream = stream.Readable.fromWeb(response.body);
            const targetStream = npfs.createWriteStream(task.localPath, { flags: 'a' });
            if (expectedSize < 1048576) {
                await finished(sourceStream.pipe(targetStream));
            } else {
                await finished(sourceStream.pipe(createProgressPipe(expectedSize)).pipe(targetStream));
            }
            logInfo(`download track ${task.index} ${task.kind} complete`);
            await writeMetadata(ctx.meta);
        }
        totalSize += task.info.size;
        networkTaskCount += 1;
    }
    if (dry) {
        if (networkTaskCount == 0 || totalSize == 0) {
            logInfo('up to date');
        } else {
            logInfo(`will download ${networkTaskCount} files ${getDisplayFileSize(totalSize)}`);
        }
    } else {
        const totalElapsedTime = Temporal.Now.plainDateTimeISO().since(overallStartTime);
        logInfo(`download ${networkTaskCount} files ${getDisplayFileSize(totalSize)} elapsed ${getDisplayTemporalDuration(totalElapsedTime)}`);
    }
}

// modernize mp3 and wav format to very space efficient opus
// similar to subtitle command to simiplify vtt, etc. to vss format, create track*.ogg files from file*.mp3, etc. files
// not similar to subtitle command that no conversion can be done in this script, this command currently only updates marks
async function handleModernizeAudio(ctx: CommandContext, parameters: string[]) {

    if (ctx.meta.audioFormat) {
        return logInfo(`up to date, audio format: ${ctx.meta.audioFormat}`);
    }
    // if all tracks has existing file, mark metadata.audioFormat
    let allTrackComplete = true;
    const expectAudioFormat = 'ogg';
    for (const track of ctx.meta.tracks) {
        const modernAudioPath = makepath(ctx.id, `track${track.index}.${expectAudioFormat}`);
        if (npfs.existsSync(modernAudioPath)) {
            if (!track.subtitleProviderPath && track.workInProgress) {
                delete track.workInProgress;
            }
        } else {
            allTrackComplete = false;
        }
    }
    if (allTrackComplete) {
        logInfo(`audio modernization complete, result audio format ${expectAudioFormat}`);
        ctx.meta.audioFormat = expectAudioFormat;
    }
}

// https://w3c.github.io/webvtt/#webvtt-cue
// https://html.spec.whatwg.org/multipage/media.html#text-track-cue
interface Cue { start: number, end: number, text: string }
// convert vtt/srt/lrc to vss
function convertSubtitleFormat(trackIndex: number, subtitleFormat: string, rawtext: string): Cue[] {
    const results: Cue[] = [];
    if (subtitleFormat == 'vtt' || subtitleFormat == 'srt') {
        // vtt: split line, recognize --> and the 2 timestamps around it, and take the next line as text
        // srt: for this implementation it can handle both vtt and srt, except srt is using a confusing comma for miliseconds
        const lines = rawtext.split('\n');
        for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
            if (lines[rowIndex].includes('-->')) {
                const splitted = lines[rowIndex].split('-->');
                const leftMatch = /(?:\d\d:)?\d\d:\d\d(?:\.|,)\d{3}/.exec(splitted[0].trim());
                if (!leftMatch) {
                    logError(`track ${trackIndex}: line ${rowIndex}: has arrow but does not contain timetamp? ${lines[rowIndex]}`);
                    continue;
                }
                const rightMatch = /(?:\d\d:)?\d\d:\d\d(?:\.|,)\d{3}/.exec(splitted[1]);
                if (!rightMatch) {
                    logError(`track ${trackIndex}: line ${rowIndex}: has arrow but does not contain timetamp? ${lines[rowIndex]}`);
                    continue;
                }
                if (rowIndex + 1 >= lines.length) {
                    logError(`track ${trackIndex}: line ${rowIndex}: has arrow but not have next line?`);
                    continue;
                }
                let start = leftMatch[0].length == 9
                    ? +leftMatch[0].substring(0, 2) * 60 + +leftMatch[0].substring(3, 5) + +leftMatch[0].substring(6, 9) / 1000
                    : +leftMatch[0].substring(0, 2) * 3600 + +leftMatch[0].substring(3, 5) * 60 + +leftMatch[0].substring(6, 8) + +leftMatch[0].substring(9, 12) / 1000;
                let end = rightMatch[0].length == 9
                    ? +rightMatch[0].substring(0, 2) * 60 + +rightMatch[0].substring(3, 5) + +rightMatch[0].substring(6, 9) / 1000
                    : +rightMatch[0].substring(0, 2) * 3600 + +rightMatch[0].substring(3, 5) * 60 + +rightMatch[0].substring(6, 8) + +rightMatch[0].substring(9, 12) / 1000;
                
                // include text until one empty line
                const texts: string[] = [];
                let currentTextLine = rowIndex + 1;
                while (lines[currentTextLine] && lines[currentTextLine].trim()) {
                    if (currentTextLine > rowIndex + 3) {
                        logError(`too many text lines? ${rowIndex} ${lines[rowIndex]}, ${start}, ${end}, ${texts.join('\\n')}`);
                        return;
                    }
                    texts.push(lines[currentTextLine].trim());
                    currentTextLine += 1;
                }
                rowIndex = currentTextLine - 1;
                texts.forEach(t => results.push({ start, end, text: t }));
            }
        }
    } else if (subtitleFormat == 'lrc') {
        // split line, recognize [\d\d:\d\d.\d\d] and later part if payload, every payload begins at this line's time and ends at next line's time
        const lines = rawtext.split('\n');
        let incompleteRecord: Cue = null;
        for (const line of lines) {
            const match = /^\[(\d\d):(\d\d\.\d\d)\]/.exec(line.trim());
            if (match) {
                const time = +match[1] * 60 + +match[2];
                if (incompleteRecord) { incompleteRecord.end = time; }
                const text = line.trim().substring(10).trim();
                if (text) {
                    incompleteRecord = { start: time, end: time, text };
                    results.push(incompleteRecord);
                } else {
                    // don't forget to clear, or else [time1]text1\n[time2]\n[time3], time3 will be assigned to text1
                    incompleteRecord = null;
                }
            }
        }
    } else if (subtitleFormat == 'pdf') {
        logError('for now use python to extract pdf, not here');
    } else if (subtitleFormat == 'txt') {
        logError(`caller to skip txt file`);
    } else {
        logError(`unknown subtitle format ${subtitleFormat}`);
    }
    return results;
}

// simplify subtitle format to make it easier to parse for client side, and less network traffic and storage usage
// similar to audio command convert mp3, etc. to opus codec, may create track*.vss files from file*.vtt, etc. files
// not similar to audio command that normal conversion can be done in this script, while pdf and asr cannot, have different workflows
//
// subtitle workflow (user story?)
// - download vtt/srt/lrc from provider,
//   convert them to vss with this command, mark subtitleformat to vss
// - download pdf from provider,
//   convert them to vss with python manage script,
//   run this command to find pdf files and txt files complete, mark subtitleformat to txt
// - download txt from provider,
//   run this command to copy txt files from file*.txt to track*.txt, mark subtitleformat to txt
// - for all the case above, if some of the track missing subtitle and need asr,
//   after generation complete, manually mark the track with subtitle provider path = -1
// - no subtitlte provided by provider,
//   run this command to mark tracks to be asr, asr,
//   run this command to find vss files complete, mark subtitleformat to vss
async function handleSimplifySubtitle(ctx: CommandContext, parameters: string[]) {

    if (ctx.meta.subtitleFormat) {
        return logInfo(`up to date, subtitle format: ${ctx.meta.subtitleFormat}`);
    }

    let hasDisplayedMarkASRMessage = false;
    let existingProviderSubtitleFormat: string;
    for (const track of ctx.meta.tracks) {
        if (track.subtitleProviderPath == -1) {
            if (!npfs.existsSync(makepath(ctx.id, `track${track.index}.vss`))
                && !npfs.existsSync(makepath(ctx.id, `track${track.index}.txt`))
            ) {
                logInfo(`track ${track.index}: is marked as asr but no matching txt/vss file found`);
            }
        } else if (!track.subtitleProviderPath) {
            if (parameters[0] == 'mark-asr') {
                logInfo(`track ${track.index}: mark asr`);
                track.subtitleProviderPath = -1;
            } else if (!hasDisplayedMarkASRMessage) {
                hasDisplayedMarkASRMessage = true;
                logInfo(`track ${track.index}: no subtitle provider path, use mark-asr (this script does not actually run asr)`);
            }
        } else {
            // for track with subtitle provider path, always check file exist and size match or else skip the track
            const subtitleFile = ctx.files[ctx.meta.subtitleWorkId ?? ctx.id][track.subtitleProviderPath - 1];
            if (!subtitleFile) {
                return logError(`track ${track.index}: subtitle provider path out of range?`);
            }
            const providerSubtitleFormat = path.extname(subtitleFile.providerPath).substring(1);
            if (!existingProviderSubtitleFormat) {
                existingProviderSubtitleFormat = providerSubtitleFormat;
            } else if (existingProviderSubtitleFormat != providerSubtitleFormat) {
                return logError(`track ${track.index}: subtitle format ${providerSubtitleFormat} not same as existing value ${existingProviderSubtitleFormat}?`);
            }
            const providerSubtitleLocalPath = makepath(ctx.id,
                `${ctx.meta.subtitleWorkId ?? ctx.id}-file${track.subtitleProviderPath}.${providerSubtitleFormat}`);
            if (!npfs.existsSync(providerSubtitleLocalPath)) {
                logInfo(`track ${track.index}: provider subtitle file not exist, skip`);
                continue;
            }
            const stat = await fs.stat(providerSubtitleLocalPath);
            if (stat.size != subtitleFile.size) {
                logInfo(`track ${track.index}: provider subtitle file size mismatch, skip`);
                continue;
            }
            if (providerSubtitleFormat == 'pdf') {
                if (!npfs.existsSync(makepath(ctx.id, `track${track.index}.txt`))) {
                    logInfo(`track ${track.index}: subtitle provider path is pdf but no matching txt file found`);
                }
            } else if (providerSubtitleFormat != 'txt') {
                // always try to convert to vss here
                const simpleSubtitleFilePath = makepath(ctx.id, `track${track.index}.vss`);
                if (!npfs.existsSync(simpleSubtitleFilePath)) {
                    const originalContent = await fs.readFile(providerSubtitleLocalPath, 'utf-8');
                    const cues = convertSubtitleFormat(track.index, providerSubtitleFormat, originalContent);
                    const simplifiedContent = cues.map(r => `${r.start},${r.end},${r.text}\n`).join('');
                    logInfo(`track ${track.index}: write ${simpleSubtitleFilePath} ${cues.length} records`);
                    await fs.writeFile(simpleSubtitleFilePath, simplifiedContent);
                }
            }
        }
    }

    // if no track has subtitleproviderpath, do nothing
    if (ctx.meta.tracks.some(t => t.subtitleProviderPath)) {
        // if all tracks with subtitleproviderpath has existing matching file, mark metadat.subtitleformat
        let allTrackComplete = true;
        const expectSimpleSubtitleFormat = ['vtt', 'srt', 'lrc', 'vss'].includes(existingProviderSubtitleFormat) ? 'vss' : 'txt';
        for (const track of ctx.meta.tracks) {
            const filepath = makepath(ctx.id, `track${track.index}.${ctx.meta.audioFormat}.${expectSimpleSubtitleFormat}`);
            if (track.subtitleProviderPath) {
                if (npfs.existsSync(filepath)) {
                    if (track.workInProgress) {
                        delete track.workInProgress;
                    }
                } else {
                    allTrackComplete = false;
                }
            }
        }
        if (allTrackComplete) {
            logInfo(`subtitle postprocess complete, result subtitle format ${expectSimpleSubtitleFormat}`);
            ctx.meta.subtitleFormat = expectSimpleSubtitleFormat;
        }
    }
}

// parameters: after "work" not include "work"
async function handleWorkCommand(parameters: string[]) {

    const workId = await getWorkId(parameters[0]); if (!workId) { return; }
    const [workinfo, fileinfo] = await getRawMetadata(workId, workId); if (!workinfo) { return; }
    // get or create main metadata
    const metadata = await getMetadata(workId, workinfo);
    const files: [string, FileInfoNode][] = [[workId, fileinfo]];
    // ATTENTION because of similar reason, don't paralle this
    for (const editionId of metadata.languageEditions) {
        // edition raw metadata is not used
        const [workinfo, fileinfo] = await getRawMetadata(editionId, workId); if (!workinfo) { return; }
        files.push([editionId, fileinfo]);
    }
    const flatfiles = Object.fromEntries(files.map(([i, r]) => [i, flattenFileInfo(r)]));
    const ctx: CommandContext = { id: workId, meta: metadata, info: workinfo, files: flatfiles };
    
    if (parameters.length == 1 || parameters[1] == 'meta') {
        handleDisplayMetadata(ctx);
    } else if (parameters[1] == 'title') {
        if (!parameters[2]) {
            logError('USAGE: autotrack.ts WORKID title NEWTITLE');
        } else {
            logInfo(`${workId}: rename ${ctx.meta.title} to ${parameters[2]}`);
            ctx.meta.title = parameters[2];
        }
    } else if (parameters[1] == 'tag') {
        if (!parameters[2]) {
            logError('USAGE: autotrack.ts WORKID tag TAG');
        } else if (ctx.meta.tags.includes(parameters[2])) {
            logInfo(`${workId}: del tag ${parameters[2]}`);
            ctx.meta.tags.splice(ctx.meta.tags.indexOf(parameters[2]), 1);
        } else {
            logInfo(`${workId}: add tag ${parameters[2]}`);
            ctx.meta.tags.push(parameters[2]);
        }
    } else if (parameters[1] == 'comment') {
        if (!parameters[2]) {
            logError('USAGE: autotrack.ts WORKID comment COMMENT');
        } else {
            logInfo(`${workId}: add comment "${parameters[2]}"`);
            ctx.meta.comments.push(parameters[2]);
        }
    } else if (parameters[1] == 'score') {
        if (!parameters[2]) {
            logError('USAGE: autotrack.ts WORKID score +VALUE/-VALUE/=VALUE');
        } else {
            const match = /^(\+|-|=)(\d+)$/.exec(parameters[2]);
            if (!match) {
                logError('USAGE: autotrack.ts WORKID score +VALUE/-VALUE/=VALUE');
            } else {
                const [operator, value] = [match[1], +match[2]];
                ctx.meta.score = operator == '=' ? value : operator == '+' ? ctx.meta.score + value : ctx.meta.score - value;
                logInfo(`${workId}: score ${operator} ${value}${operator != '=' ? ` = ${ctx.meta.score}` : ''}`);
            }
        }
    } else if (parameters[1] == 'access') {
        const currentTime = getCurrentTime();
        logInfo(`${workId}: access ${currentTime}`);
        ctx.meta.lastAccessTime = currentTime;
    } else if (parameters[1] == 'track') {
        if (!parameters[2]) {
            logError('USAGE: autotrack.ts WORKID track INDEX SUBCOMMAND');
        } else {
            const trackIndex = +parameters[2];
            const track = metadata.tracks.find(t => t.index == trackIndex);
            if (isNaN(trackIndex)) {
                logError('USAGE: autotrack.ts WORKID track INDEX SUBCOMMAND');
            } else if (!track) {
                logError('track index out of range');
            } else if (parameters[3] == 'move') {
                await handleMoveTrack(ctx, track, parameters.slice(4));
            } else if (parameters[3] == 'name') {
                if (!parameters[4]) {
                    logError('USAGE: autotrack.ts WORKID track INDEX name NAME');
                } else {
                    logInfo(`${workId}: track ${trackIndex}: rename from ${track.name} to ${parameters[4]}`);
                    track.name = parameters[4];
                }
            } else if (parameters[3] == 'comment') {
                if (!parameters[4]) {
                    logError('USAGE: autotrack.ts WORKID track INDEX comment COMMENT');
                } else {
                    logInfo(`${workId}: track ${trackIndex}: add comment "${parameters[4]}"`);
                    track.comments.push(parameters[4]);
                }
            } else {
                logError('unknown command, see help');
            }
        }
    } else if (parameters[1] == 'add') {
        handleAddTrack(ctx, parameters.slice(2));
    } else if (parameters[1] == 'extra') {
        await handleDownloadExtraFile(ctx, parameters.slice(2));
    } else if (parameters[1] == 'dry') {
        await handleDownloadTracks(ctx, true);
    } else if (parameters[1] == 'commit') {
        await handleDownloadTracks(ctx, false);
    } else if (parameters[1] == 'audio') {
        await handleModernizeAudio(ctx, parameters.slice(2));
    } else if (parameters[1] == 'subtitle') {
        await handleSimplifySubtitle(ctx, parameters.slice(2));
    } else {
        logError('unknown command, see help');
    }

    await writeMetadata(metadata);
}

function minifycss(originalContent: string) {
    // as my simple css is very regular that only contain plain rules .*\s\{attribute*\} and plain attributes .*:\s.*;
    // so can use simple string manipulation operation to minify

    let b = '';
    let previousCommentEndPosition = -2;
    let commentStartPosition = originalContent.indexOf('/*');
    while (commentStartPosition >= 0) {
        const commentEndPosition = originalContent.indexOf('*/', commentStartPosition);
        b += originalContent.substring(previousCommentEndPosition + 2, commentStartPosition);
        previousCommentEndPosition = commentEndPosition;
        commentStartPosition = originalContent.indexOf('/*', commentEndPosition);
    }
    b += originalContent.substring(previousCommentEndPosition + 2);
    originalContent = b;

    b = '';
    let previousRightBracePosition = -1;
    let leftBracePosition = originalContent.indexOf('{');
    while (leftBracePosition >= 0) {
        const rightBracePosition = originalContent.indexOf('}', leftBracePosition);
        // selector
        b += originalContent.substring(previousRightBracePosition + 1, leftBracePosition).trim();
        b += '{';
        const ruleContent = originalContent.substring(leftBracePosition + 1, rightBracePosition).trim();
        // every unwanted whitespace characters are around colon and semicolon, so...
        const trimmed1 = ruleContent.split(':').map(p => p.trim()).join(':');
        const trimmed2 = trimmed1.split(';').map(p => p.trim()).join(';');
        b += trimmed2;
        b += '}\n';

        previousRightBracePosition = rightBracePosition;
        leftBracePosition = originalContent.indexOf('{', rightBracePosition);
    }
    return b.trim();
}
async function handleMakePage() {

    const directoryNames = await fs.readdir(config.dataDirectory);
    const workIds = directoryNames.filter(d => d.startsWith('RJ'));
    let maxTagCount = 0;
    let maxTrackCount = 0;
    let maxCommentCount = 0;
    await Promise.all(workIds.map(async workId => {
        const metadataPath = makepath(workId, 'metadata.json');
        if (!npfs.existsSync(metadataPath)) { return; }
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
                // tag count: provider tags + actors + my tags + 1 for score + optional 1 for "has subtitle" tag
        maxTagCount = Math.max(maxTagCount,
            metadata.providerTags.length + metadata.actors.length + metadata.tags.length + 1 + (metadata.subtitleFormat ? 1 : 0));
        maxTrackCount = Math.max(maxTrackCount, metadata.tracks.length);
        maxCommentCount = Math.max(maxCommentCount,
            (metadata.comments?.length ?? 0) + metadata.tracks.reduce((acc, t) => acc + (t.comments?.length ?? 0), 0));
    }));

    // amazingly you need meta charset to make jajp characters work in html source code
    let template = `<!DOCTYPE html>
<html>
<head>
  <title>ASMR Offline</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style></style>
</head>
<body>
  <header>
    <h2>ASMR Offline</h2>
    <div id="pager">
        <button id="page-prev">&lt;</button>
        <input type="number" id="page-number" value="1"></input>
        <span id="page-count"></span>
        <button id="page-next">&gt;</button>
    </div>
  </header>
  <div id="summary-container"></div>
  <div id="detail-container"></div>
  <div id="tracks-container"></div>
  <div id="player-container"></div>
  <script></script>
</body>
</html>`;

    // inline workid + title list in html file should be easier then separate index.json data
    const metadatas: WorkMetadata[] = [];
    await Promise.all((await fs.readdir(config.dataDirectory)).map(async directoryName => {
        if (directoryName.startsWith('RJ')) {
            const metadataPath = makepath(directoryName, 'metadata.json');
            if (npfs.existsSync(metadataPath)) {
                const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
                if (!metadata.retired && metadata.audioFormat && metadata.tracks.length) {
                    metadatas.push(metadata);
                }
            }
        }
    }));
    let summaryContainerElement = `<div id="summary-container" data-max-tag="${maxTagCount}" data-max-track="${maxTrackCount}" data-max-comment="${maxCommentCount}">\n`;
    // sort to make index.html stable
    metadatas.sort((m1, m2) => m1.id.localeCompare(m2.id));
    for (const metadata of metadatas) { 
        summaryContainerElement += `    <div class="summary" data-id="${metadata.id}">${metadata.title}</div>\n`;
    }
    summaryContainerElement += '  </div>';
    template = template.replace('<div id="summary-container"></div>', summaryContainerElement);

    const styles = await fs.readFile('client.css', 'utf-8');
    template = template.replace('<style></style>', `<style>\n${minifycss(styles)}\n  </style>`);

    const scripts = await fs.readFile('client.ts', 'utf-8');
    const { config: tsconfig } = ts.parseConfigFileTextToJson("tsconfig.json", await fs.readFile('tsconfig.json', 'utf-8'));
    // oh basic transpile is so simple
    const transpileResult = ts.transpile(scripts, tsconfig.compilerOptions);
    template = template.replace('<script></script>', `<script type="module">\n${transpileResult.trim()}\n  </script>`);

    logInfo(`write index.html`);
    await fs.writeFile(makepath('index.html'), template);
}

// various helper scripts to use in migration service
// the migration originally means migrate from old local storage to current new local storage,
// now it means migrate from my provider's online access to my local storage's offline access
async function handleMigrateCommand(parameters: string[]) {

    const directoryNames = await fs.readdir(config.dataDirectory);
    // rough workids according to directory names in data datadictory, compare to various kind of work id collection later
    const roughWorkIds = directoryNames.filter(d => d.startsWith('RJ'));

    // validate: file structure complete (has metadata.json), have track, size match, track name no track index, subtitle parse
    if (parameters[0] == 'validate') {
        await Promise.all(roughWorkIds.map(async workId => {
            const metadataPath = makepath(workId, 'metadata.json');
            if (!npfs.existsSync(metadataPath)) {
                return logError(`${workId}: incomplete file structure`);
            }
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
            if (metadata.id != workId) {
                return logError(`${workId}: but metadata.id is ${metadata.id}?`);
            } else if (!/^RJ\d{8}$/.test(workId)) {
                return logError(`${workId}: but is not RJ\\d{8}?`);
            } else if (!metadata.retired && metadata.tracks.length == 0) {
                return logError(`${workId}: no track`);
            }

            const WorkMetadataPropertyNames: (keyof WorkMetadata)[] = [
                'id', 'providerLink', 'providerProviderLink',
                'actors', 'providerTags', 'languageEditions',
                'title', 'addTime', 'lastAccessTime', 'tags',
                'retired', 'comments', 'managementComments', 'score',
                'audioWorkId', 'audioFormat', 'subtitleWorkId', 'subtitleFormat',
                'tracks',
            ]; // why do `[] as keyof[]` version do not report on typo?
            for (const propertyName of Object.keys(metadata)) {
                if (!WorkMetadataPropertyNames.includes(propertyName as any)) {
                    return logError(`${workId}: metadata unknown property ${propertyName}`);
                }
            }
            if (!Array.isArray(metadata.providerTags)) { return logError(`${workId}: metadata.providerTags is not array`); }
            if (!Array.isArray(metadata.languageEditions)) { return logError(`${workId}: metadata.languageEditions is not array`); }
            if (!Array.isArray(metadata.actors)) { return logError(`${workId}: metadata.actors is not array`); }
            if (!Array.isArray(metadata.tags)) { return logError(`${workId}: metadata.tags is not array`); }
            if (metadata.comments && !Array.isArray(metadata.comments)) { return logError(`${workId}: metadata.comments is not array`); }
            if (metadata.managementComments && !Array.isArray(metadata.managementComments)) {
                return logError(`${workId}: metadata.managementComments is not array`);
            }
            if (!Array.isArray(metadata.tracks)) { return logError(`${workId}: metadata.tracks is not array`); }
            const TrackMetadataPropertyNames: (keyof TrackMetadata)[] = [
                'index', 'name',
                'duration', 'comments',
                'workInProgress',
                'providerPath', 'subtitleProviderPath',
            ];
            for (const track of metadata.tracks) {
                for (const propertyName of Object.keys(track)) {
                    if (!TrackMetadataPropertyNames.includes(propertyName as any)) {
                        return logError(`${workId}: track ${track.index} unknown property ${propertyName}`);
                    }
                }
                if (track.comments && !Array.isArray(track.comments)) {
                    return logError(`${workId}: track ${track.index} comments is not array`);
                }
            }
            if ([...metadata.languageEditions].sort((e1, e2) => +e1.substring(2) - +e2.substring(2)).some((s, i) => metadata.languageEditions[i] != s)) {
                // TODO test this
                logInfo(`${workId}: language edition sort difference？`);
            }

            if (!npfs.existsSync(makepath(workId, 'cover.jpg')) && !npfs.existsSync(makepath(workId, 'cover.avif'))) {
                return logError(`${workId}: neither cover.jpg and cover.avif exists?`)
            }

            const fileinfoPath = makepath(workId, `${workId}-fileinfo.json`);
            const fileinfo = JSON.parse(await fs.readFile(fileinfoPath, 'utf-8')) as FileInfoNode[];
            const files = { [workId]: flattenFileInfo({ type: 'folder', title: '(root)', children: fileinfo }) };
            // there are normally 1, uncommonly 2, rarely 3 editions, no need to parallel
            for (const editionId of metadata.languageEditions) {
                if (!/^RJ\d{8}$/.test(editionId)) {
                    return logError(`${workId}: invalid edition id format? ${editionId}`);
                } else if (+workId.substring(2) > +editionId.substring(2)) {
                    return logError(`${workId}: main work id larger than edition work id? ${editionId}`);
                }
                const fileinfoPath = makepath(workId, `${editionId}-fileinfo.json`);
                const fileinfo = JSON.parse(await fs.readFile(fileinfoPath, 'utf-8')) as FileInfoNode[];
                files[editionId] = flattenFileInfo({ type: 'folder', title: '(root)', children: fileinfo });
            }
            const ctx: CommandContext = { id: workId, meta: metadata, info: null, files };

            if (metadata.audioWorkId && metadata.audioWorkId != metadata.id && !metadata.languageEditions.includes(metadata.audioWorkId)) {
                return logError(`${workId}: invalid audio work id? ${metadata.audioWorkId} not in ${metadata.languageEditions.join(',')}`);
            } else if (metadata.subtitleWorkId && metadata.subtitleWorkId != metadata.id && !metadata.languageEditions.includes(metadata.subtitleWorkId)) {
                return logError(`${workId}: invalid subtitle work id? ${metadata.subtitleWorkId} not in ${metadata.languageEditions.join(',')}`);
            }

            if (metadata.audioFormat && metadata.audioFormat != 'ogg') {
                return logError(`${workId}: invalid audio format, don't forget to convert exsiting works`);
            } else if (metadata.subtitleFormat && metadata.subtitleFormat != 'txt' && metadata.subtitleFormat != 'vss') {
                return logError(`${workId}: invalid subtitle format, don't forget to convert exsiting works`);
            }

            if (metadata.retired) { return; }

            let reportedProviderAudioLocalFileMissing: boolean;
            let reportedProviderSubtitleLocalFileMissing: boolean;
            let existingProviderAudioFormat: string;
            let existingProviderSubtitleFormat: string;
            for (const track of ctx.meta.tracks) {
                // first validate provider file
                let providerAudioFileOk = true;
                let providerSubtitleFileOk = true;
                const audioFile = files[(ctx.meta.audioWorkId ?? ctx.id)][track.providerPath - 1];
                if (!audioFile) {
                    return logError(`${workId}: track ${track.index} provider path out of range?`);
                }
                const providerAudioFormat = path.extname(audioFile.providerPath).substring(1);
                if (!['mp3', 'wav', 'flac'].includes(providerAudioFormat)) {
                    logError(`${workId}: track ${track.index} unknown provider audio format ${providerAudioFormat}`);
                } else {
                    if (!existingProviderAudioFormat) {
                        existingProviderAudioFormat = providerAudioFormat;
                    } else if (providerAudioFormat != existingProviderAudioFormat) {
                        logError(`${workId}: track ${track.index} provider audio format ${providerAudioFormat} not same as previous ${existingProviderAudioFormat}`);
                    }
                }
                const providerAudioFileLocalPath = makepath(workId, `${ctx.meta.audioWorkId ?? ctx.id}-file${track.providerPath}.${providerAudioFormat}`);
                if (!npfs.existsSync(providerAudioFileLocalPath)) {
                    providerAudioFileOk = false;
                    if (!reportedProviderAudioLocalFileMissing) {
                        logError(`${workId}: track ${track.index} provider audio file missing ${providerAudioFileLocalPath}`);
                        reportedProviderAudioLocalFileMissing = true;
                    }
                } else {
                    const stat = await fs.stat(providerAudioFileLocalPath);
                    if (stat.size != audioFile.size) {
                        providerAudioFileOk = false;
                        logError(`${workId}: track ${track.index} provider size mismatch, expect ${audioFile.size} actual ${stat.size}`);
                    }
                }
                if (track.subtitleProviderPath && track.subtitleProviderPath != -1) {
                    const subtitleFile = files[(metadata.subtitleWorkId ?? metadata.id)][track.subtitleProviderPath - 1];
                    if (!subtitleFile) {
                        return logError(`${workId}: track ${track.index} subtitle provider path out of range?`);
                    } 
                    const providerSubtitleFormat = path.extname(subtitleFile.providerPath).substring(1);
                    if (!['vtt', 'srt', 'lrc', 'pdf', 'txt'].includes(providerSubtitleFormat)) {
                        logError(`${workId}: track ${track.index} unknown provider subtitle format ${providerSubtitleFormat}`);
                    } else {
                        if (!existingProviderSubtitleFormat) {
                            existingProviderSubtitleFormat = providerSubtitleFormat;
                        } else if (providerSubtitleFormat != existingProviderSubtitleFormat) {
                            logError(`${workId}: track ${track.index} provider subtitle format ${providerSubtitleFormat} not same as previous ${existingProviderSubtitleFormat}`);
                        }
                    }
                    const providerSubtitleFilePath = makepath(workId, `track${track.index}.${providerAudioFormat}.${providerSubtitleFormat}`);
                    if (!npfs.existsSync(providerSubtitleFilePath)) {
                        providerSubtitleFileOk = false;
                        if (!reportedProviderSubtitleLocalFileMissing) {
                            logError(`${workId}: track ${track.index} subtitle file missing`);
                            reportedProviderSubtitleLocalFileMissing = true;
                        }
                    } else {
                        const stat = await fs.stat(providerSubtitleFilePath);
                        if (stat.size != subtitleFile.size) {
                            providerSubtitleFileOk = false;
                            logError(`${workId}: track ${track.index} subtitle size mismatch, expect ${subtitleFile.size} actual ${stat.size}`);
                        }
                    }
                }

                // then validate converted file ok
                let modernAudioFileOk = true;
                let simpleSubtitleFileOk = true;
                const audioFilePath = makepath(workId, `track${track.index}.${metadata.audioFormat}`);
                if (!npfs.existsSync(audioFilePath)) {
                    modernAudioFileOk = false;
                    if (!reportedProviderAudioLocalFileMissing) {
                        logError(`${workId}: track ${track.index} audio file missing ${audioFilePath}`);
                        reportedProviderAudioLocalFileMissing = true;
                    }
                }
                if (track.subtitleProviderPath) {
                    const subtitleFilePath = makepath(workId, `track${track.index}.${metadata.subtitleFormat}`)
                    if (!npfs.existsSync(subtitleFilePath)) {
                        simpleSubtitleFileOk = false;
                        if (!reportedProviderSubtitleLocalFileMissing) {
                            logError(`${workId}: track ${track.index} subtittle file missing ${subtitleFilePath}`);
                            reportedProviderSubtitleLocalFileMissing = true;
                        }
                    }
                }
                if (providerAudioFileOk && providerSubtitleFileOk && modernAudioFileOk && simpleSubtitleFileOk && track.workInProgress) {
                    logError(`${workId}: track ${track.index} files completed but workinprogress flag set`);
                } else if ((!providerAudioFileOk || !providerSubtitleFileOk || !modernAudioFileOk || !simpleSubtitleFileOk) && !track.workInProgress) {
                    logError(`${workId}: track ${track.index} files not completed but workinprogress flag missing`);
                }
            }
            // not this, especially allow chinese or japaness kanji as index, they make track name more interesting
            // const alternativeNumbers = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
            // check track index removed from track name, this is warning
            const maybeForgetToRemoveTracks = metadata.tracks.filter(t => t.name && t.name.includes(t.index.toString()));
            if (maybeForgetToRemoveTracks.length > 2) {
                logError(`${workId}: may be forget to remove track index from track name`);
            }

            // TODO validate other files not belong to track with naming convention {workid}-file{index}.{samesuffix}

        }));

    // stat: all kinds of statistics
    } else if (parameters[0] == 'stat') {
        const displayHolders = parameters[1] == 'holders';

        // major work count need file structure, has track, and not retired
        // all other information respect these condition, this is work as avg base
        let workCount = 0;
        let hasSubtitleWorkCount = 0;
        // work with specific properties count
        let filesCompletedWorkCount = 0;
        let filesCompletedHasSubtitleWorkCount = 0;
        let workCountPerAudioType = { mp3: 0, wav: 0, flac: 0 };
        let monthlySpread: Map<string, number> = new Map(); // YYYYMM => count
        let weekdaySpread: Map<number, number> = new Map(); // weekday => count
        let hourlySpread: Map<number, number> = new Map();  // hour => count
        // work level properties
        let maxTagCountHolders: [WorkMetadata, number][] = [];
        let totalTrackCount = 0;
        let maxTrackCountHolders: [WorkMetadata, number][] = [];
        let maxCommentCountHolders: [WorkMetadata, number][] = [];
        // size statistics, don't care whether file exists
        let audioSuperTotalBytes = 0; // all files from raw fileinfo
        let audioTotalBytes = 0;
        let maxAudioTotalBytesHolders: [WorkMetadata, number][] = [];
        let maxAudioAverageBytesHolders: [WorkMetadata, number][] = [];
        let audioTotalDuration = 0; // in seconds
        let maxAudioTotalDurationHolders: [WorkMetadata, number][] = [];
        let maxAudioAverageDurationHolders: [WorkMetadata, number][] = [];
        let maxSubtitleCountHolders: [WorkMetadata, number][] = [];
        // because I'm simply dividing file size by duration, actual boundary is more relaxed
        // UPDATE what do you mean by ogg 9kbps still listens similar (7kbps listens not good)
        let bitrateCounts = {
            'mp3 >320kbps': 0, // actual boundary is 330
            'mp3 320kbps': 0,
            'mp3 256kbps': 0,
            'mp3 192kbps': 0,
            'mp3 <192kbps': 0, // actual boundary is 190
            'wav >3072kbps': 0, // actual boundary is 3100
            'wav 3072kbps': 0,
            'wav 2304kbps': 0,
            'wav 1536kbps': 0,
            'wav 1411kbps': 0,
            'wav <1411kbps': 0,
            // flac is too few
            // 529kbps: 1, 483kbps: 1, 2671kbps: 1, 2695kbps: 1,
        };

        const updateHolders = (holders: [WorkMetadata, number][], metadata: WorkMetadata, value: number) => {
            holders.push([metadata, value]);
            holders.sort((m1, m2) => m2[1] - m1[1]);
            holders.splice(0, holders.length, ...holders.slice(0, 10));
        };
        await Promise.all(roughWorkIds.map(async workId => {
            const metadataPath = makepath(workId, 'metadata.json');
            // this is now an error not a count
            if (!npfs.existsSync(metadataPath)) { return logError(`${workId}: missing metadata.json`); }
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
            // retired work is not in major work count
            if (metadata.retired) { return; }
            // this is now an error not a count
            if (metadata.tracks.length == 0) { return logError(`${workId}: no tracks`); }
            workCount += 1;
            if (metadata.tracks.some(t => t.subtitleProviderPath)) { hasSubtitleWorkCount += 1; }

            (workCountPerAudioType as any)[metadata.audioFormat] += 1;
            const month = metadata.addTime.substring(0, 6);
            monthlySpread.set(month, monthlySpread.has(month) ? monthlySpread.get(month) + 1 : 1);
            const addTime = parseMetadataTime(metadata.addTime);
            hourlySpread.set(addTime.hour, hourlySpread.has(addTime.hour) ? hourlySpread.get(addTime.hour) + 1 : 1);
            weekdaySpread.set(addTime.dayOfWeek, weekdaySpread.has(addTime.dayOfWeek) ? weekdaySpread.get(addTime.dayOfWeek) + 1 : 1);

            updateHolders(maxTagCountHolders, metadata,
                // tag count: provider tags + actors + my tags + 1 for score + optional 1 for "has subtitle" tag
                metadata.providerTags.length + metadata.actors.length + metadata.tags.length + 1 + (metadata.subtitleFormat ? 1 : 0));
            totalTrackCount += metadata.tracks.length;
            updateHolders(maxTrackCountHolders, metadata, metadata.tracks.length);
            // work level comments and track level comments now display in same ui elements
            updateHolders(maxCommentCountHolders, metadata,
                (metadata.comments?.length ?? 0) + metadata.tracks.reduce((acc, t) => acc + (t.comments?.length ?? 0), 0));

            const fileinfoPath = makepath(workId, `${workId}-fileinfo.json`);
            const fileinfo = JSON.parse(await fs.readFile(fileinfoPath, 'utf-8')) as FileInfoNode[];
            const files = { [workId]: flattenFileInfo({ type: 'folder', title: '(root)', children: fileinfo }) };
            // there are normally 1, uncommonly 2, rarely 3 editions, no need to parallel
            for (const editionId of metadata.languageEditions) {
                if (!/^RJ\d{8}$/.test(editionId)) {
                    return logError(`${workId}: invalid edition id format? ${editionId}`);
                } else if (+workId.substring(2) > +editionId.substring(2)) {
                    return logError(`${workId}: main work id larger than edition work id? ${editionId}`);
                }
                const fileinfoPath = makepath(workId, `${editionId}-fileinfo.json`);
                const fileinfo = JSON.parse(await fs.readFile(fileinfoPath, 'utf-8')) as FileInfoNode[];
                files[editionId] = flattenFileInfo({ type: 'folder', title: '(root)', children: fileinfo });
            }
            const ctx: CommandContext = { id: workId, meta: metadata, info: null, files };

            let totalBytes = 0;
            let totalDuration = 0;
            let maxSubtitleCount = 0;
            // stat's completed flag need both provider files exist and processed files exist
            let filesCompleted = true;
            for (const track of metadata.tracks) {
                const audioFile = ctx.files[(metadata.audioWorkId ?? metadata.id)][track.providerPath - 1];
                if (!audioFile) {
                    return logError(`${workId} track ${track.index}: provider path out of range? ${track.providerPath}`);
                }
                totalBytes += audioFile.size;
                totalDuration += audioFile.duration;
                const bitrate = totalBytes * 8 / totalDuration / 1000; // kbps
                const providerAudioFormat = path.extname(audioFile.providerPath).substring(1);
                if (providerAudioFormat == 'mp3') {
                    if (bitrate > 330) { bitrateCounts['mp3 >320kbps'] += 1; }
                    else if (bitrate > 288) { bitrateCounts['mp3 320kbps'] += 1; }
                    else if (bitrate > 224) { bitrateCounts['mp3 256kbps'] += 1; }
                    else if (bitrate > 190) { bitrateCounts['mp3 192kbps'] += 1; }
                    else { bitrateCounts['mp3 <192kbps'] += 1; }
                } else if (providerAudioFormat == 'wav') {
                    if (bitrate > 3100) { bitrateCounts['wav >3072kbps'] += 1; }
                    else if (bitrate > 2700) { bitrateCounts['wav 3072kbps'] += 1; }
                    else if (bitrate > 1900) { bitrateCounts['wav 2304kbps'] += 1; }
                    else if (bitrate > 1500) { bitrateCounts['wav 1536kbps'] += 1; }
                    else if (bitrate > 1400) { bitrateCounts['wav 1411kbps'] += 1; }
                    else { bitrateCounts['wav <1411kbps'] += 1; }
                }
                if ((providerAudioFormat == 'mp3' && (bitrate < 180 || bitrate > 350))
                    || (providerAudioFormat == 'wav' && (bitrate < 2000 || bitrate > 4000))
                    || providerAudioFormat == 'flac'
                ) {
                    // console.log(`bitrate ${workId}/${ctx.meta.audioWorkId ?? ctx.id}-file${track.providerPath}.${providerAudioFormat} ${bitrate}kbps`);
                }
                
                // for stat, only need to check converted audio/subtitle file exist
                const modernAudioFileLocalPath = makepath(workId, `track${track.index}.${metadata.audioFormat}`);
                if (!npfs.existsSync(modernAudioFileLocalPath)) {
                    filesCompleted = false;
                } else {
                    const stat = await fs.stat(modernAudioFileLocalPath);
                    if (stat.size != audioFile.size) { filesCompleted = false; }
                }

                if (track.subtitleProviderPath) {
                    if (track.subtitleProviderPath != -1) {
                        const subtitleFile = ctx.files[(metadata.subtitleWorkId ?? metadata.id)][track.subtitleProviderPath - 1];
                        if (!subtitleFile) {
                            return logError(`${workId} track ${track.index}: subtitle provider path out of range? ${track.providerPath}`);
                        }
                        const simpleSubtitleFileLocalPath = makepath(workId, `track${track.index}.${metadata.subtitleFormat}`);
                        if (!npfs.existsSync(simpleSubtitleFileLocalPath)) {
                            filesCompleted = false;
                        } else {
                            const stat = await fs.stat(simpleSubtitleFileLocalPath);
                            if (stat.size != subtitleFile.size) { filesCompleted = false; }
                            const subtitleCount = (await fs.readFile(simpleSubtitleFileLocalPath, 'utf-8')).split('\n').length;
                            maxSubtitleCount = Math.max(maxSubtitleCount, subtitleCount);
                        }
                    }
                }
            }

            audioTotalBytes += totalBytes;
            updateHolders(maxAudioTotalBytesHolders, metadata, totalBytes);
            updateHolders(maxAudioAverageBytesHolders, metadata, totalBytes / metadata.tracks.length);
            audioTotalDuration += totalDuration;
            updateHolders(maxAudioTotalDurationHolders, metadata, totalDuration);
            updateHolders(maxAudioAverageDurationHolders, metadata, totalDuration / metadata.tracks.length);
            updateHolders(maxSubtitleCountHolders, metadata, maxSubtitleCount);

            if (filesCompleted) {
                filesCompletedWorkCount += 1;
                if (metadata.subtitleFormat) { filesCompletedHasSubtitleWorkCount += 1; }
            }
        }));

        logInfo(`work count ${workCount}`);
        logInfo(`files completed work count ${filesCompletedWorkCount}`);
        logInfo(`has subtitle ${hasSubtitleWorkCount} completed has subtitle ${filesCompletedHasSubtitleWorkCount}`);
        logInfo(`mp3 ${workCountPerAudioType.mp3} wav ${workCountPerAudioType.wav} flac ${workCountPerAudioType.flac}`);
        if (displayHolders) {
            logInfo('monthly spread:');
            const monthlyRecords = Array.from(monthlySpread.entries());
            monthlyRecords.sort((r1, r2) => r1[0].localeCompare(r2[0]));
            monthlyRecords.forEach(([m, v]) => console.log(`  ${m}: ${v.toString().padStart(2, ' ')} ${new Array(v).fill('-').join('')}`));
            logInfo('weekday spread:');
            const weekdayRecords = Array.from(weekdaySpread.entries());
            weekdayRecords.sort((r1, r2) => r1[0] - r2[0]);
            weekdayRecords.forEach(([m, v]) => console.log(`  ${m}: ${v.toString().padStart(2, ' ')} ${new Array(v).fill('-').join('')}`));
            logInfo('hourly spread (utc+8):');
            const hourlyRecords = Array.from(hourlySpread.entries());
            hourlyRecords.sort((r1, r2) => r1[0] - r2[0]);
            hourlyRecords.forEach(([m, v]) => console.log(`  ${((m + 8) % 24).toString()
                .padStart(2, '0')}: ${v.toString().padStart(2, ' ')} ${new Array(v).fill('-').join('')}`));
        }
        logInfo(`total track count ${totalTrackCount} avg track count ${Math.floor(totalTrackCount / workCount * 100) / 100}`);
        logInfo(`max track count ${maxTrackCountHolders[0][0].id} ${maxTrackCountHolders[0][1]}`);
        if (displayHolders) { maxTrackCountHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${c}`)); }
        logInfo(`max tag count ${maxTagCountHolders[0][0].id} ${maxTagCountHolders[0][1]}`);
        if (displayHolders) { maxTagCountHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${c}`)); }
        logInfo(`max comment count ${maxCommentCountHolders[0][0].id} ${maxCommentCountHolders[0][1]}`);
        if (displayHolders) { maxCommentCountHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${c}`)); }

        logInfo(`audio total size ${getDisplayFileSize(audioTotalBytes)}`);
        logInfo(`audio avg size ${getDisplayFileSize(audioTotalBytes / workCount)}`);
        logInfo(`max audio size ${maxAudioTotalBytesHolders[0][0].id} ${getDisplayFileSize(maxAudioTotalBytesHolders[0][1])}`);
        if (displayHolders) { maxAudioTotalBytesHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${getDisplayFileSize(c)}`)); }
        logInfo(`max audio avg size ${maxAudioAverageBytesHolders[0][0].id} ${getDisplayFileSize(maxAudioAverageBytesHolders[0][1])}`);
        if (displayHolders) { maxAudioAverageBytesHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${getDisplayFileSize(c)}`)); }

        logInfo(`audio total duration ${getDisplayDuration(audioTotalDuration)}`);
        logInfo(`audio avg work duration ${getDisplayDuration(audioTotalDuration / workCount)}`);
        logInfo(`audio avg track duration ${getDisplayDuration(audioTotalDuration / totalTrackCount)}`);
        logInfo(`max audio duration ${maxAudioTotalDurationHolders[0][0].id} ${getDisplayDuration(maxAudioTotalDurationHolders[0][1])}`);
        if (displayHolders) { maxAudioTotalDurationHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${getDisplayDuration(c)}`)); }
        logInfo(`max audio avg duration ${maxAudioAverageDurationHolders[0][0].id} ${getDisplayDuration(maxAudioAverageDurationHolders[0][1])}`);
        if (displayHolders) { maxAudioAverageDurationHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${getDisplayDuration(c)}`)); }
        logInfo(`max subtitle count ${maxSubtitleCountHolders[0][0].id} ${maxSubtitleCountHolders[0][1]}`);
        if (displayHolders) { maxSubtitleCountHolders.forEach(([m, c]) => console.log(`  ${m.id}: ${c}`)); }

        if (displayHolders) { Object.entries(bitrateCounts).forEach(([k, v]) => console.log(`  ${k}: ${v}`)); }

    // after migrating comments from single string to array, keep this for easy inspection of all existing comments
    } else if (parameters[0] == "comment") {
        for (const workId of roughWorkIds) {
            const metadataPath = makepath(workId, 'metadata.json');
            if (!npfs.existsSync(metadataPath)) {
                return logError(`${workId}: incomplete file structure`);
            }
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
            metadata.comments?.forEach(c => console.log(`${workId}: ${c}`));
            metadata.managementComments?.forEach(c => console.log(`${workId}: ${c}`));
            metadata.tracks.forEach(t => t.comments?.forEach(c => console.log(`${workId}: track ${t.index} ${c}`)));
        }

    // migrate file structure
    } else if (parameters[0] == "filename") {
        // manually include extra files
        for (const workId of roughWorkIds) {
            const metadataPath = makepath(workId, 'metadata.json');
            if (!npfs.existsSync(metadataPath)) {
                return logError(`${workId}: incomplete file structure`);
            }
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;

            const fileinfoPath = makepath(workId, `${metadata.id}-fileinfo.json`);
            const mainNotFlatFileInfos = JSON.parse(await fs.readFile(fileinfoPath, 'utf-8')) as FileInfoNode[];
            const files = { [workId]: flattenFileInfo({ type: 'folder', title: '(root)', children: mainNotFlatFileInfos }) };
            for (const editionId of metadata.languageEditions) {
                const fileinfoPath = makepath(workId, `${editionId}-fileinfo.json`);
                const editionNotFlatFileInfos = JSON.parse(await fs.readFile(fileinfoPath, 'utf-8')) as FileInfoNode[];
                files[editionId] = flattenFileInfo({ type: 'folder', title: '(root)', children: editionNotFlatFileInfos });
            }

            // const willrename = async (name1: string, name2: string) => {
            //     // logInfo(`${workId}: will rename ${name1} to ${name2}`);
            //     // if (!npfs.existsSync(name1)) { logError('not exist?'); }
            //     await fs.rename(name1, name2);
            // };

            // 1. rename {workid}-trackinfo.json to {workid}-fileinfo.json
            // await willrename(makepath(workId, `${workId}-trackinfo.json`), makepath(workId, `${workId}-fileinfo.json`));
            // for (const editionId of metadata.languageEditions) {
            //     await willrename(makepath(workId, `${editionId}-trackinfo.json`), makepath(workId, `${editionId}-fileinfo.json`));
            // }

            // if (metadata.retired) {
            //     continue;
            // }
            // let subtitleFormat: string;
            // 2. rename track{trackindex}.mp3 to {workid}-file{fileindex}.mp3
            //    rename track{trackindex}.mp3.vtt to {workid}-file{fileindex}.vtt
            // for (const track of metadata.tracks) {
            //     await willrename(
            //         makepath(workId, `track${track.index}.${metadata.audioFormat}`),
            //         makepath(workId, `${metadata.audioWorkId ?? metadata.id}-file${track.providerPath}.${metadata.audioFormat}`));
            //     if (track.subtitleProviderPath && track.subtitleProviderPath != -1) {
            //         const subtitleFileInfo = filemap[metadata.subtitleWorkId ?? metadata.id][track.subtitleProviderPath - 1];
            //         if (!subtitleFileInfo) { return logError(`${workId}: track ${track.index}: invalid subtitle provider path? ${track.subtitleProviderPath}`) }
            //         subtitleFormat = path.extname(subtitleFileInfo.path);
            //         await willrename(
            //             makepath(workId, `track${track.index}.${metadata.audioFormat}${subtitleFormat}`),
            //             makepath(workId, `${metadata.subtitleWorkId ?? metadata.id}-file${track.subtitleProviderPath}${subtitleFormat}`));
            //     }
            // }

            // 3. remove metadata.audioFormat from all files
            delete metadata.audioFormat;

            // 4. convert all audio files, by the way, task count is 1552
            //    to test the parameters, only part of the files are converted,
            //    for works with result .ogg file, mark metadata.audioformat while mark other track's workinprogress flag to make client side work to test the effect

            const hasogg = metadata.tracks.some(t => npfs.existsSync(makepath(workId, `track${t.index}.opus`)));
            if (hasogg) {
                metadata.audioFormat = 'opus';
                for (const track of metadata.tracks) {
                    if (!npfs.existsSync(makepath(workId, `track${track.index}.opus`))) {
                        track.workInProgress = true;
                    } else {
                        delete track.workInProgress;
                        logInfo(`${workId} track ${track.index}`);
                    }
                }
                await writeMetadata(metadata);
            } else {
                for (const track of metadata.tracks) {
                    track.workInProgress = true;
                }
                await writeMetadata(metadata);
            }

            // const knownFiles = [
            //     'cover.jpg',
            //     'cover.avif',
            //     'metadata.json',
            //     `${workId}-workinfo.json`,
            //     `${workId}-trackinfo.json`,
            // ].concat(metadata.languageEditions.map(editionId => [
            //     `${editionId}-workinfo.json`,
            //     `${editionId}-trackinfo.json`,
            // ]).flat()).concat(metadata.tracks.map(track => [
            //     `track${track.index}.${metadata.audioFormat}`,
            //     track.subtitleProviderPath ? `track${track.index}.${metadata.audioFormat}${subtitleFormat}` : null,
            //     // specially exclude all vss file, they are not extra file
            //     track.subtitleProviderPath ? `track${track.index}.${metadata.audioFormat}.vss` : null,
            // ].filter(x => x)).flat());
            // for (const filename of await fs.readdir(makepath(workId))) {
            //     if (!knownFiles.includes(filename)) {
            //         // console.log(`${workId}: extra file ${filename}`);
            //     }
            // }
        }

    // following are investigate/interesting topics:
    // shortid: short ids and avg length?
    } else if (parameters[0] == "shortid") {
        let totalLength = 0;
        for (const workId of roughWorkIds) {
            for (let length = 1; length < workId.length - 2; length += 1) {
                const shortId = workId.substring(workId.length - length);
                if (roughWorkIds.filter(w => w.endsWith(shortId)).length == 1) {
                    logInfo(`${workId}: ${shortId}`);
                    totalLength += shortId.length;
                    break;
                }
            }
        }
        logInfo(`short id avg length ${totalLength / roughWorkIds.length}`);

    // tagdb: for now, only collect occurance of provider tags and actors and print them in order
    // TODO try prefer japaness chinese character, try avoid english, chinese chinese and katakana/harakana
    } else if (parameters[0] == "tagdb") {
        const tagCounts: Record<string, number> = {};
        const actorCounts: Record<string, number> = {};
        await Promise.all(roughWorkIds.map(async workId => {
            const metadataPath = makepath(workId, 'metadata.json');
            if (!npfs.existsSync(metadataPath)) { return; }
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
            for (const tag of metadata.providerTags) {
                tag in tagCounts ? tagCounts[tag] += 1 : (tagCounts[tag] = 1);
            }
            for (const actor of metadata.actors) {
                actor in actorCounts ? actorCounts[actor] += 1 : (actorCounts[actor] = 1);
            }
        }));
        const allTags = Object.entries(tagCounts).sort((t1, t2) => t1[0].localeCompare(t2[0]));
        const allActors = Object.entries(actorCounts).sort((t1, t2) => t1[0].localeCompare(t2[0]));
        for (const [tag, times] of allTags) { console.log(`${tag}: ${times}`); }
        for (const [tag, times] of allActors) { console.log(`${tag}: ${times}`); }

    } else {
        logInfo('USAGE: autotrack.ts migrate validate | subtitle WORKID');
    }
    return;
}

const command = process.argv[2];
if (command == 'page') {
    await handleMakePage();
} else if (command == 'migrate') {
    await handleMigrateCommand(process.argv.slice(3));
} else if (/^RJ\d+$/.test(command) || /^\d+$/.test(command)) {
    await handleWorkCommand(process.argv.slice(2));
} else {
    printUsage();
}

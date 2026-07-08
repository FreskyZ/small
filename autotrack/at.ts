import fs from 'node:fs/promises';
import npfs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import { styleText } from 'node:util';
import { finished } from 'node:stream/promises';
import * as ts from 'typescript';

const config = JSON.parse(await fs.readFile('at.json', 'utf-8')) as {
    dataDirectory: string,
    providerBaseUri: string,
    providerApiBaseUri: string,
};
console.log(`autotrack.ts: data directory ${config.dataDirectory}`);
// console.log(`autotrack.ts: provider base uri ${config.providerBaseUri}`);
// console.log(`autotrack.ts: provider api base uri ${config.providerApiBaseUri}`);

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
function now() {
    const v = Temporal.Now.zonedDateTimeISO();
    return `${v.year}${v.month.toString().padStart(2, '0')}${v.day.toString().padStart(2, '0')}T${
        v.hour.toString().padStart(2, '0')}${v.minute.toString().padStart(2, '0')}${v.second.toString().padStart(2, '0')}Z`;
}
// convert legacy work info YYYY-MM-DDThh:mm:ssZ to YYYYMMDDThhmmssZ
function convertLegacyTime(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value)!;
    return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z`;
}
function getDisplayTemporalDuration(duration: Temporal.Duration) {
    return duration.minutes ? `${duration.minutes}m${duration.seconds}s` : `${duration.seconds}s`;
}

function getDisplaySize(size: number | undefined) {
    let displaySize = `${size}b`;
    if (size) {
        if (size > 1048576) {
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
        const minutes = Math.floor(duration / 60);
        const seconds = Math.round(duration - minutes * 60);
        displayDuration = minutes ? `${minutes}m${seconds}s` : `${seconds}s`;
    }
    return displayDuration;
}

function createProgressPipe(totalSize: number): stream.Duplex {
    const startTime = Temporal.Now.plainDateTimeISO();
    let transferredBytes = 0;
    // samples of transferred bytes for speed estimation, order by time asc
    let samples: { time: Temporal.PlainDateTime, value: number }[] = [];
    // throttle updating
    let lastUpdateTime = Temporal.Now.plainDateTimeISO();

    const update = (newLength: number, completed: boolean) => {
        transferredBytes += newLength;
        const now = Temporal.Now.plainDateTimeISO();
        // note that can flush befor eexpected totalsize
        if (Temporal.Duration.compare(now.since(lastUpdateTime), { seconds: 1 }) >= 0 || completed) {
            let message = '  ';
            message += getDisplayTemporalDuration(now.since(startTime));
            message += ' ';
            message += getDisplaySize(transferredBytes);
            message += '/'
            message += getDisplaySize(totalSize);

            const sample = samples.find(s => Temporal.Duration.compare(now.since(s.time), { minutes: 1 }) < 0);
            if (completed) {
                const speed = transferredBytes / now.since(startTime).total('seconds');
                message += ' ';
                message += getDisplaySize(speed); // display overall speed by the way
                message += '/s'
                // nothing to display in last message eta part
            } else if (!sample || Temporal.Duration.compare(now.since(sample.time), { seconds: 5 }) < 0) {
                // don't use duration < 5s
                message += ' ETA unknown';
            } else {
                const speed = (transferredBytes - sample.value) / now.since(sample.time).total('seconds');
                message += ' ';
                message += getDisplaySize(speed);
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
    console.log('  WORKID                              display metadata and raw track records');
    console.log('    title TITLE                       set work title');
    console.log('    tag TAG                           toggle tag');
    console.log('    comment [COMMENT]                 set work comment, use empty to clear');
    console.log('    score +VALUE/-VALUE/=VALUE        set work score');
    console.log('    access                            set work access time');
    console.log('    track INDEX move NEWINDEX         set track index');
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
}

// return null for already printed error
async function getWorkId(inputValue: string) {

    // handle short work id
    let workId: string = null;
    if (inputValue && /^RJ\d+$/.test(inputValue)) {
        workId = inputValue;
    } else if (inputValue && /^\d+$/.test(inputValue)) {
        const directoryNames = await fs.readdir(config.dataDirectory);
        const matches = directoryNames.filter(d => d.startsWith('RJ') && d.endsWith(inputValue));
        if (matches.length == 0) {
            logError(`short work id ${inputValue} not found`);
        } else if (matches.length > 1) {
            logError(`short work id ${inputValue} ambiguous`);
        } else {
            workId = matches[0];
            logInfo(`work id ${workId}`);
        }
    } else {
        logError(`USAGE: autotrack.ts work WORKID`);
    }
    
    // check language edition id
    let editionIdOk = true;
    if (workId) {
        const directoryNames = await fs.readdir(config.dataDirectory);
        await Promise.all(directoryNames.filter(d => d.startsWith('RJ')).map(async existingWorkId => {
            const metadataPath = path.join(config.dataDirectory, existingWorkId, 'metadata.json');
            if (npfs.existsSync(metadataPath)) {
                const existingMetadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
                if (existingMetadata.languageEditions.includes(workId)) {
                    logError(`cannot use language edition id, use main work id ${existingWorkId} instead`);
                    editionIdOk = false;
                }
            }
        }));
    }
    return editionIdOk ? workId : null;
}

// only these properties are interested
interface RawMetadata {
    title: string,
    tags: {
        i18n: { 'ja-jp': { name: string } },
    }[],
    vas: { name: string }[],
    source_url?: string,
    other_language_editions_in_db: { source_id: string }[],
    thumbnailCoverUrl: string,
}
interface RawTrackRecord {
    // by the way, mp4 is also audio
    type: 'folder' | 'audio' | 'text' | 'image',
    title: string,
    // afaik
    // for folder: children
    // for audio: duration, size, download url
    // for text: duration?, size, download url
    // for image: size, download url
    children?: RawTrackRecord[],
    duration?: number,
    size?: number,
    mediaDownloadUrl?: string,
}

// use work id as api parameter, use main work id as work directory
// raw track records use a tree structure, the returned single node is a virtual root node
// return [null, null] for already printed error UPDATE no expected error, all crash by the way
async function getRawMetadata(workId: string, mainWorkId: string): Promise<[RawMetadata, RawTrackRecord]> {
    const url = new URL(config.providerApiBaseUri);
    const pathPostfix = workId == mainWorkId ? '' : `-${workId}`;
    await fs.mkdir(path.join(config.dataDirectory, mainWorkId), { recursive: true });

    let metadata: RawMetadata;
    const metadataPath = path.join(config.dataDirectory, mainWorkId, `raw-metadata${pathPostfix}.json`);
    if (npfs.existsSync(metadataPath)) {
        // no need to precisely and gracefully handle json error in this small script
        metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    } else {
        url.pathname = `/api/workInfo/${workId.substring(2)}`;
        logInfo(`download raw work info ${workId} main work id ${mainWorkId}`);
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
        metadata = await response.json();
        await fs.writeFile(metadataPath, JSON.stringify(metadata, undefined, 2));
        logInfo(`download raw work info ${workId} main work id ${mainWorkId} complete`);
    }

    let records: RawTrackRecord[];
    const recordsPath = path.join(config.dataDirectory, mainWorkId, `raw-tracks${pathPostfix}.json`);
    if (npfs.existsSync(recordsPath)) {
        records = JSON.parse(await fs.readFile(recordsPath, 'utf-8'));
    } else {
        url.pathname = `/api/tracks/${workId.substring(2)}`;
        url.searchParams.append('v', '2');
        logInfo(`download raw track info ${workId} main work id ${mainWorkId}`);
        if (LOGURL) { logInfo(`download url ${url}`); }
        const response = await fetch(url);
        records = await response.json();
        await fs.writeFile(recordsPath, JSON.stringify(records, undefined, 2));
        logInfo(`download raw track info ${workId} main work id ${mainWorkId} complete`);
    }
    const rootRecord: RawTrackRecord = { type: 'folder', title: 'root', children: records };

    // download cover by the way
    if (workId == mainWorkId) {
        const coverImagePath = path.join(config.dataDirectory, mainWorkId, 'cover.jpg');
        if (!npfs.existsSync(coverImagePath)) {
            const url = new URL(metadata.thumbnailCoverUrl);
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

    return [metadata, rootRecord];
}

interface WorkMetadata {
    // original properties
    // should be convenient to avoid rely on external properties for this script and client side script?
    id: string,
    providerLink: string,
    providerProviderLink?: string,
    actors: string[],
    providerTags: string[],
    // work ids for language editions, variable names use eid (edition work id)
    // // this concept was named subwork, but that conflict with concept of subtitle which also abbreviated sub,
    // // so name this back to language editions same as raw metadata, which seems to be a standard name of concept
    // // in publishing areas (doujin asmr works are also published work)
    languageEditions: string[],
    // custom properties
    // note that title is customizable to remove unnecessary decorations
    title: string,
    addTime: string,
    lastAccessTime: string,
    tags: string[],
    comment?: string,
    // comment for backend management operations, not displayed at client
    // e.g. video record is 404 at the time of writing
    managementComment?: string,
    // score generally works as one access time +1,
    // but if you feel very good can +2, and feel not good -1
    score: number,
    // main work id or edition id
    audioWorkId?: string,
    // mp3 | wav, don't expect other formats for now
    audioFormat?: string,
    // empty for no subtitle, main work id or edition id
    subtitleWorkId?: string,
    // empty for no subtitle, available values vtt, lrc, others TODO
    // UPDATE: vtt is w3c standard? https://www.w3.org/TR/webvtt1/
    // UPDATE you should have reallized that w3c standard means there should be some level of builtin support
    // lrc format is "[mm:ss.xx]content" format, the time in next line indicate end of current line content
    subtitleFormat?: string,
    // no need to use tree structure because most of the time I only use one directory,
    // even if really need same name files from multiple directory I can prepend something
    // like folder name to dinstinguish, even for large works with like 100 files spreaded
    // in 3 layer directories, add a full path to track info is very enough for displaying
    // and manipulating, no need to make this tree structure
    tracks: TrackRecord[],
}
interface TrackRecord {
    index: number,
    name: string,
    duration: number,
    comment?: string,
    // original path in rawtracks, include original file name
    providerPath: string,
    // exist if have subtitle, regardless of belong to main work or editions
    subtitleProviderPath?: string,
}
// get or create metadata, only main work has main metadata
async function getMetadata(workId: string, rawMetadata: RawMetadata) {
    let metadata: WorkMetadata;
    const metadataPath = path.join(config.dataDirectory, workId, 'metadata.json');
    if (npfs.existsSync(metadataPath)) {
        // no need to precisely and gracefully handle json error in this small script
        metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    } else {
        // one invocation of this script only work on one workid, so no need to cache this
        interface LegacyWork { id: string, tags: string, addTime: string }
        const legacyWorks: LegacyWork[] = [];
        const legacyWorksOriginalContent = await fs.readFile('legacy.csv', 'utf-8');
        // id;kind;name;path;audioext;subext;tags;add;access
        for (const record of legacyWorksOriginalContent.trim().split('\n').slice(1)) {
            const fields = record.split(';');
            legacyWorks.push({ id: fields[0]!, tags: fields[6]!, addTime: fields[7]! });
        }
        const legacyMetadata = legacyWorks.find(w => w.id == workId);
        if (legacyMetadata) { logInfo('read legacy metadata'); }

        const providerLink = new URL(config.providerBaseUri);
        providerLink.pathname = `/work/${workId}`;
        // what spec are you using that YYYY-MM-DDThh:mm:ssZ is not parsable???
        // Temporal.ZonedDateTime.from(legacyMetadata.addTime) ???
        // Temporal.ZonedDateTime.from(new Date(legacyMetadata.addTime)) Date construct accepts but temporal constructor don't ???
        const time = legacyMetadata?.addTime ? convertLegacyTime(legacyMetadata.addTime) : now();

        metadata = {
            id: workId,
            providerLink: providerLink.toString(),
            providerProviderLink: rawMetadata.source_url!,
            actors: (rawMetadata.vas?.map(v => v?.name) ?? []).filter(x => x),
            providerTags: (rawMetadata.tags?.map(t => t?.i18n?.['ja-jp']?.name) ?? []).filter(x => x),
            languageEditions: (rawMetadata.other_language_editions_in_db?.map(e => e?.source_id) ?? []).filter(x => x),
            title: rawMetadata.title,
            addTime: time,
            lastAccessTime: time,
            tags: legacyMetadata?.tags ? legacyMetadata.tags.split(',') : [],
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
        comment: metadata.comment,
        managementComment: metadata.managementComment ?? '',
        audioWorkId: metadata.audioWorkId,
        audioFormat: metadata.audioFormat,
        subtitleWorkId: metadata.subtitleWorkId,
        subtitleFormat: metadata.subtitleFormat,
        tracks: metadata.tracks.sort((t1, t2) => t1.index! - t2.index!).map<TrackRecord>(t => ({
            index: t.index,
            name: t.name,
            comment: t.comment,
            duration: t.duration,
            providerPath: t.providerPath,
            subtitleProviderPath: t.subtitleProviderPath,
        })),
    };
    await fs.writeFile(path.join(config.dataDirectory, metadata.id, 'metadata.json'), JSON.stringify(newmetadata, undefined, 2));
}

interface FlatRawTrackRecord {
    type: string,
    // path separated with /, has leading /
    path: string,
    size: number,
    duration: number,
    mediaDownloadUrl: string,
}
function flattenRawTracks(root: RawTrackRecord) {
    const results: FlatRawTrackRecord[] = [];
    // dfs
    function collect(folder: RawTrackRecord, basepath: string) {
        for (const subfolder of folder.children?.filter(f => f.type == 'folder') ?? []) {
            collect(subfolder, basepath + '/' + subfolder.title);
        }
        for (const item of folder.children?.filter(f => f.type != 'folder') ?? []) {
            results.push({
                type: item.type,
                path: basepath + '/' + item.title,
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
    rawMetadata: RawMetadata,
    // edition work id to raw tracks,
    // also for main work: ctx.allRawTracks[ctx.id]
    allRawTracks: Record<string, FlatRawTrackRecord[]>,
}

function handleDisplayMetadata(ctx: CommandContext) {
    logInfo('metadata:');
    console.log(`  title: ${ctx.meta.title}`);
    console.log(`  actors: ${ctx.meta.actors.join(', ')}`);
    console.log(`  times: ${ctx.meta.addTime}, ${ctx.meta.lastAccessTime}`);
    console.log(`  tags: ${ctx.meta.tags.join(', ')}`);
    console.log(`  score: ${ctx.meta.score}`);
    console.log(`  comment: ${ctx.meta.comment ?? '(empty)'}`);
    console.log(`  management comment: ${ctx.meta.managementComment ?? '(empty)'}`);
    console.log(`  editions: ${ctx.meta.languageEditions.length ? ctx.meta.languageEditions.join(', ') : '(empty)'}`);
    console.log(`  audio work id: ${ctx.meta.audioWorkId ?? '(none)'}`);
    console.log(`  audio format: ${ctx.meta.audioFormat ?? '(none)'}`);
    console.log(`  subtitle work id: ${ctx.meta.subtitleWorkId ?? '(none)'}`);
    console.log(`  subtitle format: ${ctx.meta.subtitleFormat ?? '(none)'}`);
    console.log('  tracks:');
    for (const track of ctx.meta.tracks) {
        console.log(`    ${track.index}: ${track.name} ${styleText('gray', `(${track.providerPath})`)}`);
    }
    console.log('  raw tracks:');
    const getDisplayPath = (value: string) => value
        .replaceAll('mp3', styleText('yellow', 'mp3'))
        .replaceAll('vtt', styleText('yellow', 'vtt'))
        .replaceAll('lrc', styleText('yellow', 'lrc'));
    for (const [rawRecord, index] of ctx.allRawTracks[ctx.id].map((v, i) => [v, i] as const)) {
        console.log(`    ${styleText('cyanBright', (index + 1).toString())}: ${getDisplayPath(rawRecord.path)
            } ${styleText('gray', `[${getDisplaySize(rawRecord.size)} ${getDisplayDuration(rawRecord.duration)}]`)}`);
    }
    for (const editionId of ctx.meta.languageEditions) {
        for (const [rawRecord, index] of ctx.allRawTracks[editionId].map((v, i) => [v, i] as const)) {
            console.log(`    ${styleText('cyanBright', `${editionId}/${index + 1}`)}: ${getDisplayPath(rawRecord.path)
                } ${styleText('gray', `[${getDisplaySize(rawRecord.size)} ${getDisplayDuration(rawRecord.duration)}]`)}`);
        }
    }
}

// parameters: after "move" not include "move"
async function handleMoveTrack(ctx: CommandContext, track: TrackRecord, parameters: string[]) {
    if (!parameters[0]) {
        return logError('USAGE: autotrack.ts WORKID move INDEX NEWINDEX');
    }
    const newIndex = +parameters[0];
    if (!newIndex || newIndex <= 0) {
        return logError('invliad new index');
    } else if (ctx.meta.tracks.some(t => t.index != track.index && t.index == newIndex)) {
        return logError('new index already exist');
    }
    logInfo(`ATTENTION will try to move actual file, but no transaction and rollback for that, which means`);
    logInfo(`if audio file move ok but subtitle file move not ok, audio file will not rollback while metadata will not update`);
    if (ctx.meta.audioFormat) {
        const oldAudioPath = path.join(config.dataDirectory, ctx.id, `track${track.index}.${ctx.meta.audioFormat}`);
        const newAudioPath = path.join(config.dataDirectory, ctx.id, `track${newIndex}.${ctx.meta.audioFormat}`);
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
    } else if (rawIndex > ctx.allRawTracks[meid].length) {
        return logError(`invalid raw index in ${parameter}: out of range, max ${ctx.allRawTracks[meid].length}`);
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
        } else if (endRawIndex > ctx.allRawTracks[meid].length + 1) {
            return logError(`invalid end raw index in ${parameter}: out of range, max ${ctx.allRawTracks[meid].length + 1}`);
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
    
    if (ctx.meta.audioWorkId && ctx.meta.audioWorkId != audioWorkId) {
        return logError(`audio work id ${audioWorkId} is not same as existing value ${ctx.meta.audioWorkId}`);
    }
    const rawAudio = ctx.allRawTracks[audioWorkId][audioRawIndex - 1];
    if (rawAudio.type != 'audio') {
        return logError('audio record type should be audio');
    }

    const audioProviderPath = rawAudio.path;
    const audioFormat = path.extname(audioProviderPath).substring(1);
    if (audioFormat != 'mp3' && audioFormat != 'wav' && audioFormat != 'flac') {
        return logError('unrecognized audio format, currently support mp3, wav, flac');
    } else if (ctx.meta.audioFormat && ctx.meta.audioFormat != audioFormat) {
        return logError(`new audio format ${audioFormat} not same as existing audio format ${ctx.meta.audioFormat}`);
    }

    const trackIndex = ctx.meta.tracks.reduce((acc, t) => Math.max(acc, t.index), 0) + 1;
    const audioProviderPathBaseName = path.basename(audioProviderPath);
    const trackName = audioProviderPathBaseName.substring(0, audioProviderPathBaseName.length - audioFormat.length - 1);

    let subtitleProviderPath: string;
    if (subtitleWorkId) {
        if (ctx.meta.subtitleWorkId && ctx.meta.subtitleWorkId != subtitleWorkId) {
            return logError(`subtitle work id ${subtitleWorkId} is not same as existing value ${ctx.meta.subtitleWorkId}`);
        }
        const rawSubtitle = ctx.allRawTracks[subtitleWorkId][subtitleRawIndex - 1];
        if (rawSubtitle.type != 'text') {
            return logError('subtitle record type should be text');
        }
        
        subtitleProviderPath = rawSubtitle.path;
        const subtitleFormat = path.extname(subtitleProviderPath).substring(1);
        if (subtitleFormat != 'vtt' && subtitleFormat != 'lrc') {
            return logError('unrecognized subtitle format, currently support vtt, lrc');
        } else if (ctx.meta.subtitleFormat && ctx.meta.subtitleFormat != subtitleFormat) {
            return logError(`new subtitle format ${subtitleFormat} is not same as existing value ${ctx.meta.subtitleFormat}`);
        }

        // assign these after validation
        ctx.meta.subtitleWorkId = subtitleWorkId;
        ctx.meta.subtitleFormat = subtitleFormat;
    }
    // assign these after validation
    ctx.meta.audioWorkId = audioWorkId;
    ctx.meta.audioFormat = audioFormat;

    logInfo(`add track ${trackIndex} audio ${audioProviderPath}${subtitleWorkId ? ` subtitle ${subtitleProviderPath}` : ''}`);
    ctx.meta.tracks.push({ index: trackIndex, name: trackName, duration: rawAudio.duration, providerPath: audioProviderPath, subtitleProviderPath });
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
    } else if (rawIndex <= 0 || rawIndex > ctx.allRawTracks[meid].length) {
        return logError('raw index out of range');
    }
    const rawRecord = ctx.allRawTracks[meid][rawIndex - 1];
    const filePath = path.join(config.dataDirectory, ctx.id, path.basename(rawRecord.path));
    if (npfs.existsSync(filePath)) {
        return logInfo(`${ctx.id}: extra file path ${filePath} already exists, skip`);
    }
    logInfo(`download extra file ${meid} ${rawRecord.path}`);
    if (LOGURL) { logInfo(`download url ${rawRecord.mediaDownloadUrl}`); }
    const response = await fetch(rawRecord.mediaDownloadUrl);
    // this can happen at abitrary file UPDATE this frequently happen to all image and video file in old works
    if (!response.ok) { return logError(`download response not ok ${response.status}`); }
    if (rawRecord.size > 1048576) {
        // no need to precisely and gracefully handle network and fs error in this small script
        await finished(stream.Readable.fromWeb(response.body)
            .pipe(createProgressPipe(rawRecord.size)).pipe(npfs.createWriteStream(filePath)));
    } else {
        // don't display progress and elapsed time for small files
        await finished(stream.Readable.fromWeb(response.body).pipe(npfs.createWriteStream(filePath)));
    }
    logInfo(`download extra file complete`);
}

async function handleDownloadTracks(ctx: CommandContext, dry: boolean) {

    const tasks: { index: number, kind: 'audio' | 'subtitle', rawRecord: FlatRawTrackRecord, filepath: string }[] = [];
    for (const track of ctx.meta.tracks) {
        const rawAudio = ctx.allRawTracks[ctx.meta.audioWorkId].find(r => r.path == track.providerPath);
        if (!rawAudio) {
            return logError(`track ${track.index} audio provider path not found? work ${ctx.meta.audioWorkId} path ${track.providerPath}`);
        }
        const filepath = path.join(config.dataDirectory, ctx.id, `track${track.index}.${ctx.meta.audioFormat}`);
        tasks.push({ index: track.index, kind: 'audio', rawRecord: rawAudio, filepath });
    
        if (ctx.meta.subtitleFormat && track.subtitleProviderPath) {
            const rawSubtitle = ctx.allRawTracks[ctx.meta.subtitleWorkId].find(r => r.path == track.subtitleProviderPath);
            if (!rawSubtitle) {
                return logError(`track ${track.index} subtitle provider path not found? work ${ctx.meta.subtitleFormat} path ${track.subtitleProviderPath}`);
            }
            const filepath = path.join(config.dataDirectory, ctx.id, `track${track.index}.${ctx.meta.audioFormat}.${ctx.meta.subtitleFormat}`);
            tasks.push({ index: track.index, kind: 'subtitle', rawRecord: rawSubtitle, filepath });
        }
    }
    
    let totalSize = 0;
    let networkTaskCount = 0;
    let overallStartTime = Temporal.Now.plainDateTimeISO();
    for (const task of tasks) {
        let startPosition = 0;
        if (npfs.existsSync(task.filepath)) {
            const stat = await fs.stat(task.filepath);
            if (stat.size != task.rawRecord.size) {
                // logError(`track ${task.index} ${task.kind} file path ${task.filepath} exists but size mismatch?`
                //     + `currently no pause and continue functionality, you need to delete the file and retry commit`);
                // continue;
                logInfo(`track ${task.index} ${task.kind} has size not fulfilled file, start from ${stat.size}/${task.rawRecord.size}`);
                startPosition = stat.size;
            } else {
                logInfo(`track ${task.index} ${task.kind} file path ${task.filepath} already exists, skip`);
                continue;
            }
        }
        if (dry) {
            logInfo(`will download track ${task.index} ${task.kind} to ${task.filepath}`);
        } else {
            logInfo(`download track ${task.index} ${task.kind} to ${task.filepath}`);
            if (LOGURL) { logInfo(`download url ${task.rawRecord.mediaDownloadUrl}`); }
            const headers: [string, string][] = [];
            if (startPosition != 0) {
                headers.push(['range', `bytes=${startPosition}-`]);
            }
            const response = await fetch(task.rawRecord.mediaDownloadUrl, { headers });
            if (!response.ok) {
                return logError(`download file response not ok ${response.status}`);
            }
            // console.log(Array.from(response.headers.entries())); // see accept-ranges: bytes
            const expectedSize = task.rawRecord.size - startPosition;
            const sourceStream = stream.Readable.fromWeb(response.body);
            const targetStream = npfs.createWriteStream(task.filepath, { flags: 'a' });
            if (expectedSize < 1048576) {
                await finished(sourceStream.pipe(targetStream));
            } else {
                await finished(sourceStream.pipe(createProgressPipe(expectedSize)).pipe(targetStream));
            }
            logInfo(`download track ${task.index} ${task.kind} complete`);
        }
        totalSize += task.rawRecord.size;
        networkTaskCount += 1;
    }
    if (dry) {
        logInfo(`will download ${networkTaskCount} files ${getDisplaySize(totalSize)}`);
    } else {
        const totalElapsedTime = Temporal.Now.plainDateTimeISO().since(overallStartTime);
        logInfo(`download ${networkTaskCount} files ${getDisplaySize(totalSize)} elapsed ${getDisplayTemporalDuration(totalElapsedTime)}`);
    }
}

// parameters: after "work" not include "work"
async function handleWorkCommand(parameters: string[]) {

    const workId = await getWorkId(parameters[0]); if (!workId) { return; }
    const [rawMetadata, mainRawTracks] = await getRawMetadata(workId, workId);
    if (!rawMetadata) { return; } // already reported error
    // get or create main metadata
    const metadata = await getMetadata(workId, rawMetadata);
    const allRawTracks: [string, RawTrackRecord][] = [[workId, mainRawTracks]];
    // ATTENTION because of similar reason, don't paralle this
    for (const editionId of metadata.languageEditions) {
        // edition raw metadata is not used
        const [rawMetadata, editionRawTracks] = await getRawMetadata(editionId, workId);
        if (!rawMetadata) { return; } // already reported error
        allRawTracks.push([editionId, editionRawTracks]);
    }
    const allFlatRawTracks = Object.fromEntries(allRawTracks.map(([i, r]) => [i, flattenRawTracks(r)]));
    const ctx: CommandContext = { id: workId, meta: metadata, rawMetadata, allRawTracks: allFlatRawTracks };
    
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
            logInfo(`${workId}: clear comment`);
            delete ctx.meta.comment;
        } else {
            logInfo(`${workId}: set comment "${parameters[2]}"`);
            ctx.meta.comment = parameters[2];
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
        const currentTime = now();
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
                    logInfo(`${workId}: track ${trackIndex}: clear comment`);
                    delete track.comment;
                } else {
                    logInfo(`${workId}: track ${trackIndex}: set comment "${parameters[4]}"`);
                    track.comment = parameters[4];
                }
            } else {
                logError('unknown command, see help');
            }
        }
    } else if (parameters[1] == 'add') {
        await handleAddTrack(ctx, parameters.slice(2));
    } else if (parameters[1] == 'extra') {
        await handleDownloadExtraFile(ctx, parameters.slice(2));
    } else if (parameters[1] == 'dry') {
        await handleDownloadTracks(ctx, true);
    } else if (parameters[1] == 'commit') {
        await handleDownloadTracks(ctx, false);
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
    // NOTE temporary add this flag for migration purpose
    const incompleteWorkIds: string[] = [];
    await Promise.all((await fs.readdir(config.dataDirectory)).map(async directoryName => {
        if (directoryName.startsWith('RJ')) {
            const metadataPath = path.join(config.dataDirectory, directoryName, 'metadata.json');
            if (npfs.existsSync(metadataPath)) {
                const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
                if (metadata.tracks.length) {
                    metadatas.push(metadata);
                    for (const track of metadata.tracks) {
                        const audioPath = path.join(config.dataDirectory, metadata.id, `track${track.index}.${metadata.audioFormat}`);
                        if (!npfs.existsSync(audioPath)) {
                            incompleteWorkIds.push(metadata.id);
                        }
                    }
                }
            }
        }
    }));
    let summaryContainerElement = '<div id="summary-container">\n';
    // NOTE temporary sort here because front end does not have much information to sort
    // add time use simple ymdhms format so can directly compare as string
    metadatas.sort((m1, m2) => m1.addTime.localeCompare(m2.addTime));
    for (const metadata of metadatas) { 
        summaryContainerElement +=
            `    <div class="summary" data-id="${metadata.id}" data-score="${metadata.score}" data-wip="${incompleteWorkIds.includes(metadata.id) ? '1' : '0'}">${metadata.title}</div>\n`;
    }
    summaryContainerElement += '  </div>';
    template = template.replace('<div id="summary-container"></div>', summaryContainerElement);

    const styles = await fs.readFile('index.css', 'utf-8');
    template = template.replace('<style></style>', `<style>\n${minifycss(styles)}\n  </style>`);

    const scripts = await fs.readFile('index.ts', 'utf-8');
    const { config: tsconfig } = ts.parseConfigFileTextToJson("tsconfig.json", await fs.readFile('tsconfig.json', 'utf-8'));
    // oh basic transpile is so simple
    const transpileResult = ts.transpile(scripts, tsconfig.compilerOptions);
    template = template.replace('<script></script>', `<script type="module">\n${transpileResult.trim()}\n  </script>`);

    logInfo(`write index.html`);
    await fs.writeFile(path.join(config.dataDirectory, 'index.html'), template);
}

async function handleMigrateCommand() {
    const directoryNames = await fs.readdir(config.dataDirectory);
    const workIds = directoryNames.filter(d => d.startsWith('RJ'));
    console.log(`${workIds.length} works`);

    let maxTagCount = 0;
    let maxTrackCount = 0;
    for (const workId of workIds) {
        const metadataPath = path.join(config.dataDirectory, workId, 'metadata.json');
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
        maxTrackCount = Math.max(maxTrackCount, metadata.tracks.length);
        // 1: score
        // also subtitle format makes 1 tag (a has-subtitle tag)
        maxTagCount = Math.max(maxTagCount, metadata.providerTags.length + metadata.actors.length + metadata.tags.length + 1 + (metadata.subtitleFormat ? 1 : 0));

        if (metadata.tracks.length == 0) {
            logInfo(`${workId}: no tracks`);
        } else {
            for (const track of metadata.tracks) {
                const trackPath = path.join(config.dataDirectory, workId, `track${track.index}.${metadata.audioFormat}`);
                if (!npfs.existsSync(trackPath)) {
                    logInfo(`${workId}: track ${track.index} audio not exist`);
                    break;
                }
                if (metadata.subtitleFormat) {
                    const subtitlePath = trackPath + '.' + metadata.subtitleFormat;
                    if (!npfs.existsSync(subtitlePath)) {
                        logInfo(`${workId}: track ${track.index} subtitle not exist`);
                        break;
                    } else if (metadata.subtitleFormat == 'vtt') {
                        // parseSubtitle('vtt', await fs.readFile(subtitlePath, 'utf-8')).slice(0, 10).map(c => `${c.start}-${c.end} ${c.text}`).join('\n');
                        // console.log();
                    }
                }
                // TODO check size mismatch
            }
            // check track index removed from track name, except with standard name track${index} they don't have a meaningful name
            const alternativeNumbers = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
            const maybeForgetToRemoveTracks = metadata.tracks.filter(t => t.name != `track${t.index}`
                && (t.name.includes(t.index.toString()) || (alternativeNumbers[t.index] && t.name.includes(alternativeNumbers[t.index]))));
            if (maybeForgetToRemoveTracks.length > 2) {
                logInfo(`${workId}: may be forget to remove track index from track name`)
            }
        }
        // await writeMetadata(metadata);
    }
    console.log({ maxTrackCount, maxTagCount });
}
// only when migrating from legacy data, pick a random not included workid
async function handlePickCommand() {
    const legacyWorkIds: string[] = [];
    const legacyWorksOriginalContent = await fs.readFile('legacy.csv', 'utf-8');
    // id;kind;name;path;audioext;subext;tags;add;access
    for (const record of legacyWorksOriginalContent.trim().split('\n').slice(1)) {
        legacyWorkIds.push(record.split(';')[0]);
    }
    const directoryNames = await fs.readdir(config.dataDirectory);
    const workIds = directoryNames.filter(d => d.startsWith('RJ'));
    const editionIds: string[] = [];
    for (const workId of workIds) {
        const metadata = JSON.parse(await fs.readFile(path.join(config.dataDirectory, workId, 'metadata.json'), 'utf-8')) as WorkMetadata;
        editionIds.push(...metadata.languageEditions);
    }
    const remainingLegacyWorkIds = legacyWorkIds.filter(id => !workIds.includes(id) && !editionIds.includes(id));
    const pickedId = remainingLegacyWorkIds[Math.floor(Math.random() * remainingLegacyWorkIds.length)];
    await handleWorkCommand([pickedId]);
}

const command = process.argv[2];
if (command == 'page') {
    await handleMakePage();
} else if (command == 'migrate') {
    await handleMigrateCommand();
} else if (command == 'pick') {
    await handlePickCommand();
} else if (/^RJ\d+$/.test(command) || /^\d+$/.test(command)) {
    await handleWorkCommand(process.argv.slice(2));
} else {
    printUsage();
}

// work directory structure
// - metadata.json: main metadata use by client
// - cover.jpg: cover image
// - track{index}.{audioformat}: audio tracks, e.g. track1.mp3
// - track{index}.{audioformat}.{subtitleformat}: subtitle files, e.g. track1.mp3.vtt
// - raw-metadata.json: archive
// - raw-tracks.json: archive
// - raw-metadata-{editionid}.json: language editions archive
// - raw-tracks-{editionid}.json: language editions archive

// server
// - any static content server can work, no business logic code used
// - may need to specifically allow subtitle files if your server restrict file types,
//   vtt is text/vtt, lrc has no dedicated type, use text/plain

// docker run -it --rm --name at1 -v .:/work -v $WORKDIR:/result -h AT -w /work my/node

// TODO https://github.com/openai/whisper if you notice this is evil openai, this need gpu, need wslc to connect gpu
// TODO unify provider tags and actor names

import fs from 'node:fs/promises';
import npfs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import { styleText } from 'node:util';
import { finished } from 'node:stream/promises';

const config = JSON.parse(await fs.readFile('at.json', 'utf-8')) as {
    dataDirectory: string,
    providerBaseUri: string,
    providerApiBaseUri: string,
};
console.log(`autotrack.ts: data directory ${config.dataDirectory}`);
// console.log(`autotrack.ts: provider base uri ${config.providerBaseUri}`);
// console.log(`autotrack.ts: provider api base uri ${config.providerApiBaseUri}`);

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
            console.error(`autotrack.ts: short work id ${inputValue} not found`);
        } else if (matches.length > 1) {
            console.error(`autotrack.ts: short work id ${inputValue} ambiguous`);
        } else {
            workId = matches[0];
            console.log(`autotrack.ts: work id ${workId}`);
        }
    } else {
        console.error(`USAGE: autotrack.ts work WORKID`);
    }
    
    // check subwork id
    let subworkIdOk = true;
    if (workId) {
        const directoryNames = await fs.readdir(config.dataDirectory);
        await Promise.all(directoryNames.filter(d => d.startsWith('RJ')).map(async existingWorkId => {
            const metadataPath = path.join(config.dataDirectory, existingWorkId, 'metadata.json');
            if (npfs.existsSync(metadataPath)) {
                const existingMetadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as WorkMetadata;
                if (existingMetadata.subworkIds.includes(workId)) {
                    console.error(`autotrack.ts: cannot use subworkid, use main work id ${existingWorkId} instead`);
                    subworkIdOk = false;
                }
            }
        }));
    }
    return subworkIdOk ? workId : null;
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
        console.log(`autotrack.ts: downloading raw work info ${workId} main work id ${mainWorkId}`);
        console.log(`autotrack.ts: downloading url ${url}`);
        // ATTENTION because of similar reason, don't parallel these web requests
        const response = await fetch(url);
        // no need to precisely and gracefully handle network error in this small script
        metadata = await response.json();
        await fs.writeFile(metadataPath, JSON.stringify(metadata, undefined, 2));
        console.log(`autotrack.ts: downloaded raw work info ${workId} main work id ${mainWorkId}`);
    }

    let records: RawTrackRecord[];
    const recordsPath = path.join(config.dataDirectory, mainWorkId, `raw-tracks${pathPostfix}.json`);
    if (npfs.existsSync(recordsPath)) {
        records = JSON.parse(await fs.readFile(recordsPath, 'utf-8'));
    } else {
        url.pathname = `/api/tracks/${workId.substring(2)}`;
        url.searchParams.append('v', '2');
        console.log(`autotrack.ts: downloading raw track info ${workId} main work id ${mainWorkId}`);
        console.log(`autotrack.ts: downloading url ${url}`);
        const response = await fetch(url);
        records = await response.json();
        await fs.writeFile(recordsPath, JSON.stringify(records, undefined, 2));
        console.log(`autotrack.ts: downloaded raw track info ${workId} main work id ${mainWorkId}`);
    }
    const rootRecord: RawTrackRecord = { type: 'folder', title: 'root', children: records };

    // download cover by the way
    if (workId == mainWorkId) {
        const coverImagePath = path.join(config.dataDirectory, mainWorkId, 'cover.jpg');
        if (!npfs.existsSync(coverImagePath)) {
            const url = new URL(metadata.thumbnailCoverUrl);
            if (!url.pathname.endsWith('.jpg')) {
                console.error('autotrack.ts: cover image url not a jpg? skip');
            } else {
                console.log(`autotrack.ts: downloading cover image ${workId}`);
                console.log(`autotrack.ts: downloading url ${url}`);
                const response = await fetch(url);
                // no need to precisely and gracefully handle network and fs error in this small script
                await finished(stream.Readable.fromWeb(response.body).pipe(npfs.createWriteStream(coverImagePath)));
                console.log(`autotrack.ts: downloaded cover image ${workId}`);
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
    subworkIds: string[],
    // custom properties
    // note that title is customizable to remove unnecessary decorations
    title: string,
    addTime: string,
    lastAccessTime: string,
    tags: string[],
    comment?: string,
    // score generally works as one access time +1,
    // but if you feel very good can +2, and feel not good -1
    score: number,
    // mp3 | wav, don't expect other formats for now
    audioFormat?: string,
    // empty for no subtitle, available values vtt, lrc, others TODO
    // UPDATE: vtt is w3c standard? https://www.w3.org/TR/webvtt1/
    // UPDATE you should have reallized that w3c standard means there should be some level of builtin support
    // lrc format is "[mm:ss.xx]content" format, the time in next line indicate end of current line content
    subtitleFormat?: string,
    // empty for no subtitle, main work id or subwork id
    subtitleWorkId?: string,
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
    // exist if have subtitle, belong to main work or subwork
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
        const legacyWorksOriginalContent = await fs.readFile('legacy.csv', 'utf-8') as string;
        // id;kind;name;path;audioext;subext;tags;add;access
        for (const record of legacyWorksOriginalContent.trim().split('\n').slice(1)) {
            const fields = record.split(';');
            legacyWorks.push({ id: fields[0]!, tags: fields[6]!, addTime: fields[7]! });
        }
        const legacyMetadata = legacyWorks.find(w => w.id == workId);
        if (legacyMetadata) { console.log('autotrack.ts: read legacy metadata'); }

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
            subworkIds: (rawMetadata.other_language_editions_in_db?.map(e => e?.source_id) ?? []).filter(x => x),
            title: rawMetadata.title,
            addTime: time,
            lastAccessTime: time,
            tags: legacyMetadata?.tags ? legacyMetadata.tags.split(',') : [],
            score: 1,
            tracks: [],
        };
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
        subworkIds: metadata.subworkIds,
        title: metadata.title,
        addTime: metadata.addTime,
        lastAccessTime: metadata.lastAccessTime,
        tags: metadata.tags,
        score: metadata.score,
        comment: metadata.comment,
        audioFormat: metadata.audioFormat,
        subtitleFormat: metadata.subtitleFormat,
        subtitleWorkId: metadata.subtitleWorkId,
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
function flattenRawTrackRecords(root: RawTrackRecord) {
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
    // also for main work ctx.rawTracksPerWork[ctx.id]
    rawTracksPerWork: Record<string, FlatRawTrackRecord[]>,
}

function handleDisplayMetadata(ctx: CommandContext, raw: boolean) {
    console.log('autotrack.ts: metadata:');
    console.log(`  actors: ${ctx.meta.actors.join(', ')}`);
    console.log(`  provider tags: ${ctx.meta.providerTags.join(', ')}`);
    console.log(`  subworks: ${ctx.meta.subworkIds.length ? ctx.meta.subworkIds.join(', ') : '(empty)'}`);
    console.log(`  title: ${ctx.meta.title}`);
    console.log(`  add time: ${ctx.meta.addTime}`);
    console.log(`  last access time: ${ctx.meta.lastAccessTime}`);
    console.log(`  tags: ${ctx.meta.tags.join(', ')}`);
    console.log(`  comment: ${ctx.meta.comment ?? '(empty)'}`);
    console.log(`  score: ${ctx.meta.score}`);
    console.log(`  audio format: ${ctx.meta.audioFormat ?? '(none)'}`);
    console.log(`  subtitle work id: ${ctx.meta.subtitleWorkId ?? '(no)'}`);
    console.log(`  subtitle format: ${ctx.meta.subtitleFormat ?? '(none)'}`);
    console.log('  raw records: ');
    console.log('  tracks:');
    for (const item of ctx.meta.tracks) {
        console.log(`    ${item.index}: ${item.name} ${styleText('gray', `(${item.providerPath})`)}`);
    }
    if (raw) {
        console.log('  raw tracks:');
        for (const [item, index] of ctx.rawTracksPerWork[ctx.id].map((v, i) => [v, i] as const)) {
            const additionalInfo = styleText('gray', `[${getDisplaySize(item.size)} ${getDisplayDuration(item.duration)}]`);
            console.log(`    ${index + 1}: ${item.path} ${additionalInfo}`);
        }
        for (const subworkId of ctx.meta.subworkIds) {
            for (const [item, index] of ctx.rawTracksPerWork[subworkId].map((v, i) => [v, i] as const)) {
                const additionalInfo = styleText('gray', `[${getDisplaySize(item.size)} ${getDisplayDuration(item.duration)}]`);
                console.log(`    ${subworkId}/${index + 1}: ${item.path} ${additionalInfo}`);
            }
        }
    } else {
        console.log(`autotrack.ts: use "meta raw" for all raw tracks`);
    }
}

// parameters: after "add" not include "add"
function handleAddTrack(ctx: CommandContext, parameters: string[]) {
    const rawIndex = +parameters[0];
    const trackIndex = +parameters[1];
    if (isNaN(rawIndex) || isNaN(trackIndex)) {
        return console.error('USAGE: autotrack.ts work WORKID track add RAWINDEX INDEX');
    }
    if (rawIndex <= 0 || rawIndex > ctx.rawTracksPerWork[ctx.id].length) {
        return console.error('autotrack.ts: work add: raw index out of range');
    } else if (trackIndex <= 0) {
        return console.error('autotrack.ts: work add: invalid track index');
    } else if (ctx.meta.tracks.some(t => t.index == trackIndex)) {
        return console.error('autotrack.ts: work add: track index already exist');
    }
    const rawRecord = ctx.rawTracksPerWork[ctx.id][rawIndex - 1];
    if (rawRecord.type != 'audio') {
        return console.error('autotrack.ts: work add: record type should be audio');
    }

    const providerPath = rawRecord.path;
    console.log(`autotrack.ts: work add: provider path ${providerPath}`);
    const audioFormat = path.extname(providerPath).substring(1);
    if (audioFormat != 'mp3' && audioFormat != 'wav') {
        return console.error('autotrack.ts: work add: can only add mp3 or wav file');
    } else if (ctx.meta.audioFormat && ctx.meta.audioFormat != audioFormat) {
        return console.error(`autotrack.ts: work add: new audio format ${audioFormat} not same as existing value ${ctx.meta.audioFormat}`);
    }
    ctx.meta.audioFormat = audioFormat;

    const providerPathBaseName = path.basename(providerPath);
    const trackName = providerPathBaseName.substring(0, providerPathBaseName.length - audioFormat.length - 1);
    ctx.meta.tracks.push({
        index: trackIndex,
        name: trackName,
        duration: rawRecord.duration,
        providerPath,
    });
}

// parameters: after "subtitle" not include "subtitle"
function handleAddTrackSubtitle(ctx: CommandContext, track: TrackRecord, parameters: string[]) {
    if (!parameters[0]) {
        return console.error('USAGE: autotrack.ts work WORKID track INDEX subtitle [SUBWORKID/]RAWINDEX');
    }
    let subworkId: string; // subwork id or work id
    let rawIndex: number;
    if (parameters[0].includes('/')) {
        const splitted = parameters[0].split('/');
        if (splitted.length != 2) {
            return console.error('USAGE: autotrack.ts work WORKID track INDEX subtitle [SUBWORKID/]RAWINDEX');
        }
        subworkId = splitted[0];
        rawIndex = +splitted[1];
    } else {
        subworkId = ctx.id;
        rawIndex = +parameters[0];
    }

    if (subworkId != ctx.id && !ctx.meta.subworkIds.includes(subworkId)) {
        return console.error(`autotrack.ts: sub work id not belong to current work, available: ${ctx.meta.subworkIds.join(',')}`);
    } else if (ctx.meta.subtitleWorkId && ctx.meta.subtitleWorkId != subworkId) {
        return console.error(`autotrack.ts: work track subtitle: subtitle work id ${subworkId} is not same as existing value ${ctx.meta.subtitleWorkId}`);
    } else if (!rawIndex) {
        return console.error('USAGE: autotrack.ts work WORKID track INDEX subtitle [SUBWORKID/]RAWINDEX');
    } else if (rawIndex < 0 || rawIndex > ctx.rawTracksPerWork[subworkId].length) {
        return console.error('autotrack.ts: work track subtitle: raw index out of range');
    }
    ctx.meta.subtitleWorkId = subworkId;

    const rawRecord = ctx.rawTracksPerWork[subworkId][rawIndex - 1];
    if (rawRecord.type != 'text') {
        return console.error('autotrack.ts: work track subtitle: subtitle should be text file');
    }
    let subtitleFormat: string;
    if (rawRecord.path.endsWith(`.vtt`)) {
        subtitleFormat = 'vtt';
    } else if (rawRecord.path.endsWith(`.lrc`)) {
        subtitleFormat = 'lrc';
    } else {
        return console.error('autotrack.ts: work track subtitle: unrecognized subtitle format, expect .vtt, .lrc');
    }
    if (ctx.meta.subtitleFormat && ctx.meta.subtitleFormat != subtitleFormat) {
        return console.error(`autotrack.ts: work track subtitle: subtitle format ${subtitleFormat} is not same from existing value ${ctx.meta.subtitleFormat}`);
    }
    ctx.meta.subtitleFormat = subtitleFormat;
    console.log(`autotrack.ts: work track subtitle: track ${track.index} subtitle ${rawRecord.path}`);
    track.subtitleProviderPath = rawRecord.path;
}

// parameters: after "move" not include "move"
async function handleMoveTrack(ctx: CommandContext, track: TrackRecord, parameters: string[]) {
    if (!parameters[0]) {
        return console.error('USAGE: autotrack.ts work WORKID track INDEX move NEWINDEX');
    }
    const newIndex = +parameters[0];
    if (!newIndex || newIndex <= 0) {
        return console.error('autotrack.ts: work track move: invalid new index');
    } else if (ctx.meta.tracks.some(t => t.index != track.index && t.index == newIndex)) {
        return console.error('autotrack.ts: work track move: new index already exist');
    }
    console.log(`autotrack.ts: ATTENTION will try to move actual file, but no transaction and rollback for that`);
    console.log(`autotrack.ts: that is if audio file move ok but subtitle file move not ok, audio file will not rollback while metadata will not update`);
    if (ctx.meta.audioFormat) {
        const oldAudioPath = path.join(config.dataDirectory, ctx.id, `track${track.index}.${ctx.meta.audioFormat}`);
        const newAudioPath = path.join(config.dataDirectory, ctx.id, `track${newIndex}.${ctx.meta.audioFormat}`);
        if (npfs.existsSync(oldAudioPath)) {
            if (npfs.existsSync(newAudioPath)) {
                // not regard as error
                console.log(`autotrack.ts: work track move: skip move audio file because target path exists`);
            } else {
                console.log(`autotrack.ts: move ${oldAudioPath} to ${newAudioPath}`);
                await fs.rename(oldAudioPath, newAudioPath);
            }
        }
        if (ctx.meta.subtitleFormat) {
            const oldSubtitlePath = `${oldAudioPath}.${ctx.meta.subtitleFormat}`;
            const newSubtitlePath = `${newAudioPath}.${ctx.meta.subtitleFormat}`;
            if (npfs.existsSync(newSubtitlePath)) {
                // not regard as error
                console.log(`autotrack.ts: work track move: skip move subtitle file because target path exists`);
            } else {
                console.log(`autotrack.ts: move ${oldSubtitlePath} to ${newSubtitlePath}`);
                await fs.rename(oldSubtitlePath, newSubtitlePath);
            }
        }
    }
    console.log(`autotrack.ts: work track move: from ${track.index} to ${newIndex}`);
    track.index = newIndex;
}

// parameters: after "file" not include "file"
async function handleDownloadArbitraryFile(ctx: CommandContext, parameters: string[]) {
    if (!parameters[0]) {
        return console.error('USAGE: autotrack.ts work WORKID file [SUBWORKID/]RAWINDEX');
    }
    let subworkId: string; // subwork id or work id
    let rawIndex: number;
    if (parameters[0].includes('/')) {
        const splitted = parameters[0].split('/');
        if (splitted.length != 2) {
            return console.error('USAGE: autotrack.ts work WORKID file [SUBWORKID/]RAWINDEX');
        }
        subworkId = splitted[0];
        rawIndex = +splitted[1];
    } else {
        subworkId = ctx.id;
        rawIndex = +parameters[0];
    }

    if (subworkId != ctx.id && !ctx.meta.subworkIds.includes(subworkId)) {
        return console.error(`autotrack.ts: sub work id not belong to current work, available: ${ctx.meta.subworkIds.join(',')}`);
    } else if (!rawIndex) {
        return console.error('USAGE: autotrack.ts work WORKID file [SUBWORKID/]RAWINDEX');
    } else if (rawIndex < 0 || rawIndex > ctx.rawTracksPerWork[subworkId].length) {
        return console.error('autotrack.ts: work track subtitle: raw index out of range');
    }
    const rawRecord = ctx.rawTracksPerWork[subworkId][rawIndex - 1];
    const filePath = path.join(config.dataDirectory, ctx.id, path.basename(rawRecord.path));
    if (npfs.existsSync(filePath)) {
        return console.log(`autotrack.ts: file path ${filePath} already exists, skip`);
    }
    console.log(`autotrack.ts: downloading file ${subworkId} ${rawRecord.path}`);
    console.log(`autotrack.ts: downloading url ${rawRecord.mediaDownloadUrl}`);
    const startTime = Temporal.Now.plainDateTimeISO();
    const response = await fetch(rawRecord.mediaDownloadUrl);
    // this can happen at abitrary file
    if (!response.ok) {
        return console.error(`autotrack.ts: download file response not ok ${response.status}`);
    }
    // no need to precisely and gracefully handle network and fs error in this small script
    await finished(stream.Readable.fromWeb(response.body).pipe(npfs.createWriteStream(filePath)));
    const elapsedTime = Temporal.Now.plainDateTimeISO().since(startTime);
    console.log(`autotrack.ts: downloaded file complete elapsed ${getDisplayTemporalDuration(elapsedTime)}`);

}
// parameters: after "fetch" not include "fetch"
async function handleDownloadTracks(ctx: CommandContext, parameters: string[]) {
    const dry = parameters[0] == "dry";

    const tasks: { desc: string, url: string, filesize: number, filepath: string }[] = [];
    for (const track of ctx.meta.tracks) {
        const desc = `track ${track.index} provider path ${track.providerPath}`;
        const rawRecord = ctx.rawTracksPerWork[ctx.id].find(r => r.path == track.providerPath);
        if (!rawRecord) {
            return console.error(`autotrack.ts: track ${track.index} provider path ${track.providerPath} not found, check metadata`);
        }
        const url = rawRecord.mediaDownloadUrl;
        const filesize = rawRecord.size;
        const filepath = path.join(config.dataDirectory, ctx.id, `track${track.index}.${ctx.meta.audioFormat}`);
        tasks.push({ desc, url, filesize, filepath });
        if (ctx.meta.subtitleFormat && track.subtitleProviderPath) {
            const desc = `track ${track.index} subtitle work ${ctx.meta.subtitleWorkId} provider path ${track.subtitleProviderPath}`;
            const rawRecord = ctx.rawTracksPerWork[ctx.meta.subtitleWorkId].find(r => r.path == track.subtitleProviderPath);
            if (!rawRecord) {
                return console.error(`autotrack.ts: track ${track.index} subtitle work ${ctx.meta.subtitleWorkId} provider path ${track.subtitleProviderPath} not found, check metadata`);
            }
            const url = rawRecord.mediaDownloadUrl;
            const filesize = rawRecord.size;
            const filepath = path.join(config.dataDirectory, ctx.id, `track${track.index}.${ctx.meta.audioFormat}.${ctx.meta.subtitleFormat}`);
            tasks.push({ desc, url, filesize, filepath });
        }
    }
    
    // dry run
    if (dry) {
        for (const task of tasks) {
            console.log(`autotrack.ts: will download ${task.desc}`);
            console.log(`autotrack.ts: will use url ${task.url}`);
            console.log(`autotrack.ts: will use file path ${task.filepath}`);
        }
        return;
    }

    let networkTaskCount = 0;
    let totalStartTime = Temporal.Now.plainDateTimeISO();
    for (const task of tasks) {
        if (npfs.existsSync(task.filepath)) {
            const stat = await fs.stat(task.filepath);
            if (stat.size != task.filesize) {
                console.error(`autotrack.ts: task ${task.desc} file path ${task.filepath} expect file size ${task.filesize} actual size ${stat.size}`);
                console.error(`autotrack.ts: no pause and continue functionality implemented for now, you have to delete and retry`);
                continue;
            } else {
                console.log(`autotrack.ts: task ${task.desc} file path ${task.filepath} already exists, skip`);
                continue;
            }
        }
        console.log(`autotrack.ts: downloading ${task.desc}`);
        console.log(`autotrack.ts: downloading url ${task.url}`);
        const startTime = Temporal.Now.plainDateTimeISO();
        const response = await fetch(task.url);
        if (!response.ok) {
            return console.error(`autotrack.ts: download file response not ok ${response.status}`);
        }
        await finished(stream.Readable.fromWeb(response.body).pipe(npfs.createWriteStream(task.filepath)));
        const elapsedTime = Temporal.Now.plainDateTimeISO().since(startTime);
        networkTaskCount += 1;
        console.log(`autotrack.ts: download complete elapsed ${getDisplayTemporalDuration(elapsedTime)}`);
    }
    const totalElapsedTime = Temporal.Now.plainDateTimeISO().since(totalStartTime);
    console.log(`autotrack.ts: download ${networkTaskCount} files elapsed ${getDisplayTemporalDuration(totalElapsedTime)}`);
}

// parameters: after "work" not include "work"
async function handleWorkCommand(parameters: string[]) {

    const workId = await getWorkId(parameters[0]); if (!workId) { return; }
    const [rawMetadata, treedRawTrackRecords] = await getRawMetadata(workId, workId);
    // get or create main metadata
    const metadata = await getMetadata(workId, rawMetadata);
    // subworkid => subwork flat raw track records
    const rawTracksPerWork: Record<string, FlatRawTrackRecord[]> = {};
    rawTracksPerWork[workId] = flattenRawTrackRecords(treedRawTrackRecords);
    for (const subworkId of metadata.subworkIds) {
        // ATTENTION because of similar reason don't parallel this
        const [_, treedRawTrackRecords] = await getRawMetadata(subworkId, workId);
        rawTracksPerWork[subworkId] = flattenRawTrackRecords(treedRawTrackRecords);
    }
    const ctx: CommandContext = { id: workId, meta: metadata, rawMetadata, rawTracksPerWork };
    
    if (parameters[1] == 'meta') {
        handleDisplayMetadata(ctx, parameters[2] == 'raw');
    } else if (parameters[1] == 'title') {
        if (parameters.length <= 2) {
            console.error('USAGE: autotrack.ts work WORKID title NEWTITLE');
        } else {
            console.log(`autotrack.ts: work title: rename ${ctx.meta.title} to ${parameters[2]}`);
            ctx.meta.title = parameters[2];
        }
    } else if (parameters[1] == 'add-tag') {
        if (parameters.length <= 2) {
            console.error('USAGE: autotrack.ts work WORKID add-tag TAG');
        } else if (ctx.meta.tags.includes(parameters[2])) {
            console.log(`autotrack.ts: work tag: tag ${parameters[2]} already exists`);
        } else {
            console.log(`autotrack.ts: work tag: add tag ${parameters[2]}`);
            ctx.meta.tags.push(parameters[2]);
        }
    } else if (parameters[1] == 'del-tag') {
        if (parameters.length <= 2) {
            console.error('USAGE: autotrack.ts work WORKID del-tag TAG');
        } else if (!ctx.meta.tags.includes(parameters[2])) {
            console.log(`autotrack.ts: work tag: tag ${parameters[2]} not exist?`);
        } else {
            console.log(`autotrack.ts: work tag: del tag ${parameters[2]}`);
            ctx.meta.tags.splice(ctx.meta.tags.indexOf(parameters[2]), 1);
        }
    } else if (parameters[1] == 'comment') {
        if (parameters.length <= 2) {
            console.error('USAGE: autotrack.ts work WORKID comment COMMENT');
        } else {
            console.log(`autotrack.ts: work track comment: set from ${ctx.meta.comment ?? "(empty)"} to ${parameters[2]}`);
            ctx.meta.comment = parameters[2];
        }
    } else if (parameters[1] == '+1') {
        console.log(`autotrack.ts: work track score: +1 = ${ctx.meta.score + 1}`);
        ctx.meta.score += 1;
    } else if (parameters[1] == '+2') {
        console.log(`autotrack.ts: work track score: +2 = ${ctx.meta.score + 2}`);
        ctx.meta.score += 2;
    } else if (parameters[1] == '-1') {
        console.log(`autotrack.ts: work track score: +1 = ${metadata.score - 1}`);
        ctx.meta.score -= 1;
    } else if (parameters[1] == 'file') {
        await handleDownloadArbitraryFile(ctx, parameters.slice(2));
    } else if (parameters[1] == 'fetch') {
        await handleDownloadTracks(ctx, parameters.slice(2));
    } else if (parameters[1] == 'track') {
        if (parameters.length <= 2) {
            console.error('USAGE: autotrack.ts work WORKID track SUBCOMMAND');
            console.error('  add      add track virtually');
            console.error('  INDEX    manage track by index');
        } else if (parameters[2] == 'add') {
            handleAddTrack(ctx, parameters.slice(3));
        } else {
            const trackIndex = +parameters[2];
            const track = metadata.tracks.find(t => t.index == trackIndex);
            if (isNaN(trackIndex)) {
                console.error('USAGE: autotrack.ts work WORKID track INDEX');
            } else if (!track) {
                console.error('autotrack.ts: track index out of range');
            } else {
                if (parameters[3] == 'name') {
                    if (parameters.length <= 4) {
                        console.error('USAGE: autotrack.ts work WORKID track INDEX name NAME');
                    } else {
                        console.log(`autotrack.ts: work track name: rename from ${track.name} to ${parameters[4]}`);
                        track.name = parameters[4];
                    }
                } else if (parameters[3] == 'move') {
                    await handleMoveTrack(ctx, track, parameters.slice(4));
                } else if (parameters[3] == 'subtitle') {
                    handleAddTrackSubtitle(ctx, track, parameters.slice(4));
                } else if (parameters[3] == 'comment') {
                    if (parameters.length <= 4) {
                        console.error('USAGE: autotrack.ts work WORKID track INDEX comment COMMENT');
                    } else {
                        console.log(`autotrack.ts: work track comment: set from ${track.comment ?? "(empty)"} to ${parameters[4]}`);
                        track.comment = parameters[4];
                    }
                } else {
                    console.error('USAGE: autotrack.ts work WORKID track INDEX SUBCOMMANDS');
                    console.error('  name        set track name');
                    console.error('  move        set track index');
                    console.error('  subtitle    associate subtitle file');
                    console.error('  comment     set comment');
                }
            }
        }
    } else {
        console.error('USAGE: autotrack.ts work WORKID SUBCOMMAND');
        console.error('  meta       display metadata');
        console.error('  title      set work title');
        console.error('  add-tag    add tag');
        console.error('  del-tag    remove tag');
        console.error('  comment    set comment');
        console.error('  +1/+2/-1   set score');
        console.error('  file       download arbitrary file');
        console.error('  fetch      commit virtually setup tracks');
        console.error('  track      manage tracks');
    }

    await writeMetadata(metadata);
}

async function makePage() {

    let template = `<!DOCTYPE html>
<html>
<head>
  <title>ASMR Offline</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style></style>
</head>
<body>
  <header>
    <h2>ASMR Offline</h2>
  </header>
  <div id="items-container"></div>
  <div id="work-detail-container"></div>
  <div class="audio-container"></div>
  <script defer type="module" src="/index.js"></script>
</body>
</html>`;

    // inline workid + title list in html file should be easier then separate index.json data
    const metadatas: WorkMetadata[] = [];
    await Promise.all((await fs.readdir(config.dataDirectory)).map(async directoryName => {
        if (directoryName.startsWith('RJ')) {
            const metadataPath = path.join(config.dataDirectory, directoryName, 'metadata.json');
            if (npfs.existsSync(metadataPath)) {
                metadatas.push(JSON.parse(await fs.readFile(metadataPath, 'utf-8')));
            }
        }
    }));
    
    const styles = await fs.readFile('index.css', 'utf-8');
    template = template.replace('<style></style>', `<style>\n${styles}\n  </style>`);
    
    let itemsContainerElement = '<div id="items-container">\n';
    for (const metadata of metadatas) { 
        itemsContainerElement +=
            `    <div class="item-container" data-id="${metadata.id}"`
            + ` data-score="${metadata.score}">${metadata.title}</div>\n`;
    }
    itemsContainerElement += '  </div>';
    template = template.replace('<div id="items-container"></div>', itemsContainerElement);
    console.log(`make-page.ts: write index.html`);
    await fs.writeFile(path.join(config.dataDirectory, 'index.html'), template);

    console.log(`make-page.ts: deploy index.js`);
    await fs.copyFile('index.js', path.join(config.dataDirectory, 'index.js'));
}

async function handleMigrateCommand() {
    const directoryNames = await fs.readdir(config.dataDirectory);
    const workIds = directoryNames.filter(d => d.startsWith('RJ'));
}

const command = process.argv[2];
if (command == 'page') {
    await makePage();
} else if (command == 'migrate') {
    await handleMigrateCommand();
} else if (command == 'work') {
    await handleWorkCommand(process.argv.slice(3));
} else {
    console.error('USAGE: autotrack.ts SUBCOMMAND');
    console.error('  work         manage works');
    console.error('  make-page    manage client side page');
}

// work directory structure
// - metadata.json: main metadata use by client
// - cover.jpg: cover image
// - track{index}.{audioformat}: audio tracks, e.g. track1.mp3
// - track{index}.{audioformat}.{subtitleformat}: subtitle files, e.g. track1.mp3.vtt
// - raw-metadata.json: archive
// - raw-tracks.json: archive
// - raw-metadata-{subworkid}.json: subwork archive
// - raw-tracks-{subworkid}.json: subwork archive

// command line
// - at.ts page: make index.html
// - at.ts migrate: convenient command to run custom migration code for data structure and file structure
// - at.ts work {workid}: create work directory, other work commands also create work directory if not exist
//   - for all work commands, use latter digits as a short hand for existing *main* work id if not ambiguous
//   - will also download raw files for subwork, make sure you first add the main work
// - at.ts work {workid} meta: display work information and track information
// - at.ts work {workid} meta raw: display work information and track information and raw track information
// - at.ts work {workid} title {title}: set title, normally remove decorations
// - at.ts work {workid} add-tag/del-tag {tagname}: set tag
// - at.ts work {workid} comment {comment}: set comment
// - at.ts work {workid} score+1/+2/-1: set score
// - at.ts work {workid} file {rawindex}: download single arbitrary file immediately
// - at.ts work {workid} fetch: download files according to setting
// - at.ts work {workid} track add {rawindex} {index}: add single file to my tracks, this *does not* download file
//   rawindex is index in raw track records flattened list, index is my index as in track1.mp3, track2.mp3, etc.
// - at.ts work {workid} track {index} name {name}: set track name, normally remove decorations
// - at.ts work {workid} track {index} move {newindex}: set track index TODO this rename file?
// - at.ts work {workid} track {index} subtitle {subrjid/}?{rawindex}: associate subtitle to existing track index
//   - raw index can prepend subworkid like in meta raw display
// - at.ts work {workid} track {index} comment {comment}: set comment

// server
// to make server simple, it only serve static content and don't run any business logic code

// docker run -it --rm --name audio1 -v .:/work -v $WORKDIR:/result -h AT -w /work my/node

// TODO inline index.js index.css into index.html, inline index.html into make-page.ts, merge make-page.ts here
// TODO https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement
// TODO pagination and sorting, sort by score and sort by random
// TODO validate track raw record size against file size
// TODO index.html only have workid (indicate cover) + title, don't have tags comment score etc.
// TODO static content server may need configuration to support vtt/lrc uncommon file formats

// TODO consider dsl
// 1: 1
// 1: 2 sub 1
// 2: 4 sub 3
// 1: 120 sub RJ123456/105
// 2: 122 sub RJ123456/107
